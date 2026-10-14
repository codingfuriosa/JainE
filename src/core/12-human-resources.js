/* ============================ HUMAN RESOURCES ============================ */
let HR_EMP=null, HR_DIR_Q='', HR_DIR_DEPT='', HR_ATT_DATE=null;
async function hrEmployees(force){
  if(HR_EMP&&!force)return HR_EMP;
  try{const {data}=await sb.schema('hr').from('employees').select('id,emp_code,full_name,department,designation,email,phone,date_of_joining,location,reporting_to,status').order('full_name');HR_EMP=data||[];}catch(e){HR_EMP=[];}
  return HR_EMP;
}
function hrName(code){const e=(HR_EMP||[]).find(x=>x.emp_code===code);return e?e.full_name:(code||'—');}
function hrCan(){return state.super||(state.roles&&state.roles.hr);}
function hrCanWrite(){return state.super||(state.roles&&['ADMIN','MANAGER','EDITOR','HR'].includes(state.roles.hr));}

/* ---- Recruitment write access ------------------------------------------------------------
   Adding, editing and deleting anything in Recruitment is limited to Administrators, Abhay
   Mati, and whoever sits in the HR department. Everyone else keeps read-only access: the
   controls are stripped from the page AND every action re-checks, so a stale page can't be
   used to slip a change through. */
const REC_RO_CSS='<style id="recRoCss">.rec-ro{display:flex;align-items:center;gap:9px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:10px 14px;font-size:12.5px;font-weight:600;margin:0 0 14px}.rec-ro i{color:#d97706}</style>';
function recCanWrite(){
  if(state.super) return true;
  const p=state.profile||{}, r=state.roles||{};
  const em=String(state.email||'').trim().toLowerCase();
  const nm=String(p.full_name||r.full_name||'').trim().toLowerCase();
  if(em==='system1@thejaingroup.com'||nm==='abhay mati') return true;
  const dep=[].concat(p.department||r.department||[]);
  return dep.some(function(d){ return /^\s*(hr|human\s*resources?)\s*$/i.test(String(d||'')); });
}
function recGuard(){
  if(recCanWrite()) return true;
  toast('Read-only — only HR, Abhay Mati and Administrators can change Recruitment records','err');
  return false;
}
const REC_WRITE_FNS=['rtAdd','rtRename','rtDelete','rtSave','rtUpdate','rtShareSend',
  'mpFillForm','mpEditSel','mpDeleteSel','mpEdit','mpDeleteOne','mpUpdate','mpSave',
  'recUploadModal','recDeleteSel','recJdSave','recJdDelete',
  'tpMpApprove','tpMpReject','tpMpRejectConfirm','tpMpDeleteOne','tpMpGenerate',
  'tpRefConnect','tpRefConnectGo','tpRefReject','tpTrAdd','tpTrSave','tpTrEmailSel','tpTrEmailSelSend','tpTrDeleteSel',
  'tpMuOpenMonth','tpMuDeleteRow'];
/* CONTROLS ARE DISABLED AND EXPLAINED, NOT DELETED.

   This used to call el.remove(), and that one decision cost more time today than any bug in the
   features themselves. A button that is simply gone tells you nothing: Preview, Get Link and Send
   each vanished in turn, and every time it looked like the feature was broken, or the account was
   wrong, or the file was stale - when the real answer was "you do not have permission" or "your
   roles are three minutes out of date". Hours went into questions one sentence on the screen would
   have answered.

   So the control stays, greyed, and says why when pressed. That is no less safe: removal only ever
   hid the control, it never stopped anything - every one of these actions re-checks permission
   itself, and the database checks again on the write. Hiding was never the protection; it only
   made the failure silent.

   Anything that cannot be disabled - a link, a div - has its onclick taken away instead, so it can
   still be seen and still cannot act. */
function recStripWriteControls(root){
  if(recCanWrite()) return;
  const re=new RegExp('^\\s*(?:'+REC_WRITE_FNS.join('|')+')\\s*\\(');
  const why='Read-only — only HR, Abhay Mati and Administrators can change Recruitment records.';
  (root||document).querySelectorAll('[onclick]').forEach(function(el){
    if(!re.test(el.getAttribute('onclick')||'')) return;
    if(el.dataset && el.dataset.recLocked==='1') return;   // the observer re-runs; do this once
    if(el.dataset) el.dataset.recLocked='1';
    el.removeAttribute('onclick');
    el.setAttribute('title',why);
    /* NOT el.disabled. A disabled button swallows the click, so the very sentence this exists to
       show would never appear - the control would look dead for no stated reason, which is the
       failure being fixed. It is marked disabled to assistive tech, greyed to the eye, and its
       action already removed above; the listener below is what answers the press. */
    el.setAttribute('aria-disabled','true');
    el.style.opacity='.55';
    el.style.cursor='not-allowed';
    el.addEventListener('click',function(ev){
      ev.preventDefault(); ev.stopPropagation();
      try{ toast(why,'err'); }catch(_e){}
    },true);
  });
}
// Several Recruitment bars are re-rendered on the fly, so watch the view and re-strip.
function recWatchPerms(){
  if(recCanWrite()) return;
  const host=document.getElementById('view'); if(!host) return;
  recStripWriteControls(host);
  if(window._recObs) window._recObs.disconnect();
  window._recObs=new MutationObserver(function(){ recStripWriteControls(host); recStripWriteControls(document.getElementById('modalHost')); });
  window._recObs.observe(host,{childList:true,subtree:true});
  const mh=document.getElementById('modalHost');
  if(mh) window._recObs.observe(mh,{childList:true,subtree:true});
}
function hrEmpOptions(sel){return (HR_EMP||[]).map(e=>`<option value="${esc(e.emp_code)}" ${e.emp_code===sel?'selected':''}>${esc(e.full_name)} (${esc(e.emp_code)})</option>`).join('');}

// Human Resources (New) -- retired hr.html's four tabs, rebuilt on talent's better Tracker/Monthly
// Update (tpTracker/tpMonthlyUpdate: counted from hr.candidates, never hand-typed) instead of v1's
// hrTracker/hrMonthlyUpdate, which are deleted. Resumes and Interview Qs had no v2 equivalent in
// talent, so hrResumes/hrInterviewQs are reused as-is -- they, and tp*, disagree on which body
// container id they render into (hrBody vs recBody), so the id switches per tab below.
VIEWS.hr_new=async function(v,seg){
  setCrumb(['People','Human Resources']);
  const tabs=['Interviews','Monthly Progress','Resumes'];
  const ti=mTab(seg,tabs.length);
  const bodyId=(ti<=1)?'recBody':'hrBody';
  v.innerHTML=REC_RO_CSS+TP_CSS+mHead('fa-users','#be123c','Human Resources')
    +(recCanWrite()?'':'<div class="rec-ro"><i class="fa-solid fa-lock"></i> Approving, editing and deleting here is limited to HR, Abhay Mati and Administrators.</div>')
    +mTabs('hr_new',tabs,ti)+'<div id="'+bodyId+'" style="margin-top:16px"><div class="loader"><div class="spin"></div></div></div>';
  recWatchPerms();
  if(ti===0){await tpTracker();return;}
  if(ti===1){await tpMonthlyUpdate();return;}
  /* Resumes is the last tab now. Interview Qs was removed: it was a library nobody was reaching
     for, and it sat in the tab strip costing a decision on every visit. hrInterviewQs() is left in
     the file rather than deleted, so nothing is lost if it is ever wanted back. */
  await hrResumes();
};

/* ── Monthly Update ──
   Rebuilt against hr.monthly_view. The nine columns — Tests Sent, Test Passed, Interview Scheduled,
   Interview Done, Selected, Rejected, Hold, Backed Out, Joined — are COUNTED from hr.candidates,
   never typed. The old screen was a grid of number boxes somebody had to keep in step with reality
   by hand; every figure here is derived, so it cannot drift.
   The first four columns are cumulative ("how many got at least this far") and read the candidate's
   high-water mark, not their current stage — otherwise anybody who dropped out after their test
   would still be counted as having been interviewed. The last five are exact outcomes. That split
   lives in hr.tracker_stages.counts_as, so adding a stage is a database change, not a code change.
   A candidate begins BELOW all nine, at 'Applied' (seq 0), so filling in the careers-page form no
   longer reports a test as having been sent to them. Nothing counts them until something really
   happens; how many applied is candidate_total, which hr.monthly_view returns separately. */
let MU_MONTHS_CACHE=null, MU_CUR=null, MU_ROWS=null, MU_SEL=new Set();
const MU_MONTH_NAMES=['January','February','March','April','May','June','July','August','September','October','November','December'];
/* The nine column names come from the database (hr.tracker_stages) so the screen cannot disagree
   with what the counts were computed against. The literal below is the same list, and is what gets
   used if that one read fails — a stale header is better than a blank page. */
let MU_STAGES=['Tests Sent','Test Passed','Interview Scheduled','Interview Done','Selected','Rejected','Hold','Backed Out','Joined'];
let MU_STAGES_LOADED=false;
function muMonthLabel(iso){
  if(!iso) return '';
  const parts=String(iso).split('-');
  return (MU_MONTH_NAMES[parseInt(parts[1],10)-1]||'')+' '+parts[0];
}
async function muLoadStages(){
  if(MU_STAGES_LOADED) return;
  MU_STAGES_LOADED=true;
  try{
    const {data}=await sb.schema('hr').from('tracker_stages').select('seq,label').order('seq');
    if(data&&data.length) MU_STAGES=data.map(function(s){return s.label;});
  }catch(e){/* keep the literal order above */}
}

async function hrMonthlyUpdate(){
  const b=$('hrBody');
  if(MU_CUR!=null) return muRenderDetail(b);
  loader(b);
  await muLoadStages();
  try{
    const {data,error}=await sb.schema('hr').rpc('monthly_months');
    if(error) throw error;
    MU_MONTHS_CACHE=data||[];
  }catch(e){
    b.innerHTML='<div class="card card-pad empty" style="color:var(--err)">'+esc(e.message||String(e))+'</div>';
    return;
  }
  muRenderList(b);
}

function muRenderList(b){
  const rows=MU_MONTHS_CACHE||[];
  let html='<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">'
    +'<div class="sec-title" style="margin:0">Monthly Updates</div>'
    +'<span class="mu-computed"><i class="fa-solid fa-circle-check"></i> Every figure is counted from the candidates — nothing is typed in</span>'
    +'</div>';
  if(!rows.length){
    html+='<div class="card card-pad empty"><i class="fa-regular fa-calendar"></i>'
      +'<div style="font-weight:600;color:var(--ink)">No months yet</div>'
      +'<p style="max-width:400px;margin:6px auto 0">A month appears here as soon as a hiring request lands in it. '
      +'Fill a ManPower Form in Recruitment to start one.</p></div>';
  } else {
    html+='<div class="mu-grid">'+rows.map(function(r){
      const pending=Number(r.pending||0);
      const pos=Number(r.positions||0);
      return '<div class="mu-card" onclick="muViewMonth(\''+esc(r.row_month)+'\')">'
        +'<div class="mu-card-icon"><i class="fa-solid fa-calendar-days"></i></div>'
        +'<div class="mu-card-body"><div class="mu-card-label">'+esc(muMonthLabel(r.row_month))
          +(pending?'<span class="mu-card-pending">'+pending+' to approve</span>':'')+'</div>'
          +'<div class="mu-card-meta">'+pos+' position'+(pos===1?'':'s')+'</div></div>'
        +'<i class="fa-solid fa-chevron-right mu-card-arrow"></i></div>';
    }).join('')+'</div>';
  }
  b.innerHTML=html;
}

window.muViewMonth=function(iso){ MU_CUR=iso; MU_ROWS=null; MU_SEL=new Set(); hrMonthlyUpdate(); };
window.muBack=function(){ MU_CUR=null; MU_ROWS=null; MU_SEL=new Set(); MU_MONTHS_CACHE=null; hrMonthlyUpdate(); };

async function muRenderDetail(b){
  await muLoadStages();
  if(!MU_ROWS){
    loader(b);
    try{
      const {data,error}=await sb.schema('hr').rpc('monthly_view',{p_month:MU_CUR});
      if(error) throw error;
      MU_ROWS=data||[];
    }catch(e){
      b.innerHTML='<div class="card card-pad empty" style="color:var(--err)">'+esc(e.message||String(e))+'</div>';
      return;
    }
  }
  const rows=MU_ROWS, stages=MU_STAGES;
  const depts=[...new Set(rows.map(function(r){return r.department;}).filter(Boolean))].sort();
  const n=MU_SEL.size;
  const dis='opacity:.45;cursor:not-allowed;pointer-events:none';
  const canAppr=hrCan();

  const head='<tr>'
    +'<th style="width:36px"><input type="checkbox" class="mu-cb" id="muChkAll" onchange="muToggleAll(this)"></th>'
    +'<th>Position</th><th>Vacancies</th><th>Status</th><th>Hiring</th>'
    +stages.map(function(s,i){ return '<th class="mu-n'+(i===0?' mu-split':'')+'">'+esc(s)+'</th>'; }).join('')
    +'</tr>';

  const body=rows.map(function(r){
    const c=r.counts||{};
    const st=r.approval_status||'Pending';
    const cells=stages.map(function(s,i){
      const v=Number(c[s]||0);
      return '<td class="mu-n'+(i===0?' mu-split':'')+(v?'':' mu-zero')+'">'+v+'</td>';
    }).join('');
    let appr;
    if(st==='Pending'){
      appr=canAppr
        ? '<span class="mu-appr">'
            +'<button class="btn btn-sm btn-ok" onclick="event.stopPropagation();muApprove('+r.manpower_id+',true)"><i class="fa-solid fa-check"></i> Approve</button>'
            +'<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();muApprove('+r.manpower_id+',false)"><i class="fa-solid fa-xmark"></i> Reject</button>'
          +'</span>'
        : '<span class="tag t-amber">Awaiting HR</span>';
    } else if(st==='Rejected'){
      appr='<span class="tag t-red" title="'+esc(r.rejection_reason||'')+'">Rejected</span>';
    } else {
      appr='<span class="tag t-green" title="'+esc('Approved by '+(r.approved_by||'—'))+'">Approved</span>';
    }
    const open=(r.hiring_status||'Open')==='Open';
    const cls=[st==='Pending'?'mu-fresh':'', open?'':'mu-closed'].filter(Boolean).join(' ');
    return '<tr data-id="'+r.row_id+'" data-pos="'+esc((r.position_title||'').toLowerCase())+'" data-dept="'+esc(r.department||'')+'"'
      +(cls?' class="'+cls+'"':'')+'>'
      +'<td><input type="checkbox" class="mu-cb mu-row-cb" data-id="'+r.row_id+'" onchange="muRowCheck(this)"></td>'
      +'<td class="mu-pos">'+esc(r.position_title||'—')
        +'<div class="mu-sub">'+esc(r.department||'No department')
        +(r.raised_by?' · raised by '+esc(r.raised_by):'')
        +(r.priority==='Urgent'?' · <b style="color:var(--err)">Urgent</b>':'')+'</div></td>'
      +'<td>'+esc(r.vacancies||'—')+'</td>'
      +'<td>'+appr+'</td>'
      +'<td class="mu-hire">'+muHireCell(r,open,canAppr)+'</td>'
      +cells
      +'</tr>';
  }).join('');

  b.innerHTML='<div class="mu-detail-bar">'
      +'<button class="btn" onclick="muBack()"><i class="fa-solid fa-arrow-left"></i> Back</button>'
      +'<h2 style="margin:0;font-size:18px;font-weight:700"><i class="fa-solid fa-calendar-days" style="color:#be123c;margin-right:8px"></i>'+esc(muMonthLabel(MU_CUR))+'</h2>'
      +'<div class="mu-detail-actions">'
        +'<button class="btn btn-sm" onclick="muRefresh()"><i class="fa-solid fa-rotate"></i> Refresh</button>'
        +'<button class="btn btn-sm" id="muDelBtn" '+(n?'':'disabled style="'+dis+'"')
          +' onclick="muDeleteSel()"><i class="fa-solid fa-trash"></i> Delete'+(n?' ('+n+')':'')+'</button>'
      +'</div>'
    +'</div>'
    +(rows.length
      ? '<div class="mu-filters">'
          +'<div class="mu-sw"><i class="fa-solid fa-magnifying-glass"></i>'
            +'<input id="muQ" placeholder="Search position…" oninput="muFilter()"></div>'
          +'<select class="mu-sel" id="muDeptF" onchange="muFilter()"><option value="">All Departments</option>'
            +depts.map(function(d){return '<option>'+esc(d)+'</option>';}).join('')+'</select>'
          +'<select class="mu-sel" id="muApprF" onchange="muFilter()"><option value="">All</option>'
            +'<option value="Pending">To approve</option><option value="Approved">Approved</option><option value="Rejected">Rejected</option></select>'
          +'<select class="mu-sel" id="muHireF" onchange="muFilter()"><option value="">Open and closed</option>'
            +'<option value="Open">Still hiring</option><option value="Closed">Closed</option></select>'
          +'<span class="mu-count" id="muCount">'+rows.length+' position'+(rows.length===1?'':'s')+'</span>'
          +'<span class="mu-computed" style="margin-left:auto"><i class="fa-solid fa-circle-check"></i> Counted live from the Tracker</span>'
        +'</div>'
        +'<div class="mu-tbl-wrap"><table class="mu-tbl"><thead>'+head+'</thead><tbody id="muTbody">'+body+'</tbody></table>'
        +'<div id="muNoMatch" class="empty" style="display:none;padding:26px">No matches</div></div>'
      : '<div class="card card-pad empty"><i class="fa-regular fa-folder-open"></i>'
        +'<div style="font-weight:600;color:var(--ink)">Nothing in '+esc(muMonthLabel(MU_CUR))+' yet</div>'
        +'<p style="max-width:400px;margin:6px auto 0">Positions appear here from hiring requests.</p></div>');
}

/* Closing a position is what takes its page off the website. hr.public_position only answers for
   a requisition whose status is Open, so the moment this is closed thejaingroup.com/career/<slug>
   stops showing the role and says it is no longer open instead. Nothing else has to be changed and
   nothing has to be taken down by hand. */
function muHireCell(r,open,canAppr){
  if(!r.manpower_id) return '<span style="color:var(--slate-2)">—</span>';
  if(!r.has_description){
    return '<span class="tag t-gray" title="A position goes live once its job description is written">Not live</span>';
  }
  const live='<span class="tag t-green" title="'+esc('Live at /career/'+(r.slug||''))+'">Hiring</span>';
  const shut='<span class="tag t-gray" title="'+esc(r.closed_at?('Closed '+muWhen(r.closed_at)):'Closed')+'">Closed</span>';
  if(!canAppr) return open?live:shut;
  return '<span class="mu-hire-wrap">'+(open?live:shut)
    +'<button class="btn btn-sm" title="'+(open?'Close hiring — this takes the page off the website'
                                              :'Reopen hiring — the page goes back up')+'"'
    +' onclick="event.stopPropagation();muSetHiring('+r.manpower_id+','+(open?'false':'true')+')">'
    +'<i class="fa-solid fa-'+(open?'lock':'lock-open')+'"></i></button></span>';
}
function muWhen(ts){
  if(!ts) return '';
  try{ return new Date(ts).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
  catch(e){ return String(ts); }
}
window.muSetHiring=async function(manpowerId,open){
  if(!hrCan()){ toast('Only HR can open or close a position','err'); return; }
  const row=(MU_ROWS||[]).find(function(r){ return r.manpower_id===manpowerId; })||{};
  const who=row.position_title||'this position';
  const msg=open
    ? 'Reopen hiring for “'+who+'”? Its page goes back up on the website and candidates can apply again.'
    : 'Close hiring for “'+who+'”? Its page comes off the website immediately — anyone opening the '
      +'link will be told the position is no longer open. Everything already recorded is kept.';
  if(!await confirmDialog(msg, open
      ? {title:'Reopen hiring', okLabel:'Reopen', icon:'fa-lock-open', danger:false}
      : {title:'Close hiring',  okLabel:'Close',  icon:'fa-lock'})) return;
  try{
    const {error}=await sb.schema('hr').rpc('set_hiring_open',{p_manpower_id:manpowerId,p_open:open});
    if(error) throw error;
  }catch(e){ toast((e&&e.message)||String(e),'err'); return; }
  toast(open?'Hiring reopened — the page is live again':'Closed — the page is off the website','ok');
  MP_RECORDS=null;
  muRefresh();
};

window.muToggleAll=function(el){
  MU_SEL=new Set();
  document.querySelectorAll('#muTbody tr').forEach(function(tr){
    if(tr.style.display==='none') return;   // only what the filter is actually showing
    const cb=tr.querySelector('.mu-row-cb'); if(!cb) return;
    cb.checked=el.checked;
    tr.classList.toggle('mu-selected',el.checked);
    if(el.checked) MU_SEL.add(parseInt(cb.dataset.id,10));
  });
  muSyncDelBtn();
};
window.muRowCheck=function(cb){
  const id=parseInt(cb.dataset.id,10);
  if(cb.checked) MU_SEL.add(id); else MU_SEL.delete(id);
  const tr=cb.closest('tr'); if(tr) tr.classList.toggle('mu-selected',cb.checked);
  muSyncDelBtn();
};
function muSyncDelBtn(){
  const btn=$('muDelBtn'); if(!btn) return;
  const n=MU_SEL.size;
  btn.disabled=!n;
  btn.style.cssText=n?'':'opacity:.45;cursor:not-allowed;pointer-events:none';
  btn.innerHTML='<i class="fa-solid fa-trash"></i> Delete'+(n?' ('+n+')':'');
}
window.muFilter=function(){
  const q=(($('muQ')||{}).value||'').trim().toLowerCase();
  const dept=($('muDeptF')||{}).value||'';
  const appr=($('muApprF')||{}).value||'';
  const hire=($('muHireF')||{}).value||'';
  let shown=0;
  document.querySelectorAll('#muTbody tr').forEach(function(tr){
    const row=(MU_ROWS||[]).find(function(r){return String(r.row_id)===tr.dataset.id;})||{};
    let ok=true;
    if(q && (tr.dataset.pos||'').indexOf(q)===-1) ok=false;
    if(ok && dept && (tr.dataset.dept||'')!==dept) ok=false;
    if(ok && appr && (row.approval_status||'Pending')!==appr) ok=false;
    if(ok && hire){
      const isOpen=(row.hiring_status||'Open')==='Open';
      if(hire==='Open' ? !isOpen : isOpen) ok=false;
    }
    tr.style.display=ok?'':'none';
    if(ok) shown++;
  });
  const c=$('muCount'); if(c) c.textContent=shown+' position'+(shown===1?'':'s');
  const nm=$('muNoMatch'); if(nm) nm.style.display=shown?'none':'block';
};
window.muRefresh=function(){ MU_ROWS=null; MU_SEL=new Set(); hrMonthlyUpdate(); };

/* Deleting a row takes the POSITION out of this month. The candidates attached to it are the real
   record of what happened, so this is refused rather than cascading — move or remove the people
   first. The requisition itself is never deleted here. */
window.muDeleteSel=async function(){
  const ids=[...MU_SEL];
  if(!ids.length) return;
  if(!hrCan()){ toast('Only HR can change the Monthly Update','err'); return; }
  const picked=(MU_ROWS||[]).filter(function(r){return ids.indexOf(r.row_id)>-1;});
  const withPeople=picked.filter(function(r){return Number(r.candidate_total||0)>0;});
  if(withPeople.length){
    toast(withPeople.length===1
      ? '“'+(withPeople[0].position_title||'That position')+'” still has '+withPeople[0].candidate_total+' candidate(s) — remove them first'
      : withPeople.length+' of the selected positions still have candidates — remove them first','err');
    return;
  }
  const what=ids.length===1
    ? 'Remove “'+((picked[0]&&picked[0].position_title)||'this position')+'” from '+muMonthLabel(MU_CUR)+'?'
    : 'Remove '+ids.length+' positions from '+muMonthLabel(MU_CUR)+'?';
  if(!await confirmDialog(what+' The hiring request itself is not deleted.',
      {title:'Remove from month', okLabel:'Remove'})) return;
  const {error}=await sb.schema('hr').from('tracker_rows').delete().in('id',ids);
  if(error){ toast(error.message,'err'); return; }
  toast(ids.length===1?'Position removed':ids.length+' positions removed','ok');
  try{usageQueue('hr.monthly_update.delete_rows_or_whole_month','delete',{title:(ids.length===1?((picked[0]&&picked[0].position_title)||'1 position'):ids.length+' positions')+' — '+muMonthLabel(MU_CUR)});}catch(_e){}
  muRefresh();
};

/* Approve / Reject a fresh row. The decision is recorded against the REQUISITION, which is what the
   emailed one-click links act on as well, so both routes land in exactly the same place. */
window.muApprove=async function(manpowerId,ok){
  if(!manpowerId){ toast('This row has no hiring request behind it','err'); return; }
  if(!hrCan()){ toast('Only HR can approve a hiring request','err'); return; }
  const row=(MU_ROWS||[]).find(function(r){return r.manpower_id===manpowerId;})||{};
  const who=row.position_title||'this request';
  /* confirmDialog defaults to danger:true with the OK button labelled "Delete" - which turned the
     Approve prompt into a red delete warning. Both buttons are named for what they actually do. */
  const okd=await confirmDialog(
    (ok?'Approve the hiring request for “':'Reject the hiring request for “')+who+'”?',
    ok ? {title:'Approve hiring request', okLabel:'Approve', icon:'fa-circle-check', danger:false}
       : {title:'Reject hiring request',  okLabel:'Reject',  icon:'fa-circle-xmark', danger:true});
  if(!okd) return;
  const patch=ok
    ? {approval_status:'Approved', approved_by:state.email, approved_at:new Date().toISOString(), rejection_reason:null}
    : {approval_status:'Rejected', approved_by:state.email, approved_at:new Date().toISOString()};
  const {error}=await sb.schema('hr').from('manpower_requests').update(patch).eq('id',manpowerId);
  if(error){ toast(error.message,'err'); return; }
  toast(ok?'Approved':'Rejected','ok');
  MP_RECORDS=null;          // the Recruitment ManPower list shows the same status
  muRefresh();
};

window.muReload=function(){ MU_MONTHS_CACHE=null; MU_ROWS=null; MU_CUR=null; MU_SEL=new Set(); if(PAGE==='hr')renderPage(); };

/* Preview opens the CV in a tab; Download saves it under the candidate's own name rather than the
   stamped storage filename. Both go through s3OpenSigned, which mints a short-lived signed URL -
   the bucket itself stays private, exactly as it does for the Resumes tab. */
function trResumeCell(r){
  const cv=r.candidate_id?(window._trResume||{})[r.candidate_id]:null;
  if(!cv||!cv.storage_path) return '<span style="color:var(--slate-2)">—</span>';
  const nm=(r.candidate_name||'Candidate').replace(/[^A-Za-z0-9 .()-]/g,'').trim()||'Candidate';
  const ext=String(cv.file_name||'').split('.').pop().toLowerCase();
  const dl=nm+' - CV'+(ext&&ext.length<=5?'.'+ext:'');
  return '<span style="display:inline-flex;gap:4px">'
    +'<button class="btn btn-sm" title="Preview the CV" onclick="trResumeOpen('+r.id+',0)"><i class="fa-regular fa-eye"></i></button>'
    +'<button class="btn btn-sm" title="Download the CV" onclick="trResumeOpen('+r.id+',1,&quot;'+esc(dl)+'&quot;)"><i class="fa-solid fa-download"></i></button>'
    +'</span>';
}
window.trResumeOpen=function(trackerId,download,name){
  const r=(window._trRows||[]).find(function(x){return x.id===trackerId;});
  const cv=r&&r.candidate_id?(window._trResume||{})[r.candidate_id]:null;
  if(!cv||!cv.storage_path){ toast('No CV on this row','err'); return; }
  s3OpenSigned(cv.storage_path, download?(name||'CV'):null);
};

/* ── Interview Tracker ── */
async function hrTracker(){
  const b=$('hrBody');
  loader(b);
  let rows=[];
  try{const {data}=await sb.schema('hr').from('interview_tracker').select('*').order('id',{ascending:false});rows=data||[];}catch(e){}
  /* The CV for each row. interview_tracker does not hold one - the candidate does - so the resumes
     are fetched in a single follow-up query keyed on the candidates actually on screen, rather than
     one request per row. Applications from the careers pages arrive with a CV already attached;
     rows typed in by hand simply have none. */
  window._trResume={};
  const candIds=[...new Set(rows.map(function(r){return r.candidate_id;}).filter(Boolean))];
  if(candIds.length){
    try{
      const {data}=await sb.schema('hr').from('candidates')
        .select('id,resume_id,resumes(id,file_name,storage_path)').in('id',candIds);
      (data||[]).forEach(function(c){ if(c&&c.resumes) window._trResume[c.id]=c.resumes; });
    }catch(e){/* the column just shows a dash */}
  }
  window._trRows=rows;
  window._trSel=new Set();
  const fbTag=s=>{
    const m={'Shortlisted':'tr-green','Selected':'tr-green','Rejected':'tr-red','No Show':'tr-gray','Pending':'tr-amber','Hold':'tr-amber'};
    return s?`<span class="tr-tag tr-tag--${(m[s]||'tr-amber').replace('tr-','')}">${esc(s)}</span>`:'';
  };
  const cel=v=>v?esc(v):'';
  b.innerHTML=`
    <style>
      .tr-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}
      .tr-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0}
      .tr-filters{display:flex;gap:8px;align-items:center;margin-left:auto;flex-wrap:wrap;min-width:0}
      .tr-sw{position:relative;display:flex;align-items:center;min-width:0}
      .tr-sw i{position:absolute;left:10px;color:var(--slate);font-size:12px;pointer-events:none}
      .tr-sw input{padding-left:28px;height:36px;min-width:190px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:var(--bg-card);color:var(--ink)}
      .tr-sw input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
      select.tr-sel{height:36px;padding:0 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:var(--bg-card);color:var(--ink);min-width:140px;cursor:pointer}
      select.tr-sel:focus{outline:none;border-color:var(--brand)}
      .tr-count{font-size:12.5px;color:var(--slate);white-space:nowrap;padding:0 2px}
      .tr-tag{display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:600;white-space:nowrap}
      .tr-tag--green{background:#d1fae5;color:#065f46}
      .tr-tag--red{background:#fee2e2;color:#991b1b}
      .tr-tag--gray{background:#f1f5f9;color:#475569}
      .tr-tag--amber{background:#fef3c7;color:#92400e}
      #trTbl{width:100%;border-collapse:collapse;font-size:13.5px;min-width:1580px;table-layout:fixed}
      #trTbl thead th{background:var(--bg-subtle,#f8fafc);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--slate);padding:11px 14px;border-bottom:2px solid var(--line);text-align:left;white-space:normal;word-break:break-word;vertical-align:bottom}
      #trTbl tbody tr{border-bottom:1px solid var(--line-2);transition:background .12s}
      #trTbl tbody tr:hover{background:var(--bg-hover,#f8fafc)}
      #trTbl tbody tr.tr-selected{background:#eff6ff}
      #trTbl tbody td{padding:12px 14px;vertical-align:middle;white-space:normal;word-break:break-word;overflow-wrap:anywhere;line-height:1.4}
      #trTbl td.tr-nowrap,#trTbl th.tr-nowrap{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .tr-cb{width:16px;height:16px;cursor:pointer;accent-color:var(--brand)}
      @media(max-width:900px){
        .tr-toolbar{flex-direction:column;align-items:stretch}
        .tr-actions{width:100%}
        .tr-actions .btn{flex:1 1 auto;justify-content:center}
        .tr-count{width:100%;text-align:center;order:99}
        .tr-filters{margin-left:0;width:100%}
        .tr-sw{width:100%}
        .tr-sw input{min-width:0;width:100%}
        select.tr-sel{min-width:0;width:100%}
        #trTbl{min-width:1400px;font-size:13px}
        #trTbl thead th,#trTbl tbody td{padding:9px 10px}
      }
    </style>
    <div class="tr-toolbar">
      <div class="tr-actions">
        <button class="btn btn-primary" onclick="trackerCreate()"><i class="fa-solid fa-plus"></i> Add</button>
        <button class="btn" id="trEditBtn" onclick="trackerEditSel()" disabled style="opacity:.45"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn" id="trDelBtn" onclick="trackerDeleteSel()" disabled style="opacity:.45;color:var(--err);border-color:var(--err)"><i class="fa-solid fa-trash"></i> Delete</button>
        <span class="tr-count" id="trCount">${rows.length} entries</span>
      </div>
      <div class="tr-filters">
        <div class="tr-sw"><i class="fa-solid fa-magnifying-glass"></i><input id="trQ" placeholder="Search name, position…" oninput="trackerFilter()"></div>
        <select class="tr-sel" id="trFbF" onchange="trackerFilter()">
          <option value="">All Feedback</option>
          <option>Shortlisted</option><option>Selected</option><option>Rejected</option><option>No Show</option><option>Hold</option>
        </select>
        <select class="tr-sel" id="trEntityF" onchange="trackerFilter()">
          <option value="">All Entities</option>
          ${[...new Set(rows.map(r=>r.entity).filter(Boolean))].sort().map(e=>`<option>${esc(e)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="card" style="overflow:hidden">
      <div style="overflow-x:auto">
      <table id="trTbl">
        <thead><tr>
          <th class="tr-nowrap" style="width:36px"><input type="checkbox" class="tr-cb" id="trChkAll" onchange="trToggleAll(this)"></th>
          <th style="width:14%">Candidate</th><th style="width:11%">Position</th><th style="width:9%">Source</th><th style="width:9%">Entity</th><th class="tr-nowrap" style="width:12%">Phone</th><th style="width:14%">Email</th><th class="tr-nowrap" style="width:14%">Date & Time</th><th class="tr-nowrap" style="width:11%">Feedback</th><th class="tr-nowrap" style="width:9%">Resumes</th><th style="width:14%">Notes</th>
        </tr></thead>
        <tbody id="trTbody">
          ${rows.length?rows.map(r=>`<tr data-id="${r.id}" data-name="${esc((r.candidate_name||'').toLowerCase())}" data-pos="${esc((r.position||'').toLowerCase())}" data-fb="${esc(r.feedback||'')}" data-entity="${esc((r.entity||'').toLowerCase())}">
            <td class="tr-nowrap"><input type="checkbox" class="tr-cb tr-row-cb" data-id="${r.id}" onchange="trRowCheck(this)"></td>
            <td style="font-weight:600">${cel(r.candidate_name)}</td>
            <td style="color:var(--slate)">${cel(r.position)}</td>
            <td style="font-size:12px;color:var(--slate)">${cel(r.source)}</td>
            <td style="font-size:12px">${cel(r.entity)}</td>
            <td class="tr-nowrap" style="font-family:monospace;font-size:12px">${cel(r.number)}</td>
            <td style="font-size:12px">${r.email?`<a href="mailto:${esc(r.email)}" onclick="hrTrackerMailed(${esc(JSON.stringify(r.candidate_name||''))})" style="color:var(--brand)">${esc(r.email)}</a>`:''}</td>
            <td class="tr-nowrap" style="font-size:12px;color:var(--slate)">${cel(r.scheduled_date)}</td>
            <td class="tr-nowrap">${fbTag(r.feedback)}</td>
            <td class="tr-nowrap">${trResumeCell(r)}</td>
            <td style="font-size:12px;color:var(--slate)">${cel(r.notes)}</td>
          </tr>`).join(''):'<tr><td colspan="11"><div class="empty" style="padding:32px"><i class="fa-regular fa-calendar"></i><div style="font-weight:600;color:var(--ink)">No interviews yet</div><p>Click <b>Add</b> to schedule the first interview.</p></div></td></tr>'}
        </tbody>
      </table>
      </div>
    </div>`;
}
window.hrTrackerMailed=function(nm){
  usageQueue('hr.interview_tracker.email_candidate_from_list','view',{title:nm||undefined});
};
window.trRowCheck=function(cb){
  const id=Number(cb.dataset.id);
  if(cb.checked)window._trSel.add(id);else window._trSel.delete(id);
  cb.closest('tr').classList.toggle('tr-selected',cb.checked);
  trUpdateToolbar();
};
window.trToggleAll=function(master){
  document.querySelectorAll('.tr-row-cb').forEach(cb=>{
    const tr=cb.closest('tr');if(tr.style.display==='none')return;
    cb.checked=master.checked;
    const id=Number(cb.dataset.id);
    if(master.checked)window._trSel.add(id);else window._trSel.delete(id);
    tr.classList.toggle('tr-selected',master.checked);
  });
  trUpdateToolbar();
};
window.trUpdateToolbar=function(){
  const n=window._trSel.size;
  const e=$('trEditBtn'),d=$('trDelBtn');
  if(e){e.disabled=(n!==1);e.style.opacity=(n===1)?'1':'.45';}
  if(d){d.disabled=(n===0);d.style.opacity=(n>0)?'1':'.45';}
};
window.trackerFilter=function(){
  const q=($('trQ').value||'').toLowerCase();
  const fb=$('trFbF').value;
  const ent=$('trEntityF').value.toLowerCase();
  let vis=0;
  document.querySelectorAll('#trTbody tr[data-id]').forEach(tr=>{
    const nm=tr.dataset.name||'',pos=tr.dataset.pos||'',f=tr.dataset.fb||'',e=tr.dataset.entity||'';
    const show=(!q||(nm.includes(q)||pos.includes(q)))&&(!fb||f===fb)&&(!ent||e===ent);
    tr.style.display=show?'':'none';if(show)vis++;
    if(!show&&tr.querySelector('.tr-row-cb').checked){
      tr.querySelector('.tr-row-cb').checked=false;
      window._trSel.delete(Number(tr.dataset.id));
      tr.classList.remove('tr-selected');
    }
  });
  const c=$('trCount');if(c)c.textContent=vis+' entries';
  trUpdateToolbar();
  usageQueueDebounced('hr.interview_tracker.search_filter_interviews', q);
};
window.trackerCreate=function(){
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-calendar-check"></i> Schedule Interview</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <div class="two"><div><label>Candidate Name *</label><input id="trFName" class="sel" placeholder="Full name"></div>
    <div><label>Position *</label><input id="trFPos" class="sel" placeholder="e.g. Sales Executive"></div></div>
    <div class="two"><div><label>Entity</label><input id="trFEntity" class="sel" placeholder="e.g. Rajanya, Zainab"></div>
    <div><label>Source</label><input id="trFSrc" class="sel" placeholder="e.g. Naukri, Apna, Referral"></div></div>
    <div class="two"><div><label>Interview Date</label><input id="trFDate" class="sel" type="date"></div>
    <div><label>Interview Time</label><input id="trFTime" class="sel" type="time"></div></div>
    <div class="two"><div><label>Phone</label><input id="trFNum" class="sel" placeholder="10-digit number"></div>
    <div><label>Email</label><input id="trFEmail" class="sel" type="email" placeholder="candidate@email.com"></div></div>
    <div class="two"><div><label>Feedback</label><select id="trFFb" class="sel">
      <option value="">— Select —</option><option>Shortlisted</option><option>Selected</option><option>Rejected</option><option>No Show</option><option>Hold</option>
    </select></div>
    <div><label>Notes</label><input id="trFNotes" class="sel" placeholder="Any remarks (optional)"></div></div>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="trSaveBtn" onclick="trackerSave()"><i class="fa-solid fa-check"></i> Save</button></div>`);
};
function trDateStr(){
  const d=($('trFDate').value||'').trim(),t=($('trFTime').value||'').trim();
  if(d&&t){const [y,mo,dy]=d.split('-');const [h,mi]=t.split(':');const hr=parseInt(h);const ampm=hr>=12?'PM':'AM';const h12=hr%12||12;return `${parseInt(dy)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo)-1]}, ${y} @ ${h12}:${mi} ${ampm}`;}
  if(d){const [y,mo,dy]=d.split('-');return `${parseInt(dy)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo)-1]}, ${y}`;}
  return '';
}
window.trackerSave=async function(){
  const name=($('trFName').value||'').trim(),pos=($('trFPos').value||'').trim();
  if(!name||!pos){toast('Name and position required','err');return;}
  const btn=$('trSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const dateStr=trDateStr();
  const fb=($('trFFb').value||'').trim();
  const notes=($('trFNotes').value||'').trim();
  const {error}=await sb.schema('hr').from('interview_tracker').insert({
    candidate_name:name,position:pos,entity:($('trFEntity').value||'').trim()||null,
    source:($('trFSrc').value||'').trim()||null,scheduled_date:dateStr||null,
    number:($('trFNum').value||'').trim()||null,email:($('trFEmail').value||'').trim()||null,
    feedback:fb||null,notes:notes||null
  });
  if(error){toast('Could not save: '+error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Save';}return;}
  closeModal();toast('Interview scheduled','ok');hrTracker();
};
window.trackerEditSel=function(){
  const sel=[...window._trSel];
  if(sel.length===0){toast('Select a row first','err');return;}
  if(sel.length>1){toast('Select only one entry to edit','err');return;}
  const r=(window._trRows||[]).find(x=>x.id===sel[0]);if(!r)return;
  // Parse date back for input
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Edit Interview</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <div class="two"><div><label>Candidate Name *</label><input id="trFName" class="sel" value="${esc(r.candidate_name||'')}"></div>
    <div><label>Position *</label><input id="trFPos" class="sel" value="${esc(r.position||'')}"></div></div>
    <div class="two"><div><label>Entity</label><input id="trFEntity" class="sel" value="${esc(r.entity||'')}"></div>
    <div><label>Source</label><input id="trFSrc" class="sel" value="${esc(r.source||'')}"></div></div>
    <div class="two"><div><label>Date & Time (text)</label><input id="trFDateTxt" class="sel" value="${esc(r.scheduled_date||'')}" placeholder="e.g. 15 Jul, Tuesday @ 3 PM"></div>
    <div><label>Phone</label><input id="trFNum" class="sel" value="${esc(r.number||'')}"></div></div>
    <div class="two"><div><label>Email</label><input id="trFEmail" class="sel" value="${esc(r.email||'')}"></div>
    <div><label>Feedback</label><select id="trFFb" class="sel">
      <option value="">— Select —</option>${['Shortlisted','Selected','Rejected','No Show','Hold'].map(s=>`<option ${r.feedback===s?'selected':''}>${s}</option>`).join('')}
    </select></div></div>
    <div><label>Notes</label><input id="trFNotes" class="sel" value="${esc(r.notes||'')}" placeholder="Any remarks (optional)"></div>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="trSaveBtn" onclick="trackerUpdate(${r.id})"><i class="fa-solid fa-check"></i> Update</button></div>`);
};
window.trackerUpdate=async function(id){
  const name=($('trFName').value||'').trim(),pos=($('trFPos').value||'').trim();
  if(!name||!pos){toast('Name and position required','err');return;}
  const btn=$('trSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const {error}=await sb.schema('hr').from('interview_tracker').update({
    candidate_name:name,position:pos,entity:($('trFEntity').value||'').trim()||null,
    source:($('trFSrc').value||'').trim()||null,scheduled_date:($('trFDateTxt').value||'').trim()||null,
    number:($('trFNum').value||'').trim()||null,email:($('trFEmail').value||'').trim()||null,
    feedback:($('trFFb').value||'')||null,notes:($('trFNotes').value||'').trim()||null
  }).eq('id',id);
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Update';}return;}
  closeModal();toast('Updated','ok');hrTracker();
};
window.trackerDeleteSel=async function(){
  const sel=[...window._trSel];if(!sel.length)return;
  if(!await confirmDialog(`Delete ${sel.length} entr${sel.length>1?'ies':'y'}?`))return;
  const {error}=await sb.schema('hr').from('interview_tracker').delete().in('id',sel);
  if(error){toast(error.message,'err');return;}
  toast(sel.length>1?`${sel.length} entries deleted`:'Entry deleted','ok');
  hrTracker();
};
window.trackerDelete=async function(id){
  if(!await confirmDialog('Delete this entry?'))return;
  const {error}=await sb.schema('hr').from('interview_tracker').delete().eq('id',id);
  if(error){toast(error.message,'err');return;}
  toast('Deleted','ok');hrTracker();
};

/* ── AI edge function helper (shared by Resumes + Interview Qs) ── */
async function resumeAI(payload){
  const {data:{session}}=await sb.auth.getSession();
  const token=session&&session.access_token;
  const res=await fetch(SUPABASE_URL+'/functions/v1/resume-ai',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
    body:JSON.stringify(payload)
  });
  const out=await res.json().catch(()=>({}));
  if(!res.ok||out.error)throw new Error(out.error||('resume-ai '+res.status));
  return out;
}

/* ── Resumes (AI-parsed resume bank) ── */
let RS_ROWS=null, RS_SEARCH=null, RS_SEL=new Set(), RS_Q='';
async function hrResumes(){
  const b=$('hrBody');loader(b);
  try{const {data,error}=await sb.schema('hr').from('resumes').select('*').order('created_at',{ascending:false});if(error)throw error;RS_ROWS=data||[];}
  catch(e){b.innerHTML='<div class="empty" style="padding:40px;color:var(--err)">'+esc(e.message)+'</div>';return;}
  RS_SEARCH=null;RS_SEL=new Set();RS_Q='';
  rsRender();
}
/* Resumes is a filing cabinet, not an analyser. The AI reading was never asked for and never
   finished - rows sat on "Analyzing..." for ever because nothing retried a failed call - so it is
   gone entirely. What a row shows now is what the file actually is. */
function rsCard(r){
  const who=r.candidate_name||r.file_name||'Unnamed';
  const bits=[];
  if(r.file_name&&r.candidate_name) bits.push(r.file_name);
  if(r.file_size) bits.push(rsSize(r.file_size));
  if(r.created_at) bits.push(rsWhen(r.created_at));
  return `<div class="card rs-card" onclick="rsOpenDetail(${r.id})">
    <input type="checkbox" class="rs-chk" value="${r.id}" ${RS_SEL.has(r.id)?'checked':''} onclick="event.stopPropagation()" onchange="rsSyncToolbar()">
    <div class="avatar-sm rs-card-avatar" style="background:${colorFor(who)}">${esc(initials(who).toUpperCase())}</div>
    <div class="rs-card-body">
      <div class="rs-card-name">${esc(who)}</div>
      <div class="rs-card-sub">${esc(bits.join(' · ')||'—')}</div>
    </div>
    <span class="rs-card-eye" style="display:inline-flex;gap:4px" onclick="event.stopPropagation()">
      <button class="btn btn-sm btn-ghost" title="Preview" onclick="rsPreview(${r.id})"><i class="fa-regular fa-eye"></i></button>
      <button class="btn btn-sm btn-ghost" title="Download" onclick="rsDownload(${r.id})"><i class="fa-solid fa-download"></i></button>
    </span>
  </div>`;
}
function rsSize(n){
  n=Number(n)||0;
  return n<1024?n+' B':n<1048576?(n/1024).toFixed(0)+' KB':(n/1048576).toFixed(1)+' MB';
}
function rsWhen(ts){
  try{ return new Date(ts).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
  catch(e){ return ''; }
}
function rsRender(){
  const b=$('hrBody');if(!b)return;
  const rows=RS_SEARCH?RS_SEARCH:(RS_ROWS||[]);
  const dis='opacity:.38;cursor:not-allowed;pointer-events:none';
  b.innerHTML=`<div class="rs-toolbar-row">
    <div class="sec-title" style="margin:0">Resume Bank <span class="tag t-gray" style="margin-left:4px">${(RS_ROWS||[]).length}</span></div>
    <div class="rs-toolbar-actions">
      <button class="btn btn-primary" onclick="rsUploadModal()"><i class="fa-solid fa-upload"></i> Upload Resume</button>
      <button class="btn" id="rsDlBtn" disabled style="${dis}" onclick="rsBulkDownload()"><i class="fa-solid fa-download"></i> Download</button>
      <button class="btn" id="rsDelBtn" disabled style="${dis};color:var(--err);border-color:var(--err)" onclick="rsBulkDelete()"><i class="fa-solid fa-trash"></i> Delete</button>
    </div>
  </div>
  <div class="card card-pad rs-ai-card">
    <label class="rs-ai-label"><i class="fa-solid fa-magnifying-glass" style="color:var(--slate)"></i> Find a resume</label>
    <div class="rs-ai-row">
      <input id="rsQ" class="rs-ai-input" placeholder="Name or file name…" value="${esc(RS_Q||'')}" oninput="rsFilter(this.value)">
      ${RS_Q?'<button class="btn" onclick="rsClearFilter()"><i class="fa-solid fa-xmark"></i> Clear</button>':''}
    </div>
  </div>
  <div id="rsList" class="grid rs-list">${rows.length?rows.map(r=>rsCard(r)).join(''):'<div class="empty" style="padding:40px;grid-column:1/-1"><i class="fa-solid fa-id-card-clip"></i><div>No resumes yet — click Upload Resume</div></div>'}</div>`;
  rsSyncToolbar();
}
window.rsSyncToolbar=function(){
  const sel=[...document.querySelectorAll('.rs-chk:checked')];
  RS_SEL=new Set(sel.map(c=>parseInt(c.value)));
  const n=RS_SEL.size;
  const dl=$('rsDlBtn'),del=$('rsDelBtn');
  const dis='opacity:.38;cursor:not-allowed;pointer-events:none';
  if(dl){dl.disabled=n===0;dl.style.cssText=n>0?'':dis;dl.innerHTML='<i class="fa-solid fa-download"></i> Download'+(n?' ('+n+')':'');}
  if(del){del.disabled=n===0;del.style.cssText=n>0?'color:var(--err);border-color:var(--err)':dis+';color:var(--err);border-color:var(--err)';del.innerHTML='<i class="fa-solid fa-trash"></i> Delete'+(n?' ('+n+')':'');}
};
window.rsBulkDownload=async function(){
  for(const id of RS_SEL){ await rsDownload(id); }
};
window.rsBulkDelete=async function(){
  if(!RS_SEL.size)return;
  const ids=[...RS_SEL];
  if(!await confirmDialog(
      'Delete '+ids.length+' CV'+(ids.length===1?'':'s')+' permanently? Where somebody is still '
      +'waiting to be approved on the strength of one, their approval task is cancelled too.',
      {title:'Delete CV'+(ids.length===1?'':'s'), okLabel:'Delete', icon:'fa-trash', danger:true}))return;
  // One call, so the whole set succeeds or fails together instead of half-deleting on an error.
  const {data,error}=await sb.schema('hr').rpc('resume_delete',{p_ids:ids});
  if(error){toast('Could not delete: '+error.message,'err');return;}
  await hrRemoveFiles(data);
  RS_ROWS=(RS_ROWS||[]).filter(x=>!RS_SEL.has(x.id));
  if(RS_SEARCH)RS_SEARCH=(RS_SEARCH||[]).filter(x=>!RS_SEL.has(x.id));
  RS_SEL=new Set();
  toast(ids.length+' deleted','ok');rsRender();
};
function rsDetailRow(label,html){
  if(!html)return '';
  return `<div style="margin-bottom:14px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--slate);font-weight:700;margin-bottom:4px">${label}</div><div style="font-size:13.5px;color:var(--ink);line-height:1.6">${html}</div></div>`;
}
window.rsOpenDetail=function(id){
  const r=(RS_ROWS||[]).find(x=>x.id===id);
  if(!r)return;
  /* What is actually known about the file, and nothing inferred. The AI-extracted columns
     (role_title, skills, strengths and the rest) are left in the table but no longer read -
     removing the analysis was the point, not rewriting the schema. */
  const who=r.candidate_name||r.file_name||'Unnamed';
  const contact=[r.email,r.phone].filter(Boolean).map(esc).join(' · ');
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-id-card-clip"></i> Resume</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body">
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:18px">
      <div class="avatar-sm" style="width:52px;height:52px;font-size:18px;background:${colorFor(who)}">${esc(initials(who).toUpperCase())}</div>
      <div>
        <div style="font-weight:700;font-size:17px">${esc(who)}</div>
        <div style="color:var(--slate);font-size:13px">${esc(r.file_name||'')}</div>
      </div>
    </div>
    ${rsDetailRow('Contact',contact)}
    ${rsDetailRow('File',esc([r.file_type?String(r.file_type).toUpperCase():'',r.file_size?rsSize(r.file_size):''].filter(Boolean).join(' · ')))}
    ${rsDetailRow('Uploaded',esc([rsWhen(r.created_at),r.uploaded_by].filter(Boolean).join(' · ')))}
  </div>
  <div class="modal-foot">
    <button class="btn" onclick="closeModal()">Close</button>
    <button class="btn" onclick="rsDownload(${r.id})"><i class="fa-solid fa-download"></i> Download</button>
    <button class="btn btn-primary" onclick="rsPreview(${r.id})"><i class="fa-regular fa-eye"></i> Preview</button>
  </div>`);
};

/* Was an AI search that sent every resume's text to a model to rank them. Now a plain filter over
   what is already loaded: no request, no cost, instant, and it cannot fail. */
window.rsFilter=function(q){
  RS_Q=String(q||'');
  const t=RS_Q.trim().toLowerCase();
  RS_SEARCH=t?(RS_ROWS||[]).filter(function(r){
    return String(r.candidate_name||'').toLowerCase().indexOf(t)>-1
        || String(r.file_name||'').toLowerCase().indexOf(t)>-1
        || String(r.email||'').toLowerCase().indexOf(t)>-1;
  }):null;
  rsRender();
  // rsRender rebuilds the box, so put the caret back where the person left it
  const el=$('rsQ'); if(el){ el.focus(); el.setSelectionRange(el.value.length,el.value.length); }
};
window.rsClearFilter=function(){ rsFilter(''); };
/* THE OPEN POSITIONS, WHICH IS WHAT A CV CAN BE UPLOADED AGAINST.
   Written up and still Open: a position with no job description is not a vacancy yet - there is
   nothing to advertise and nothing for a CV to be judged against - and a closed one is not a
   vacancy any more, so neither should be able to collect CVs. The same rule is in the database
   (hr.open_positions, hr.public_position), so the portal and the website cannot disagree. */
async function hrOpenPositions(){
  const {data,error}=await sb.schema('hr').from('manpower_requests')
    .select('id,job_title,department')
    .not('ai_job_description_json','is',null).eq('status','Open')
    .order('job_title',{ascending:true});
  if(error) throw error;
  return data||[];
}

/* UPLOADING A CV NOW REQUIRES SAYING WHICH JOB IT IS FOR, and takes as many files as you like for
   that one job.

   ONE position, never several. Letting a CV be filed against two vacancies at once sounds generous
   and makes every later count wrong: the same person appears twice in the funnel, Monthly Progress
   over-reports, and nobody can say which role they were actually being considered for. If somebody
   genuinely suits two roles, that is two decisions made by a person, not one upload pretending to
   be both.

   preselectId lets Monthly Progress open this window with its own position already chosen and
   locked, so uploading from a position's row cannot land the files on a different one. */
window.rsUploadModal=async function(preselectId){
  let positions=[];
  try{ positions=await hrOpenPositions(); }
  catch(e){ toast('Could not read the open positions: '+((e&&e.message)||e),'err'); return; }

  if(!positions.length){
    openModal('<div class="modal-head"><h3><i class="fa-solid fa-upload"></i> Upload CVs</h3><span class="x" onclick="closeModal()">&times;</span></div>'
      +'<div class="modal-body frm"><div style="padding:18px;text-align:center;color:var(--slate);font-size:13.5px">'
      +'There are no open positions to upload against yet.<br><br>'
      +'A position appears here once its job description has been written and it is still open.'
      +'</div></div>'
      +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>');
    return;
  }

  const locked=preselectId!=null&&positions.some(function(x){return String(x.id)===String(preselectId);});
  const opts=positions.map(function(x){
    return '<option value="'+x.id+'"'+(String(x.id)===String(preselectId)?' selected':'')+'>'
      +esc(x.job_title||'Untitled')+(x.department?(' \u00b7 '+esc(x.department)):'')+'</option>';
  }).join('');

  openModal('<div class="modal-head"><h3><i class="fa-solid fa-upload"></i> Upload CVs</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm">'
    +'<label>Position <span style="color:var(--err)">*</span></label>'
    +'<select id="rsPos" class="sel"'+(locked?' disabled style="background:#f1f5f9;color:var(--slate)"':'')+'>'
    +(locked?'':'<option value="">\u2014 Choose the position these CVs are for \u2014</option>')
    +opts+'</select>'
    +(locked?'<div style="font-size:11.5px;color:var(--slate);margin-top:4px">Uploading for this position.</div>':'')
    +'<label>Files</label>'
    +'<div class="dropzone" onclick="document.getElementById(\'rsFile\').click()"><i class="fa-solid fa-cloud-arrow-up"></i><div id="rsFName">Click to choose one or more PDFs, Word docs, or images</div></div>'
    +'<input type="file" id="rsFile" class="hidden" multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onchange="rsFilesPicked(this)">'
    +'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>'
    +'<button class="btn btn-primary" id="rsUpBtn" onclick="rsUploadSave()"><i class="fa-solid fa-upload"></i> Upload</button></div>');
};
window.rsFilesPicked=function(el){
  const lbl=document.getElementById('rsFName'); if(!lbl)return;
  const k=el&&el.files?el.files.length:0;
  lbl.textContent=k?(k===1?el.files[0].name:(k+' files chosen')):'Click to choose one or more PDFs, Word docs, or images';
};
window.rsUploadSave=async function(){
  const sel=$('rsPos');
  const posId=sel?String(sel.value||'').trim():'';
  if(!posId){ toast('Choose which position these CVs are for','err'); if(sel)sel.focus(); return; }
  const posText=(sel&&sel.selectedOptions&&sel.selectedOptions[0])
    ? String(sel.selectedOptions[0].textContent||'').split(' \u00b7 ')[0].trim() : '';

  const fEl=$('rsFile');
  const files=(fEl&&fEl.files)?Array.prototype.slice.call(fEl.files):[];
  if(!files.length){ toast('Choose at least one file','err'); return; }

  const btn=$('rsUpBtn'); if(btn){btn.disabled=true;}
  /* One at a time, and one failure does not lose the rest. Uploading ten CVs and being told only
     that "the upload failed" - with no way to know which of the ten landed - is the outcome worth
     avoiding here, so each file is reported by name. */
  const added=[]; const failed=[];
  for(let i=0;i<files.length;i++){
    const f=files[i];
    if(btn) btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading '+(i+1)+' of '+files.length+'\u2026';
    try{
      const up=await uploadFileToS3(s3KeyForResume(f.name),f);
      if(up.error) throw new Error(up.error.message);
      const {data:row,error}=await sb.schema('hr').from('resumes').insert({
        file_name:f.name, storage_path:up.data.path, file_size:f.size,
        file_type:(f.name.split('.').pop()||'').toLowerCase(), ai_status:'analyzing',
        manpower_request_id:Number(posId), position:posText||null,
        uploaded_by:state.email||null
      }).select().single();
      if(error) throw new Error(error.message);
      added.push(row);
    }catch(e){ failed.push(f.name+' ('+((e&&e.message)||e)+')'); }
  }
  if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-upload"></i> Upload';}

  if(added.length){
    closeModal();
    RS_ROWS=added.slice().reverse().concat(RS_ROWS||[]);
    toast(added.length+' CV'+(added.length===1?'':'s')+' uploaded for '+(posText||'this position'),'ok');
    if(RS_Q) rsFilter(RS_Q); else rsRender();
    /* READING THE CVs HAPPENS AFTER THE UPLOAD IS SAFE, AND NEVER BLOCKS IT.

       The files are stored and the rows exist before a single word is read, so a model being slow,
       rate-limited or wrong cannot cost somebody their upload - the worst case is a row that says
       it could not be read, with the file still there to open by hand.

       One at a time rather than all at once: ten CVs fired in parallel is ten concurrent calls,
       and being rate-limited halfway leaves half the batch unread for no reason. */
    rsParseUploaded(added.map(function(r){return r.id;}));
  }
  if(failed.length) toast('Could not upload: '+failed.slice(0,3).join(', ')+(failed.length>3?(' and '+(failed.length-3)+' more'):''),'err');
};

/* ONLY CVs UPLOADED HERE ARE READ BY THE MODEL.

   A referral's CV and a careers-page application arrive with the name, email and phone already
   typed by the person who sent them, and that is better evidence than anything read off a
   document - overwriting a name somebody entered by hand with a model's reading of a scan is a
   downgrade, not an improvement. Those paths go through hr.referral_submit and career-apply and
   never come near this. */
async function rsParseUploaded(ids){
  if(!ids||!ids.length)return;
  let done=0, failed=0;
  /* WHAT HAPPENED TO EACH CV, NOT JUST HOW MANY WERE READ.
     Matching on email correctly refuses to create a second copy of somebody already here, so
     nothing new appears in Interviews - and from the outside that is indistinguishable from the
     upload having failed. Three uploads of the same CV looked like three failures. Counted apart
     so each outcome can be said in its own words. */
  const matched=[], notLinked=[];
  for(const id of ids){
    try{
      const {data,error}=await sb.functions.invoke('resume-ai',{body:{action:'parse_resume',resume_id:id}});
      if(error||(data&&data.error)) throw new Error((data&&data.error)||error.message);
      /* The list is updated in place so the row fills in where somebody is already looking,
         instead of only after a refresh. */
      const row=(RS_ROWS||[]).find(r=>r.id===id);
      if(row&&data&&data.profile) Object.assign(row,data.profile);
      done++;
      const L=data&&data.linked;
      if(L&&L.ok===false&&L.reason){
        notLinked.push(((row&&row.candidate_name)||(row&&row.file_name)||'A CV')+' — '+L.reason);
      }else if(L&&L.matched){
        matched.push((row&&row.candidate_name)||'That person');
      }
    }catch(e){
      failed++;
      const row=(RS_ROWS||[]).find(r=>r.id===id);
      if(row){ row.ai_status='failed'; row.ai_error=String((e&&e.message)||e).slice(0,300); }
    }
    if(RS_Q) rsFilter(RS_Q); else rsRender();
  }
  const added=done-matched.length-notLinked.length;
  if(added>0) toast(added+' CV'+(added===1?'':'s')+' read \u2014 added to Interviews','ok');
  if(matched.length) toast(matched.slice(0,3).join(', ')+(matched.length>3?(' and '+(matched.length-3)+' more'):'')
    +' '+(matched.length===1?'is':'are')+' already in Interviews \u2014 the CV was added to their record','warn');
  if(notLinked.length) toast(notLinked.slice(0,2).join(' \u00b7 '),'warn');
  if(failed) toast(failed+' CV'+(failed===1?' could':'s could')+' not be read \u2014 the file is still there, open it to check','err');
}

/* Download keeps the candidate's own name on the file rather than the stamped storage name, the
   same as the Tracker's Resumes column does. */
window.rsDownload=function(id){
  const r=(RS_ROWS||[]).find(x=>x.id===id);
  if(!r||!r.storage_path){ toast('No file on this row','err'); return; }
  const base=(r.candidate_name||r.file_name||'Resume').replace(/[^A-Za-z0-9 .()-]/g,'').trim()||'Resume';
  const ext=String(r.file_name||'').split('.').pop().toLowerCase();
  s3OpenSigned(r.storage_path, base+(base.toLowerCase().endsWith('.'+ext)?'':(ext&&ext.length<=5?'.'+ext:'')));
};
async function rsGet(id){const {data}=await sb.schema('hr').from('resumes').select('*').eq('id',id).single();return data;}
window.rsPreview=async function(id){
  const r=await rsGet(id);if(!r||!r.storage_path){toast('No file attached','');return;}
  if(isS3Path(r.storage_path)){ await s3OpenSigned(r.storage_path); return; }
  const {data,error}=await sb.storage.from('resumes').createSignedUrl(r.storage_path,120);
  if(error){toast('Preview failed: '+error.message,'err');return;}
  window.open(data.signedUrl,'_blank');
};
window.rsDownload=async function(id){
  const r=await rsGet(id);if(!r||!r.storage_path){toast('No file attached','');return;}
  if(isS3Path(r.storage_path)){ await s3OpenSigned(r.storage_path,r.file_name||'download'); return; }
  const {data,error}=await sb.storage.from('resumes').createSignedUrl(r.storage_path,120,{download:r.file_name||true});
  if(error){toast('Download failed: '+error.message,'err');return;}
  const a=document.createElement('a');a.href=data.signedUrl;a.download=r.file_name||'';document.body.appendChild(a);a.click();a.remove();
};
/* A database call can delete a row but not a file in S3, so every delete that removes a CV hands
   back its storage path and the caller finishes the job. Failures are swallowed on purpose: a
   file left behind is waste, a row left behind is a ghost record, so the rows going is what
   matters and a storage hiccup must not make the delete look like it failed. */
async function hrRemoveFiles(rows){
  const paths=(rows||[]).map(function(x){return x&&x.storage_path;}).filter(Boolean);
  if(!paths.length) return 0;
  await Promise.all(paths.map(function(pth){
    try{ return isS3Path(pth) ? s3Delete(pth).catch(function(){})
                              : sb.storage.from('resumes').remove([pth]).catch(function(){}); }
    catch(_e){ return null; }
  }));
  return paths.length;
}

window.rsDelete=async function(id){
  if(!await confirmDialog(
      'Delete this CV permanently? If somebody is still waiting to be approved on the strength of '
      +'it, their approval task is cancelled too \u2014 there would be nothing left to read.',
      {title:'Delete CV', okLabel:'Delete', icon:'fa-trash', danger:true}))return;
  /* Through hr.resume_delete rather than a plain delete, so the rule about pending approval
     tasks holds however the CV is removed. */
  const {data,error}=await sb.schema('hr').rpc('resume_delete',{p_ids:[id]});
  if(error){toast('Could not delete: '+error.message,'err');return;}
  await hrRemoveFiles(data);
  RS_ROWS=(RS_ROWS||[]).filter(x=>x.id!==id);
  if(RS_SEARCH)RS_SEARCH=RS_SEARCH.filter(x=>x.id!==id);
  toast('Deleted','ok');rsRender();
};

/* ── Interview Qs (AI-generated interview guides) ── */
let IG_ROWS=null;
async function hrInterviewQs(){
  const b=$('hrBody');loader(b);
  try{const {data,error}=await sb.schema('hr').from('interview_guides').select('*').order('created_at',{ascending:false});if(error)throw error;IG_ROWS=data||[];}
  catch(e){b.innerHTML='<div class="empty" style="padding:40px;color:var(--err)">'+esc(e.message)+'</div>';return;}
  igRender();
}
function igRender(){
  const b=$('hrBody');if(!b)return;
  const rows=IG_ROWS||[];
  b.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <div class="sec-title" style="margin:0">Interview Guides <span class="tag t-gray" style="margin-left:4px">${rows.length}</span></div>
    <div style="margin-left:auto"><button class="btn btn-primary" onclick="igGenModal()"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate Guide</button></div>
  </div>
  <div id="igList">${rows.length?rows.map(g=>`<div class="card card-pad" style="margin-bottom:12px;cursor:pointer" onclick="igOpen(${g.id})">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div style="min-width:0"><div style="font-weight:700;font-size:14.5px">${esc((g.guide&&g.guide.title)||g.title||'Interview Guide')}</div>
      <div style="color:var(--slate);font-size:12.5px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.brief||'')}</div>
      <div style="color:var(--slate);font-size:11.5px;margin-top:5px">${relTime(g.created_at)} · ${esc(g.created_by||'')}</div></div>
      <button class="btn btn-sm" style="color:var(--err);border-color:var(--err);flex-shrink:0" onclick="event.stopPropagation();igDelete(${g.id})"><i class="fa-solid fa-trash"></i></button>
    </div></div>`).join(''):'<div class="empty" style="padding:40px"><i class="fa-solid fa-comments"></i><div>No interview guides yet — click Generate Guide</div></div>'}</div>
  <div id="igDetail"></div>`;
}
window.igGenModal=function(){
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-wand-magic-sparkles"></i> Generate Interview Guide</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Describe the hiring situation</label>
    <textarea id="igBrief" rows="4" placeholder="e.g. Hiring a mid-level Sales Executive for residential real estate, 2-4 years experience, needs strong negotiation and client-facing skills"></textarea>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="igGenBtn" onclick="igGenerate()"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</button></div>`,'lg');
  setTimeout(()=>{const el=$('igBrief');if(el)el.focus();},100);
};
window.igGenerate=async function(){
  const brief=($('igBrief')||{}).value?.trim();if(!brief){toast('Describe the hiring situation first','err');return;}
  const btn=$('igGenBtn');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Generating…';
  try{
    const out=await resumeAI({action:'interview',brief});
    const guide=out.guide;if(!guide)throw new Error('AI returned no guide');
    const {data:row,error}=await sb.schema('hr').from('interview_guides').insert({title:guide.title||brief.slice(0,80),brief,guide,created_by:state.email}).select().single();
    if(error)throw new Error(error.message);
    IG_ROWS=[row,...(IG_ROWS||[])];
    closeModal();toast('Interview guide generated','ok');
    igRender();igOpen(row.id);
  }catch(e){toast('Generation failed: '+e.message,'err');const b2=$('igGenBtn');if(b2){b2.disabled=false;b2.innerHTML='<i class="fa-solid fa-wand-magic-sparkles"></i> Generate';}}
};
window.igOpen=function(id){
  const g=(IG_ROWS||[]).find(x=>x.id===id);const host=$('igDetail');if(!g||!host)return;
  const guide=g.guide||{};
  host.innerHTML=`<div class="card card-pad" style="margin-top:6px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div><div style="font-weight:700;font-size:16px">${esc(guide.title||g.title||'')}</div>
      <p style="font-size:13px;color:var(--slate);margin-top:5px;max-width:640px">${esc(guide.overview||'')}</p></div>
      <button style="background:none;border:none;cursor:pointer;font-size:20px;color:var(--slate)" onclick="document.getElementById('igDetail').innerHTML=''">&times;</button>
    </div>
    ${(guide.sections||[]).map(s=>`<div style="margin-top:16px"><div style="font-weight:700;font-size:13.5px;color:#0369a1;margin-bottom:8px">${esc(s.name||'')}</div>
      ${(s.questions||[]).map(q=>`<div style="padding:10px 0;border-bottom:1px solid var(--line-2)"><div style="font-weight:500;font-size:13.5px">${esc(q.q||'')}</div><div style="font-size:12px;color:var(--slate);margin-top:3px"><i class="fa-solid fa-eye" style="width:12px"></i> Look for: ${esc(q.look_for||'')}</div></div>`).join('')}
    </div>`).join('')}
    ${(guide.red_flags||[]).length?`<div style="margin-top:16px"><div style="font-weight:700;font-size:13px;color:#c83232;margin-bottom:6px"><i class="fa-solid fa-triangle-exclamation"></i> Red flags</div><ul style="font-size:12.5px;color:var(--ink);padding-left:18px;line-height:1.7">${guide.red_flags.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul></div>`:''}
    ${(guide.tips||[]).length?`<div style="margin-top:14px"><div style="font-weight:700;font-size:13px;color:#15803d;margin-bottom:6px"><i class="fa-solid fa-lightbulb"></i> Tips</div><ul style="font-size:12.5px;color:var(--ink);padding-left:18px;line-height:1.7">${guide.tips.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul></div>`:''}
  </div>`;
  host.scrollIntoView({behavior:'smooth',block:'start'});
};
window.igDelete=async function(id){
  if(!await confirmDialog('Delete this interview guide?'))return;
  const {error}=await sb.schema('hr').from('interview_guides').delete().eq('id',id);
  if(error){toast(error.message,'err');return;}
  IG_ROWS=(IG_ROWS||[]).filter(x=>x.id!==id);
  toast('Deleted','ok');igRender();
};


/* ── Inspection globals & helpers ── */
let INSP_ROWS=null, INSP_SCOPE={block:'All',floor:'All',flat:'All',work:'All',project:'All'}, INSP_DRILL=null, INSP_SUBS=[];
let INSP_FORM_STATE=null; // {cat, answers:{ 'component::section::itemId': status }}
let INSP_RESP_FILTER={q:'',work:'All'};
let INSP_LOG_FILTER={q:'',block:'All',cat:'All',status:'All',section:'All'};
async function inspFetch(){ const {data,error}=await sb.schema('acc').from('inspection').select('*').order('ts',{ascending:false}).limit(20000); if(error)throw error; return data||[]; }
function inspLoc(r){ return (r.project?esc(r.project)+' · ':'')+'B'+esc(r.block||'?')+(r.floor?' · '+esc(r.floor):'')+' · '+esc(r.flat||'?'); }
/* ---- What an inspection action was ABOUT, for the Usability report ---------------------------
   Every action on this screen happens to one specific place - a flat, a floor, a tower, a project -
   and the report had no way of saying which: 137 inspection events, all of them reading "—". The
   unit is the one fact that makes an inspection row mean anything ("marked 12 items on 703" rather
   than "marked 12 items"), and it is sitting right there in the form the whole time.
   Plain text, not the escaped HTML inspLoc builds, because this goes into a JSON field and is
   escaped again when the report draws it. Empty parts are dropped rather than printed as "B?" -
   a Project-level inspection genuinely has no block or flat, and inventing a "?" for it reads as
   missing data rather than as "this level does not have one". */
function inspUnit(o){
  if(!o) return null;
  const parts=[];
  if(o.project) parts.push(String(o.project).trim());
  if(o.block)   parts.push('Block '+String(o.block).trim());
  if(o.floor)   parts.push(String(o.floor).trim());
  if(o.flat)    parts.push(String(o.flat).trim());
  if(o.area_detail) parts.push(String(o.area_detail).trim());
  return parts.length?parts.join(' · '):null;
}
// The New Inspection form as it stands right now. Read straight off the fields, so it is correct
// at the moment of the click rather than whatever was saved last.
function inspFormUnit(){
  try{
    const raw=($('inLevel')&&$('inLevel').value)||'';
    const u=inspUnit({project:$('inProject')&&$('inProject').value,
                      block:$('inBlock')&&$('inBlock').value,
                      floor:$('inFloor')&&$('inFloor').value,
                      flat:$('inFlat')&&$('inFlat').value,
                      area_detail:raw.split('::')[1]||''});
    const cat=($('inCat')&&$('inCat').value)||'';
    if(!u && !cat) return null;
    return {unit:u||undefined, category:cat||undefined};
  }catch(e){ return null; }
}
/* The submission on the Form Responses tab. An index can be passed in because the wrapper logs
   BEFORE the function it wraps runs - inspOpenSub(i) is the one that SETS INSP_DRILL, so reading
   the global there would describe the submission the person just left, not the one they opened.
   Everything else acts on whatever is already open, and passes nothing. */
function inspSubUnit(i){
  try{
    const idx=(typeof i==='number')?i:(INSP_DRILL&&INSP_DRILL.i);
    const r=(INSP_SUBS||[])[idx];
    if(!r) return null;
    const u=inspUnit(r);
    if(!u && !r.work_category) return null;
    return {unit:u||undefined, category:r.work_category||undefined};
  }catch(e){ return null; }
}
// What the Console is narrowed to. 'All' is the absence of a filter, so it is left out rather than
// printed - "Block All" says nothing.
function inspScopeMeta(){
  try{
    const s=INSP_SCOPE||{}, keep=function(v){ return v && v!=='All' ? String(v) : null; };
    const u=inspUnit({project:keep(s.project), block:keep(s.block), floor:keep(s.floor), flat:keep(s.flat)});
    const w=keep(s.work);
    if(!u && !w) return {unit:'All projects'};
    return {unit:u||'All projects', category:w||undefined};
  }catch(e){ return null; }
}
function qcStat(rows){ let ok=0,no=0,na=0; rows.forEach(r=>{const u=(r.status||'').trim().toUpperCase(); if(u==='OK')ok++; else if(/NOT\s*OK/.test(u)){no++;} else if(u==='NA'||u==='N/A')na++;}); const rated=ok+no; const checks=ok+no+na; return {checks,ok,no,na,open:no,rated,pass:rated?Math.round(ok/rated*100):0}; }
function statusBadge(s){const u=(s||'').toUpperCase(); if(u==='OK')return '<span class="tag t-green">OK</span>'; if(/NOT\s*OK/.test(u))return '<span class="tag t-red">NOT OK</span>'; if(u==='NA'||u==='N/A')return '<span class="tag t-gray">NA</span>'; return esc(s);}
function passbar(p){const col=p>=80?'#16855a':p>=50?'#d98a00':'#c83232';return '<div style="display:flex;align-items:center;gap:7px"><div class="progress" style="max-width:84px;flex:1"><span style="width:'+p+'%;background:'+col+'"></span></div><span style="font-size:11.5px;color:var(--slate)">'+p+'%</span></div>';}
window.inspReload=function(){ INSP_ROWS=null; if(PAGE==='inspection')renderPage(); };
window.inspScope=function(dim,val){ INSP_SCOPE[dim]=val; if(PAGE==='inspection')renderPage(); };
window.inspScopeClear=function(){ INSP_SCOPE={block:'All',floor:'All',flat:'All',work:'All',project:'All'}; if(PAGE==='inspection')renderPage(); };
window.inspDrill=function(dim,key,col){ INSP_DRILL={dim,key,col}; try{window.scrollTo(0,0);}catch(e){} if(PAGE==='inspection')renderPage(); };
window.inspOpenSub=function(i){ INSP_DRILL={dim:'sub',i}; try{window.scrollTo(0,0);}catch(e){} if(PAGE==='inspection')renderPage(); };
window.inspBack=function(){ INSP_DRILL=null; if(PAGE==='inspection')renderPage(); };
window.inspGo=function(tab){ INSP_DRILL=null; navTo('inspection'+(tab==='console'?'':'/'+tab)); };
function inspHeadTabs(tab){
  const tabs=[['console','Console','fa-table-cells-large'],['responses','Form Responses','fa-file-lines'],['log','Inspection Log','fa-list']];
  return '<div class="page-head"><div><h1><i class="fa-solid fa-clipboard-check" style="color:#0f766e"></i> Inspection</h1><p>Site quality inspection console</p></div><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" onclick="inspReload()"><i class="fa-solid fa-rotate"></i> Refresh</button><button class="btn btn-primary" onclick="navTo(\'inspection/new\')"><i class="fa-solid fa-plus"></i> New Inspection</button></div></div>'+
   '<div class="tabs">'+tabs.map(t=>'<div class="tab '+(tab===t[0]?'active':'')+'" onclick="inspGo(\''+t[0]+'\')"><i class="fa-solid '+t[2]+'"></i> '+t[1]+'</div>').join('')+'</div>';
}

VIEWS.inspection=async function(v,seg){
  setCrumb(['Operations','Inspection']);
  if(seg&&seg[0]==='new'){ INSP_DRILL=null; return inspForm(v); }
  if(!INSP_ROWS){
    v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid fa-clipboard-check" style="color:#0f766e"></i> Inspection</h1></div></div><div class="card card-pad"><div class="loader"><div class="spin"></div></div></div>';
    try{ INSP_ROWS=await inspFetch(); }catch(e){ v.innerHTML='<div class="card card-pad empty"><i class="fa-solid fa-triangle-exclamation"></i><div style="font-weight:600">Could not load inspections</div><p>'+esc(e.message||String(e))+'</p></div>'; return; }
  }
  const tab=(seg&&seg[0])||'console';
  if(tab==='responses') return inspResponses(v,INSP_ROWS);
  if(tab==='log') return inspLog(v,INSP_ROWS);
  if(INSP_DRILL && INSP_DRILL.dim!=='sub') return inspDrillView(v,INSP_ROWS);
  inspConsole(v,INSP_ROWS);
};
function inspConsole(v,rows){
  const overall=qcStat(rows);
  const sc=INSP_SCOPE;
  const scoped=rows.filter(r=>(sc.project==='All'||r.project===sc.project)&&(sc.block==='All'||r.block===sc.block)&&(sc.floor==='All'||r.floor===sc.floor)&&(sc.flat==='All'||r.flat===sc.flat)&&(sc.work==='All'||r.work_category===sc.work));
  const ss=qcStat(scoped); const scopeActive=sc.project!=='All'||sc.block!=='All'||sc.floor!=='All'||sc.flat!=='All'||sc.work!=='All';
  const B=(window.INSP_BLOCKS||[...new Set(rows.map(r=>r.block).filter(Boolean))]);
  const C=(window.INSP_CATS||[...new Set(rows.map(r=>r.work_category).filter(Boolean))]);
  const PR=(window.INSP_PROJECTS||[...new Set(rows.map(r=>r.project).filter(Boolean))]);
  const LVD=(window.INSP_LEVELS||[...new Set(rows.map(r=>r.insp_level).filter(Boolean))]);
  const byBlock=B.map(x=>({key:x,s:qcStat(rows.filter(r=>r.block===x))})).filter(x=>x.s.checks>0);
  const byCat=C.map(x=>({key:x,s:qcStat(rows.filter(r=>r.work_category===x))})).filter(x=>x.s.checks>0);
  const byProject=PR.map(x=>({key:x,s:qcStat(rows.filter(r=>r.project===x))})).filter(x=>x.s.checks>0);
  const byLevel=LVD.map(x=>({key:x,s:qcStat(rows.filter(r=>r.insp_level===x))})).filter(x=>x.s.checks>0);
  const openDefects=rows.filter(r=>/NOT\s*OK/.test((r.status||'').toUpperCase()));
  const kpis=[['Total Logs',overall.checks,'#1763A6','fa-list-check'],['OK',overall.ok,'#16855A','fa-circle-check'],['NOT OK',overall.no,'#C83232','fa-circle-xmark'],['Not Applicable',overall.na,'#94a3b8','fa-circle-minus'],['Percentage',overall.pass+'%','#F2A104','fa-percent']];
  const kpiBand='<div class="grid kpis" style="grid-template-columns:repeat(5,1fr)">'+kpis.map(k=>'<div class="kpi"><div class="top"><div class="ic" style="background:'+k[2]+'18;color:'+k[2]+'"><i class="fa-solid '+k[3]+'"></i></div></div><div class="val">'+k[1]+'</div><div class="lbl">'+k[0]+'</div></div>').join('')+'</div>';
  const opt=(dim,cur,vals)=>'<select onchange="inspScope(\''+dim+'\',this.value)"><option value="All"'+(cur==='All'?' selected':'')+'>All</option>'+(vals||[]).map(x=>'<option'+(cur===String(x)?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select>';
  const P=window.INSP_PROJECTS||[];
  const scopeCard='<div class="card card-pad" style="margin-top:16px"><div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:8px"><div><div class="insp-kicker">DRILL-DOWN</div><div class="sec-title" style="margin:2px 0 0">Filter by Project · Block · Floor · Flat · Work Type</div></div><span class="insp-count">'+scoped.length+' of '+rows.length+' checks</span></div>'+
    '<div class="insp-filter-row">'+
    '<div class="insp-field"><label>Project</label>'+opt('project',sc.project,P)+'</div>'+
    '<div class="insp-field"><label>Block</label>'+opt('block',sc.block,B)+'</div>'+
    '<div class="insp-field"><label>Floor</label>'+opt('floor',sc.floor,window.INSP_FLOORS||[])+'</div>'+
    '<div class="insp-field"><label>Flat</label>'+opt('flat',sc.flat,window.INSP_FLATS||[])+'</div>'+
    '<div class="insp-field"><label>Work Type</label>'+opt('work',sc.work,C)+'</div>'+
    (scopeActive?'<button class="btn insp-clear-btn" onclick="inspScopeClear()"><i class=\"fa-solid fa-xmark\"></i> Clear</button>':'')+'</div>'+
    '<div style="display:flex;align-items:center;gap:18px;margin-top:14px;padding-top:14px;border-top:1px dashed var(--line);flex-wrap:wrap">'+
     '<div class="insp-skpi"><div class="n">'+ss.checks+'</div><div class="l">Total Logs</div></div>'+
     '<div class="insp-skpi"><div class="n" style="color:#16855A">'+ss.ok+'</div><div class="l">OK</div></div>'+
     '<div class="insp-skpi"><div class="n" style="color:#C83232">'+ss.no+'</div><div class="l">Not OK</div></div>'+
     '<div class="insp-skpi"><div class="n" style="color:#94a3b8">'+ss.na+'</div><div class="l">Not Applicable</div></div>'+
     '<div class="insp-skpi"><div class="n" style="color:#1763A6">'+ss.pass+'%</div><div class="l">Percentage</div></div>'+
     '<div style="flex:1;min-width:150px">'+passbar(ss.pass)+'</div></div>'+
    (scopeActive&&ss.checks===0?'<div style="margin-top:12px;font-size:13px;color:#C83232;background:#fbe7e7;padding:9px 13px;border-radius:8px">No checks logged for this scope yet.</div>':'')+'</div>';
  const num=(dim,key,col,val,cls)=>'<a class="insp-num '+(cls||'')+'" onclick="inspDrill(\''+dim+'\',\''+esc(String(key)).replace(/'/g,"&#39;")+'\',\''+col+'\')">'+val+'</a>';
  const DIM_LABEL={block:'Block',cat:'Category',project:'Project',level:'Level'};
  const matrix=(arr,dim,head)=>'<div class="card qc-table-card" style="padding:0"><div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-end"><div><div class="insp-kicker">STATUS</div><div class="sec-title" style="margin:2px 0 0">'+head+'</div></div><span class="qc-hint" style="font-size:11.5px;color:#94a3b8;font-style:italic">Click any number to drill in</span></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>'+(DIM_LABEL[dim]||'Key')+'</th><th>Total Logs</th><th>OK</th><th>Not OK</th><th>Not Applicable</th><th>Percentage</th></tr></thead><tbody>'+
    (arr.length?arr.map(x=>'<tr><td><b>'+esc(x.key)+'</b></td><td>'+num(dim,x.key,'all',x.s.checks,'')+'</td><td>'+num(dim,x.key,'ok',x.s.ok,'ok')+'</td><td>'+num(dim,x.key,'notok',x.s.no,'no')+'</td><td>'+num(dim,x.key,'na',x.s.na,'')+'</td><td>'+passbar(x.s.pass)+'</td></tr>').join(''):'<tr><td colspan="6"><div class="empty" style="padding:20px">No data</div></td></tr>')+'</tbody></table></div></div>';
  const openCard='<div class="card qc-table-card" style="padding:0;margin-top:16px"><div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-end"><div><div class="insp-kicker" style="color:#E08600">NEEDS ATTENTION</div><div class="sec-title" style="margin:2px 0 0">Not OK Items</div></div><span class="insp-pill">'+openDefects.length+'</span></div>'+
    (openDefects.length===0?'<div class="empty" style="padding:36px"><i class="fa-solid fa-circle-check" style="color:#16855a"></i><div style="font-weight:600">No Not OK items</div><p>Everything logged so far is OK.</p></div>':'<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Block</th><th>Floor</th><th>Flat</th><th>Category</th><th>Item ID</th><th>Inspection Check</th><th>Status</th><th>Inspector</th></tr></thead><tbody>'+openDefects.map(r=>'<tr><td>'+esc(r.block)+'</td><td>'+esc(r.floor)+'</td><td>'+esc(r.flat)+'</td><td>'+esc(r.work_category)+'</td><td><b>'+esc(r.item_id)+'</b></td><td style="max-width:280px;color:#475569">'+esc(r.inspection_check)+'</td><td>'+statusBadge(r.status)+'</td><td>'+esc(r.inspector)+'</td></tr>').join('')+'</tbody></table></div>')+'</div>';
  const empty=rows.length===0?'<div class="card card-pad empty" style="margin-top:16px"><i class="fa-regular fa-clipboard"></i><div style="font-weight:600;color:var(--ink)">No inspections logged yet</div><p style="max-width:420px;margin:6px auto 0">Click <b>New Inspection</b> to record one — it saves straight to the database.</p></div>':'';
  v.innerHTML=inspHeadTabs('console')+kpiBand+scopeCard+(rows.length?('<div class="insp-matrix-grid">'+matrix(byBlock,'block','By Block')+matrix(byCat,'cat','By Work Category')+matrix(byProject,'project','By Project')+matrix(byLevel,'level','By Level')+'</div>'+openCard):empty);
}
const INSP_DIM_FIELD={block:'block',cat:'work_category',project:'project',level:'insp_level'};
function inspDrillView(v,rows){
  const d=INSP_DRILL; const field=INSP_DIM_FIELD[d.dim]||'work_category'; const dimRows=rows.filter(r=>r[field]===d.key);
  const u=r=>(r.status||'').toUpperCase();
  const colRows=d.col==='ok'?dimRows.filter(r=>u(r)==='OK'):d.col==='notok'?dimRows.filter(r=>/NOT\s*OK/.test(u(r))):d.col==='na'?dimRows.filter(r=>u(r)==='NA'||u(r)==='N/A'):dimRows;
  const lbl={all:'All checks',ok:'OK',notok:'Not OK',na:'Not Applicable'}[d.col]||'Checks';
  v.innerHTML=inspHeadTabs('console')+'<button class="btn" style="margin-bottom:14px" onclick="inspBack()"><i class="fa-solid fa-arrow-left"></i> Back to console</button>'+
    '<div class="card qc-table-card" style="padding:0"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="insp-kicker">'+{block:'BLOCK',cat:'WORK CATEGORY',project:'PROJECT',level:'LEVEL'}[d.dim]+' · '+esc(d.key)+'</div><div class="sec-title" style="margin:2px 0 0">'+lbl+' · '+colRows.length+' checks</div></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Date</th><th>Inspector</th><th>Location</th><th>Category</th><th>Item</th><th>Check</th><th>Status</th><th>Remarks</th></tr></thead><tbody>'+
    (colRows.length?colRows.map(r=>'<tr><td>'+esc(fmtDate(r.ts))+'</td><td>'+esc(r.inspector)+'</td><td>'+inspLoc(r)+'</td><td>'+esc(r.work_category)+'</td><td><b>'+esc(r.item_id)+'</b></td><td style="max-width:260px;color:#475569">'+esc(r.inspection_check)+'</td><td>'+statusBadge(r.status)+'</td><td style="color:var(--slate);max-width:200px">'+esc(r.remarks)+'</td></tr>').join(''):'<tr><td colspan="8"><div class="empty">No checks</div></td></tr>')+'</tbody></table></div></div>';
}
function inspResponses(v,rows){
  const map={}; rows.forEach(r=>{const k=[r.ts,r.inspector,r.block,r.floor,r.flat,r.work_category].join('|'); if(!map[k])map[k]={ts:r.ts,ins:r.inspector,block:r.block,floor:r.floor,flat:r.flat,cat:r.work_category,loc:inspLoc(r),rows:[],ok:0,no:0,sec:r.remarks||'',photo:r.defect_photo||'',overall:r.overall_remark||''}; const o=map[k]; o.rows.push(r); const uu=(r.status||'').toUpperCase(); if(uu==='OK')o.ok++; else if(/NOT\s*OK/.test(uu))o.no++;});
  INSP_SUBS=Object.values(map);
  if(INSP_DRILL && INSP_DRILL.dim==='sub'){
    const s=INSP_SUBS[INSP_DRILL.i]; if(!s){ INSP_DRILL=null; return inspResponses(v,rows); }
    if(INSP_DRILL.edit) return inspEditView(v,s);
    v.innerHTML=inspHeadTabs('responses')+
      '<div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap"><button class="btn" onclick="inspBack()"><i class="fa-solid fa-arrow-left"></i> Back to responses</button><button class="btn btn-primary" onclick="inspEditSub()"><i class="fa-solid fa-pen"></i> Edit response</button></div>'+
      '<div class="card card-pad"><div class="insp-kicker">SUBMISSION</div><div class="sec-title" style="margin:2px 0 8px">'+esc(s.cat)+' · '+s.loc+'</div><div style="display:flex;flex-wrap:wrap;gap:10px">'+
      [['Date',esc(fmtDate(s.ts))],['Inspector',esc(s.ins)],['OK',s.ok],['Not OK',s.no],['Total Log',s.ok+s.no]].map(f=>'<div class="insp-fact"><div class="fl">'+f[0]+'</div><div class="fv">'+f[1]+'</div></div>').join('')+'</div>'+
      (s.sec?'<div style="margin-top:12px"><label style="font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--slate);text-transform:uppercase">Section Remark</label><div style="font-size:13px;margin-top:3px">'+esc(s.sec)+'</div></div>':'')+
      (s.photo?'<div style="margin-top:10px"><label style="font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--slate);text-transform:uppercase">Defect Photos</label><div style="font-size:13px;margin-top:3px">'+(isS3Path(s.photo)?'<button class="btn btn-sm" onclick="inspOpenPhoto(\''+esc(s.photo)+'\')"><i class="fa-solid fa-image"></i> View photo</button>':'<a href="'+esc(s.photo)+'" target="_blank" rel="noopener" style="color:var(--brand)">'+esc(s.photo)+'</a>')+'</div></div>':'')+
      (s.overall?'<div style="margin-top:10px"><label style="font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--slate);text-transform:uppercase">Overall Remarks</label><div style="font-size:13px;margin-top:3px">'+esc(s.overall)+'</div></div>':'')+'</div>'+
      '<div class="card qc-table-card" style="padding:0;margin-top:16px"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">Checks · '+s.rows.length+'</div></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Item</th><th>Check</th><th>Status</th></tr></thead><tbody>'+s.rows.map(r=>'<tr><td><b>'+esc(r.item_id)+'</b></td><td style="max-width:420px;color:#475569">'+esc(r.inspection_check)+'</td><td>'+statusBadge(r.status)+'</td></tr>').join('')+'</tbody></table></div></div>';
    return;
  }
  const C=window.INSP_CATS||[...new Set(rows.map(r=>r.work_category).filter(Boolean))];
  const f=INSP_RESP_FILTER, q=(f.q||'').trim().toLowerCase();
  const passF=x=>(f.work==='All'||x.cat===f.work)&&(!q||[x.ins,x.block,x.flat].some(v=>String(v||'').toLowerCase().includes(q)));
  const shown=INSP_SUBS.map((x,i)=>({x,i})).filter(o=>passF(o.x));
  const toolbar='<div class="toolbar" style="margin-bottom:14px">'+
    '<div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input id="respQ" placeholder="Search Inspector, Block or Flat…" value="'+esc(f.q)+'" oninput="inspRespFilter()"></div>'+
    '<select class="sel" id="respWork" onchange="inspRespFilter()"><option value="All">All Work Types</option>'+C.map(c=>'<option'+(f.work===c?' selected':'')+'>'+esc(c)+'</option>').join('')+'</select>'+
    (q||f.work!=='All'?'<button class="btn" onclick="inspRespFilterClear()"><i class="fa-solid fa-xmark"></i> Clear</button>':'')+
    '</div>';
  const respRow=({x,i})=>'<tr class="rowlink" onclick="inspOpenSub('+i+')"><td>'+esc(fmtDate(x.ts))+'</td><td>'+esc(x.ins)+'</td><td>'+x.loc+'</td><td>'+esc(x.cat)+'</td><td style="color:#16855a;font-weight:600">'+x.ok+'</td><td style="color:#c83232;font-weight:600">'+x.no+'</td><td style="font-weight:600">'+(x.ok+x.no)+'</td><td style="text-align:right"><i class="fa-solid fa-chevron-right" style="color:#cbd5e1"></i></td></tr>';
  v.innerHTML=inspHeadTabs('responses')+toolbar+'<div class="card qc-table-card" style="padding:0"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">Form Responses</div><div class="sec-sub" id="respSecSub">'+shown.length+' of '+INSP_SUBS.length+' submissions · click a row to open it</div></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Date</th><th>Inspector</th><th>Location</th><th>Category</th><th>OK</th><th>Not OK</th><th>Total Log</th><th></th></tr></thead><tbody id="respTbody">'+
    (shown.length?shown.map(respRow).join(''):'<tr><td colspan="8"><div class="empty">No submissions match this search/filter.</div></td></tr>')+'</tbody></table></div></div>';
}
window.inspRespFilter=function(){
  const qEl=$('respQ'), wEl=$('respWork'); if(!qEl||!wEl)return;
  INSP_RESP_FILTER={q:qEl.value,work:wEl.value};
  const f=INSP_RESP_FILTER, q=(f.q||'').trim().toLowerCase();
  const passF=x=>(f.work==='All'||x.cat===f.work)&&(!q||[x.ins,x.block,x.flat].some(v=>String(v||'').toLowerCase().includes(q)));
  const shown=INSP_SUBS.map((x,i)=>({x,i})).filter(o=>passF(o.x));
  const respRow=({x,i})=>'<tr class="rowlink" onclick="inspOpenSub('+i+')"><td>'+esc(fmtDate(x.ts))+'</td><td>'+esc(x.ins)+'</td><td>'+x.loc+'</td><td>'+esc(x.cat)+'</td><td style="color:#16855a;font-weight:600">'+x.ok+'</td><td style="color:#c83232;font-weight:600">'+x.no+'</td><td style="font-weight:600">'+(x.ok+x.no)+'</td><td style="text-align:right"><i class="fa-solid fa-chevron-right" style="color:#cbd5e1"></i></td></tr>';
  const tb=$('respTbody'); if(tb)tb.innerHTML=shown.length?shown.map(respRow).join(''):'<tr><td colspan="8"><div class="empty">No submissions match this search/filter.</div></td></tr>';
  const sub=$('respSecSub'); if(sub)sub.textContent=shown.length+' of '+INSP_SUBS.length+' submissions · click a row to open it';
  usageQueueDebounced('inspection.responses.search_filter_submissions', q);
};
window.inspRespFilterClear=function(){ INSP_RESP_FILTER={q:'',work:'All'}; if(PAGE==='inspection')renderPage(); };
function inspEditView(v,s){
  v.innerHTML=inspHeadTabs('responses')+
    '<div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap"><button class="btn" onclick="inspCancelEdit()"><i class="fa-solid fa-arrow-left"></i> Cancel</button></div>'+
    '<div class="card card-pad frm" style="max-width:920px"><div class="insp-kicker">EDIT SUBMISSION</div><div class="sec-title" style="margin:2px 0 4px">'+esc(s.cat)+' · '+s.loc+'</div><div style="color:var(--slate);font-size:12.5px;margin-bottom:10px">'+esc(fmtDate(s.ts))+' · '+esc(s.ins)+'</div>'+
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px"><div class="sec-title" style="margin:0;font-size:14px">Checks · '+s.rows.length+'</div><button type="button" class="btn btn-sm" onclick="inspBulkE(\'OK\')">All OK</button></div>'+
    '<div id="eItems">'+(()=>{
      const groups=[]; let cur=null;
      s.rows.forEach(r=>{
        const key=(r.sub_area||'')+'::'+(r.component||'')+'::'+(r.section||'');
        if(!cur||cur.key!==key){ cur={key,label:[r.sub_area,r.component,r.section].filter(Boolean).join(' · '),rows:[]}; groups.push(cur); }
        cur.rows.push(r);
      });
      const mkRow=r=>{const u=(r.status||'').toUpperCase();const mk=(st)=>{const sel=(st==='OK'&&u==='OK')||(/NOT/.test(st)&&/NOT\s*OK/.test(u))||(st==='NA'&&(u==='NA'||u==='N/A'));const cls=st==='OK'?'ok':/NOT/.test(st)?'no':'na';return '<button type="button" class="ic-btn'+(sel?' on '+cls:'')+'" data-s="'+st+'" onclick="inspPick(this)">'+st+'</button>';};return '<div class="insp-check" data-id="'+r.id+'" data-status="'+esc(r.status||'')+'"><div class="ic-main"><div class="ic-id">'+esc(r.item_id)+'</div><div class="ic-txt">'+esc(r.inspection_check)+'</div></div><div class="ic-seg">'+['OK','NOT OK','NA'].map(mk).join('')+'</div></div>';};
      return groups.map(g=>g.label?('<div class="insp-comp-group"><div class="insp-comp-head">'+esc(g.label)+'<span class="insp-comp-count">'+g.rows.length+' checks</span></div><div class="insp-checks">'+g.rows.map(mkRow).join('')+'</div></div>'):('<div class="insp-checks">'+g.rows.map(mkRow).join('')+'</div>')).join('');
    })()+'</div>'+
    '<label style="margin-top:14px">Section Remark</label><textarea id="eSec">'+esc(s.sec)+'</textarea>'+
    '<label>Defect Photos</label>'+
    (s.photo&&isS3Path(s.photo)?'<div style="font-size:12.5px;margin-bottom:4px"><button type="button" class="btn btn-sm" onclick="inspOpenPhoto(\''+esc(s.photo)+'\')"><i class="fa-solid fa-image"></i> View current photo</button></div>':'')+
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input id="ePhoto" placeholder="Paste a link (optional)" value="'+esc(isS3Path(s.photo)?'':(s.photo||''))+'" style="flex:1;min-width:180px"><button type="button" class="btn btn-sm" onclick="document.getElementById(\'ePhotoFile\').click()"><i class="fa-solid fa-camera"></i> Replace photo</button><input type="file" id="ePhotoFile" class="hidden" accept="image/*" onchange="document.getElementById(\'ePhotoName\').textContent=this.files[0]?this.files[0].name:\'\'"><span id="ePhotoName" style="font-size:12px;color:var(--slate)"></span></div>'+
    '<label>Overall Remarks</label><textarea id="eOverall">'+esc(s.overall)+'</textarea>'+
    '<div style="margin-top:18px;display:flex;justify-content:flex-end;gap:10px"><button class="btn" onclick="inspCancelEdit()">Cancel</button><button class="btn btn-primary" id="eSaveBtn" onclick="inspUpdateSub()"><i class="fa-solid fa-check"></i> Save changes</button></div></div>';
}
window.inspOpenPhoto=async function(path){ if(isS3Path(path)){ await s3OpenSigned(path); } else if(path){ window.open(path,'_blank'); } };
window.inspEditSub=function(){ if(INSP_DRILL){INSP_DRILL.edit=true; try{window.scrollTo(0,0);}catch(e){} renderPage();} };
window.inspCancelEdit=function(){ if(INSP_DRILL){INSP_DRILL.edit=false; renderPage();} };
window.inspBulkE=function(st){ document.querySelectorAll('#eItems .insp-check').forEach(row=>{row.querySelectorAll('.ic-btn').forEach(b=>b.classList.remove('on','ok','no','na')); const b=[...row.querySelectorAll('.ic-btn')].find(x=>x.dataset.s===st); if(b){b.classList.add('on',st==='OK'?'ok':/NOT/.test(st)?'no':'na'); row.dataset.status=st;}}); };
window.inspUpdateSub=async function(){
  const sec=($('eSec').value||'').trim(), overall=($('eOverall').value||'').trim();
  // Captured before the save so the two direct logs below can tell an actual edit apart from
  // "Save changes" clicked with the remark/photo untouched from what was already there.
  const origSub=(INSP_SUBS||[])[INSP_DRILL&&INSP_DRILL.i]||{};
  const origSec=(origSub.sec||''), origOverall=(origSub.overall||''), origPhoto=(origSub.photo||'');
  const checks=[...document.querySelectorAll('#eItems .insp-check')];
  const b=$('eSaveBtn'); if(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…';}
  let photo=($('ePhoto').value||'').trim();
  const photoFile=$('ePhotoFile')&&$('ePhotoFile').files[0];
  if(photoFile){
    b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading photo…';
    const {data:upData,error:upErr}=await uploadFileToS3(s3KeyForDefectImg(photoFile.name),photoFile);
    if(upErr){toast('Photo upload failed: '+upErr.message,'err'); b.disabled=false;b.innerHTML='<i class="fa-solid fa-check"></i> Save changes'; return;}
    photo=upData.path;
  } else if(!photo && INSP_DRILL){
    const cur=(INSP_SUBS||[])[INSP_DRILL.i];
    if(cur&&isS3Path(cur.photo))photo=cur.photo;
  }
  let err=null;
  for(const c of checks){ const {error}=await sb.schema('acc').from('inspection').update({status:c.dataset.status||'',remarks:sec,defect_photo:photo,overall_remark:overall}).eq('id',c.dataset.id); if(error){err=error.message;break;} }
  if(err){toast(err,'err'); if(b){b.disabled=false;b.innerHTML='<i class="fa-solid fa-check"></i> Save changes';} return;}
  // Logged directly, after the update actually succeeds, rather than through USAGE_MAP's single
  // fixed key for this button - "update check status" and "add/replace a photo" and "add a
  // remark" are three distinct catalog features one Save can do at once, and only counting them
  // when the value actually changed keeps an untouched pre-filled field from over-counting.
  if(photoFile || (photo && photo!==origPhoto)){ try{ usageQueue('inspection.responses.add_replace_defect_photo','update',
    Object.assign({title:(photoFile?photoFile.name:photo)}, inspSubUnit()||{})); }catch(_e){} }
  if((sec&&sec!==origSec) || (overall&&overall!==origOverall)){ try{ usageQueue('inspection.responses.add_section_overall_remarks','update',
    Object.assign({title:(sec||overall).slice(0,80)}, inspSubUnit()||{})); }catch(_e){} }
  INSP_ROWS=null; INSP_DRILL=null; toast('Response updated','ok'); renderPage();
};
function inspLogRow(r){ return '<tr><td>'+esc(fmtDate(r.ts))+'</td><td>'+esc(r.inspector)+'</td><td>'+inspLoc(r)+'</td><td>'+esc(r.work_category)+(r.section?'<div style="font-size:11px;color:var(--slate)">'+esc(r.section)+'</div>':'')+'</td><td><b>'+esc(r.item_id)+'</b></td><td style="max-width:260px;color:#475569">'+esc(r.inspection_check)+'</td><td>'+statusBadge(r.status)+'</td><td style="color:var(--slate);max-width:200px">'+esc(r.remarks)+'</td></tr>'; }
function inspLogFiltered(rows){
  const f=INSP_LOG_FILTER, q=(f.q||'').trim().toLowerCase();
  const su=s=>(s||'').toUpperCase();
  return rows.filter(r=>
    (f.block==='All'||r.block===f.block)&&
    (f.cat==='All'||r.work_category===f.cat)&&
    (f.section==='All'||r.section===f.section||(f.section==='(none)'&&!r.section))&&
    (f.status==='All'||(f.status==='NOT OK'?/NOT\s*OK/.test(su(r.status)):(f.status==='NA'?(su(r.status)==='NA'||su(r.status)==='N/A'):su(r.status)===f.status)))&&
    (!q||[r.inspection_check,r.item_id,r.inspector].some(v=>String(v||'').toLowerCase().includes(q)))
  );
}
function inspLog(v,rows){
  const B=window.INSP_BLOCKS||[...new Set(rows.map(r=>r.block).filter(Boolean))];
  const C=window.INSP_CATS||[...new Set(rows.map(r=>r.work_category).filter(Boolean))];
  const S=[...new Set(rows.map(r=>r.section).filter(Boolean))].sort();
  const f=INSP_LOG_FILTER;
  const shown=inspLogFiltered(rows);
  const toolbar='<div class="toolbar" style="margin-bottom:14px">'+
    '<div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input id="logQ" placeholder="Search Check Description, Item Id or Inspector…" value="'+esc(f.q)+'" oninput="inspLogFilter()"></div>'+
    '<select class="sel" id="logBlock" onchange="inspLogFilter()"><option value="All">All Blocks</option>'+B.map(b=>'<option'+(f.block===String(b)?' selected':'')+'>'+esc(b)+'</option>').join('')+'</select>'+
    '<select class="sel" id="logCat" onchange="inspLogFilter()"><option value="All">All Categories</option>'+C.map(c=>'<option'+(f.cat===c?' selected':'')+'>'+esc(c)+'</option>').join('')+'</select>'+
    (S.length?'<select class="sel" id="logSection" onchange="inspLogFilter()"><option value="All">All Sections</option>'+S.map(s=>'<option'+(f.section===s?' selected':'')+'>'+esc(s)+'</option>').join('')+'<option value="(none)"'+(f.section==='(none)'?' selected':'')+'>(no section)</option></select>':'')+
    '<select class="sel" id="logStatus" onchange="inspLogFilter()"><option value="All">All Status</option>'+['OK','NOT OK','NA'].map(s=>'<option'+(f.status===s?' selected':'')+'>'+s+'</option>').join('')+'</select>'+
    (f.q||f.block!=='All'||f.cat!=='All'||f.status!=='All'||f.section!=='All'?'<button class="btn" onclick="inspLogFilterClear()"><i class="fa-solid fa-xmark"></i> Clear</button>':'')+
    '</div>';
  v.innerHTML=inspHeadTabs('log')+toolbar+'<div class="card qc-table-card" style="padding:0"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">Inspection Log</div><div class="sec-sub" id="logSecSub">'+shown.length+' of '+rows.length+' checks</div></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Date</th><th>Inspector</th><th>Location</th><th>Category</th><th>Item</th><th>Check</th><th>Status</th><th>Remarks</th></tr></thead><tbody id="logTbody">'+
    (shown.length?shown.map(inspLogRow).join(''):'<tr><td colspan="8"><div class="empty">No checks match this search/filter.</div></td></tr>')+'</tbody></table></div></div>';
}
window.inspLogFilter=function(){
  const qEl=$('logQ'),bEl=$('logBlock'),cEl=$('logCat'),sEl=$('logStatus'),secEl=$('logSection'); if(!qEl)return;
  INSP_LOG_FILTER={q:qEl.value,block:bEl.value,cat:cEl.value,status:sEl.value,section:secEl?secEl.value:'All'};
  const shown=inspLogFiltered(INSP_ROWS||[]);
  const tb=$('logTbody'); if(tb)tb.innerHTML=shown.length?shown.map(inspLogRow).join(''):'<tr><td colspan="8"><div class="empty">No checks match this search/filter.</div></td></tr>';
  const sub=$('logSecSub'); if(sub)sub.textContent=shown.length+' of '+(INSP_ROWS||[]).length+' checks';
  usageQueueDebounced('inspection.log.search_filter_inspection_log', INSP_LOG_FILTER.q);
};
window.inspLogFilterClear=function(){ INSP_LOG_FILTER={q:'',block:'All',cat:'All',status:'All',section:'All'}; if(PAGE==='inspection')renderPage(); };
const PM_PROJECT_MAP={
  'projectmanager1@thejaingroup.com':'Dream World City',
  'dgm.project@thejaingroup.com':'Dream Gurukul'
};
function inspLockedProject(){ return PM_PROJECT_MAP[(state.email||'').toLowerCase()]||''; }
function inspForm(v){
  setCrumb(['Operations','Inspection','New inspection']);
  const B=window.INSP_BLOCKS||[],F=window.INSP_FLOORS||[],FL=window.INSP_FLATS||[],C=window.INSP_CATS||[],LV=window.INSP_LEVELS||[];
  const lockedProject=inspLockedProject();
  const projectField=lockedProject?
    ('<div style="height:38px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font-size:13px;display:flex;align-items:center;background:#f1f5f9;color:var(--ink);font-weight:600">'+esc(lockedProject)+'</div><input type="hidden" id="inProject" value="'+esc(lockedProject)+'">')
    :('<select id="inProject"><option value="">-- Select Project --</option>'+(window.INSP_PROJECTS||[]).map(p=>'<option>'+esc(p)+'</option>').join('')+'</select>');
  v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid fa-clipboard-check" style="color:#0f766e"></i> New Inspection</h1><p>Record a site inspection — saved straight to the database</p></div><button class="btn" onclick="navTo(\'inspection\')"><i class="fa-solid fa-arrow-left"></i> Back</button></div>'+
  '<div class="card card-pad frm" style="max-width:920px">'+
    '<div class="two"><div><label><i class="fa-solid fa-user"></i> Inspector</label><input id="inInsp" placeholder="Inspector name"></div><div><label><i class="fa-solid fa-list-check"></i> Work Category</label><select id="inCat" onchange="inspItems()"><option value="">Select…</option>'+C.map(c=>'<option>'+esc(c)+'</option>').join('')+'</select></div></div>'+
    '<div class="insp-form-grid">'+
      '<div class="insp-fg"><label><i class="fa-solid fa-sitemap"></i> Level</label>'
        +'<div class="insp-dd" id="levelDd"><button type="button" class="insp-dd-btn" onclick="inspLevelDdToggle(event)"><i class="fa-solid fa-door-open" id="levelDdIcon"></i><span id="levelDdLabel">Flat Level (General)</span><i class="fa-solid fa-chevron-down insp-dd-caret"></i></button>'
        +'<div class="insp-dd-menu" id="levelDdMenu">'
          +'<div class="insp-dd-item" onclick="inspLevelPick(\'Project Level\',\'\',\'fa-diagram-project\',\'Project Level\')"><i class="fa-solid fa-diagram-project"></i> Project Level</div>'
          +'<div class="insp-dd-item" onclick="inspLevelPick(\'Tower Level\',\'\',\'fa-building\',\'Tower Level\')"><i class="fa-solid fa-building"></i> Tower Level</div>'
          +'<div class="insp-dd-item" onclick="inspLevelPick(\'Floor Level\',\'\',\'fa-layer-group\',\'Floor Level\')"><i class="fa-solid fa-layer-group"></i> Floor Level</div>'
          +'<div class="insp-dd-group">Flat Level</div>'
          +'<div class="insp-dd-item sub" onclick="inspLevelPick(\'Flat Level\',\'\',\'fa-door-open\',\'Flat Level (General)\')"><i class="fa-solid fa-door-open"></i> General</div>'
          +'<div class="insp-dd-item sub" onclick="inspLevelPick(\'Flat Level\',\'Kitchen\',\'fa-kitchen-set\',\'Flat Level — Kitchen\')"><i class="fa-solid fa-kitchen-set"></i> Kitchen</div>'
          +'<div class="insp-dd-item sub" onclick="inspLevelPick(\'Flat Level\',\'Bathroom\',\'fa-bath\',\'Flat Level — Bathroom\')"><i class="fa-solid fa-bath"></i> Bathroom</div>'
          +'<div class="insp-dd-item sub" onclick="inspLevelPick(\'Flat Level\',\'Others\',\'fa-ellipsis\',\'Flat Level — Others\')"><i class="fa-solid fa-ellipsis"></i> Others</div>'
        +'</div></div>'
        +'<input type="hidden" id="inLevel" value="Flat Level">'
      +'</div>'+
      '<div class="insp-fg"><label><i class="fa-solid fa-city"></i> Project</label>'+projectField+'</div>'+
      '<div class="insp-fg" id="fgBlock"><label><i class="fa-solid fa-building"></i> Block</label><select id="inBlock">'+B.map(b=>'<option>'+esc(b)+'</option>').join('')+'</select></div>'+
      '<div class="insp-fg" id="fgFloor"><label><i class="fa-solid fa-layer-group"></i> Floor</label><select id="inFloor">'+F.map(f=>'<option'+(f==='Ground'?' selected':'')+'>'+esc(f)+'</option>').join('')+'</select></div>'+
      '<div class="insp-fg" id="fgFlat"><label><i class="fa-solid fa-door-closed"></i> Flat</label><select id="inFlat">'+FL.map(f=>'<option>'+esc(f)+'</option>').join('')+'</select></div>'+
    '</div>'+
    '<div id="inItems" style="margin-top:14px"><div class="empty" style="padding:24px">Select a work category to load its checklist.</div></div>'+
    '<label style="margin-top:14px">Section Remark</label><textarea id="inSec" placeholder="A remark for this section/category (optional)"></textarea>'+
    '<label>Defect Photos</label>'+
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input id="inPhoto" placeholder="Paste a link (optional)" style="flex:1;min-width:180px"><button type="button" class="btn btn-sm" onclick="document.getElementById(\'inPhotoFile\').click()"><i class="fa-solid fa-camera"></i> Upload photo</button><input type="file" id="inPhotoFile" class="hidden" accept="image/*" onchange="document.getElementById(\'inPhotoName\').textContent=this.files[0]?this.files[0].name:\'\'"><span id="inPhotoName" style="font-size:12px;color:var(--slate)"></span></div>'+
    '<label>Overall Remarks</label><textarea id="inOverall" placeholder="Overall site remarks (optional)"></textarea>'+
    '<div style="margin-top:18px;display:flex;justify-content:flex-end;gap:10px"><button class="btn" onclick="navTo(\'inspection\')">Cancel</button><button class="btn btn-primary" id="inSaveBtn" onclick="inspSave()"><i class="fa-solid fa-check"></i> Submit</button></div>'+
  '</div>';
  inspLevelChange();
}
window.inspLevelChange=function(){
  const raw=($('inLevel')&&$('inLevel').value)||'Flat Level';
  const lvl=raw.split('::')[0];
  const show={
    'Project Level':{block:false,floor:false,flat:false},
    'Tower Level':{block:true,floor:false,flat:false},
    'Floor Level':{block:true,floor:true,flat:false},
    'Flat Level':{block:true,floor:true,flat:true}
  }[lvl]||{block:true,floor:true,flat:true};
  const set=(id,vis)=>{const el=$(id); if(el)el.style.display=vis?'':'none';};
  set('fgBlock',show.block); set('fgFloor',show.floor); set('fgFlat',show.flat);
};
/* ---- Level field: custom icon dropdown (backed by the hidden #inLevel input) ---- */
window.inspLevelDdToggle=function(ev){
  if(ev)ev.stopPropagation();
  const m=$('levelDdMenu'); if(!m)return;
  document.querySelectorAll('.insp-dd-menu.show').forEach(x=>{ if(x!==m)x.classList.remove('show'); });
  m.classList.toggle('show');
};
window.inspLevelPick=function(level,area,icon,label){
  const val=area?(level+'::'+area):level;
  const inp=$('inLevel'); if(inp)inp.value=val;
  const iconEl=$('levelDdIcon'); if(iconEl)iconEl.className='fa-solid '+icon;
  const labelEl=$('levelDdLabel'); if(labelEl)labelEl.textContent=label;
  const m=$('levelDdMenu'); if(m)m.classList.remove('show');
  inspLevelChange();
};
document.addEventListener('click',function(e){ if(!e.target.closest('.insp-dd')) document.querySelectorAll('.insp-dd-menu.show').forEach(x=>x.classList.remove('show')); });
/* ---- Component > Section checklist (New Inspection form) ----
   Place has been removed — each Work Category is now a single flat checklist.
   Every component's checklist is grouped into one or more named `sections`
   ({name, items}). Sections are purely organizational — every item in every
   section is required, same as the rest of the form. */
function inspComponentsFor(cat){ return (window.INSP_TREE||{})[cat]||[]; }
function inspAnsKey(comp,section,id){ return comp+'::'+(section||'')+'::'+id; }
function inspCompSections(comp){ return (comp.sections&&comp.sections.length)?comp.sections:[{name:null,items:comp.items||[]}]; }
function inspRequiredTotal(cat){
  let n=0;
  inspComponentsFor(cat).forEach(c=>inspCompSections(c).forEach(s=>{ n+=s.items.length; }));
  return n;
}
function inspAnsweredCount(){ return INSP_FORM_STATE?Object.values(INSP_FORM_STATE.answers).filter(Boolean).length:0; }
window.inspItems=function(){
  const cat=$('inCat').value, host=$('inItems');
  if(!cat){ INSP_FORM_STATE=null; host.innerHTML='<div class="empty" style="padding:24px">Select a work category to load its checklist.</div>'; return; }
  const comps=inspComponentsFor(cat);
  if(!comps.length){ INSP_FORM_STATE=null; host.innerHTML='<div class="empty" style="padding:24px">No checklist configured yet for '+esc(cat)+'.</div>'; return; }
  INSP_FORM_STATE={cat,answers:{}};
  inspRenderChecklist();
};
function inspRenderChecklist(){
  const st=INSP_FORM_STATE, host=$('inItems'); if(!st||!host)return;
  const comps=inspComponentsFor(st.cat);
  const total=inspRequiredTotal(st.cat), answered=inspAnsweredCount();
  const pct=total?Math.round(answered/total*100):0;
  const mkRow=(comp,secName,it)=>{
    const key=inspAnsKey(comp.name,secName,it.id), status=st.answers[key]||'';
    const mk=s=>{const sel=status===s;const cls=s==='OK'?'ok':/NOT/.test(s)?'no':'na';return '<button type="button" class="ic-btn'+(sel?' on '+cls:'')+'" data-s="'+s+'" onclick="inspPick(this)">'+s+'</button>';};
    return '<div class="insp-check" data-key="'+esc(key)+'" data-status="'+esc(status)+'"><div class="ic-main"><div class="ic-id">'+esc(it.id)+'</div><div class="ic-txt">'+esc(it.check)+(it.criteria?'<div class="ic-cri">'+esc(it.criteria)+'</div>':'')+'</div></div><div class="ic-seg">'+['OK','NOT OK','NA'].map(mk).join('')+'</div></div>';
  };
  const compsHtml=comps.map(comp=>{
    const secs=inspCompSections(comp);
    const totalCount=secs.reduce((n,s)=>n+s.items.length,0);
    const body=secs.map(s=>{
      const rowsHtml='<div class="insp-checks">'+s.items.map(it=>mkRow(comp,s.name,it)).join('')+'</div>';
      if(!s.name)return rowsHtml;
      const ansInSec=s.items.filter(it=>st.answers[inspAnsKey(comp.name,s.name,it.id)]).length;
      return '<div class="insp-sec-group"><div class="insp-sec-head">'+esc(s.name)+'<span class="insp-comp-count">'+ansInSec+' / '+s.items.length+'</span></div>'+rowsHtml+'</div>';
    }).join('');
    return '<div class="insp-comp-group"><div class="insp-comp-head">'+esc(comp.name)+'<span class="insp-comp-count">'+totalCount+' checks</span></div>'+body+'</div>';
  }).join('');
  host.innerHTML=
    '<div class="insp-progress-row"><div class="progress" style="flex:1"><span style="width:'+pct+'%"></span></div><span class="insp-progress-txt">'+answered+' / '+total+' answered</span></div>'+
    '<div style="display:flex;justify-content:flex-end;gap:8px;margin:10px 0 4px"><button type="button" class="btn btn-sm" onclick="inspBulk(\'OK\')">All OK</button><button type="button" class="btn btn-sm" onclick="inspBulk(\'\')">Clear</button></div>'+
    compsHtml;
}
window.inspPick=function(btn){
  const row=btn.closest('.insp-check'), st=btn.dataset.s;
  row.querySelectorAll('.ic-btn').forEach(b=>b.classList.remove('on','ok','no','na'));
  btn.classList.add('on', st==='OK'?'ok':/NOT/.test(st)?'no':'na');
  row.dataset.status=st;
  if(INSP_FORM_STATE){ INSP_FORM_STATE.answers[row.dataset.key]=st; inspUpdateProgress(); }
};
function inspUpdateProgress(){
  if(!INSP_FORM_STATE)return;
  const total=inspRequiredTotal(INSP_FORM_STATE.cat), answered=inspAnsweredCount();
  const bar=document.querySelector('#inItems .insp-progress-row .progress span'), txt=document.querySelector('#inItems .insp-progress-txt');
  if(bar)bar.style.width=(total?Math.round(answered/total*100):0)+'%';
  if(txt)txt.textContent=answered+' / '+total+' answered';
  // refresh per-section answered/total counters + component header counts
  document.querySelectorAll('#inItems .insp-sec-group').forEach(g=>{
    const rows=[...g.querySelectorAll('.insp-check')];
    const ans=rows.filter(r=>r.dataset.status).length;
    const tag=g.querySelector('.insp-comp-count'); if(tag)tag.textContent=ans+' / '+rows.length;
  });
}
window.inspBulk=function(st){
  if(!INSP_FORM_STATE)return;
  document.querySelectorAll('#inItems .insp-check').forEach(row=>{
    row.querySelectorAll('.ic-btn').forEach(b=>b.classList.remove('on','ok','no','na'));
    if(st){ const b=[...row.querySelectorAll('.ic-btn')].find(x=>x.dataset.s===st); if(b){b.classList.add('on',st==='OK'?'ok':'no'); row.dataset.status=st; INSP_FORM_STATE.answers[row.dataset.key]=st;} }
    else { row.dataset.status=''; delete INSP_FORM_STATE.answers[row.dataset.key]; }
  });
  inspUpdateProgress();
};
window.inspSave=async function(){
  const cat=$('inCat').value; if(!cat){toast('Select a work category','err');return;}
  const insp=($('inInsp').value||'').trim(); if(!insp){toast('Enter the inspector name','err');return;}
  if(!INSP_FORM_STATE||INSP_FORM_STATE.cat!==cat){toast('Reload the checklist for this category','err');return;}
  const comps=inspComponentsFor(cat);
  const total=inspRequiredTotal(cat), answered=inspAnsweredCount();
  if(answered<total){
    toast('Every check needs OK / Not OK / NA before you can submit — '+answered+' of '+total+' done','err');
    return;
  }
  const rawLevel=($('inLevel')&&$('inLevel').value)||'Flat Level';
  const levelParts=rawLevel.split('::'), level=levelParts[0], areaDetail=levelParts[1]||'';
  const lvlShow={
    'Project Level':{block:false,floor:false,flat:false},
    'Tower Level':{block:true,floor:false,flat:false},
    'Floor Level':{block:true,floor:true,flat:false},
    'Flat Level':{block:true,floor:true,flat:true}
  }[level]||{block:true,floor:true,flat:true};
  const project=($('inProject')&&$('inProject').value?$('inProject').value:'');
  const block=lvlShow.block?$('inBlock').value:'', floor=lvlShow.floor?$('inFloor').value:'', flat=lvlShow.flat?$('inFlat').value:'';
  const sec=($('inSec').value||'').trim(), overall=($('inOverall').value||'').trim();
  const b=$('inSaveBtn'); if(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…';}
  let photo=($('inPhoto').value||'').trim();
  const photoFile=$('inPhotoFile')&&$('inPhotoFile').files[0];
  if(photoFile){
    if(b)b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading photo…';
    const {data:upData,error:upErr}=await uploadFileToS3(s3KeyForDefectImg(photoFile.name),photoFile);
    if(upErr){toast('Photo upload failed: '+upErr.message,'err'); if(b){b.disabled=false;b.innerHTML='<i class="fa-solid fa-check"></i> Submit';} return;}
    photo=upData.path;
  }
  const fkParts=[]; if(block)fkParts.push('B'+block); if(floor)fkParts.push(floor); if(flat)fkParts.push(flat); if(areaDetail)fkParts.push(areaDetail);
  const fk=fkParts.length?fkParts.join('-'):(project||level), now=new Date().toISOString();
  const rows=[];
  comps.forEach(c=>inspCompSections(c).forEach(s=>s.items.forEach(it=>{
    const status=INSP_FORM_STATE.answers[inspAnsKey(c.name,s.name,it.id)];
    if(!status)return;
    rows.push({ts:now,inspector:insp,project:project||null,block:block||null,floor:floor||null,flat:flat||null,work_category:cat,sub_area:null,component:c.name,section:s.name||null,item_id:it.id,inspection_check:it.check,status:status,remarks:sec,defect_photo:photo,overall_remark:overall,flat_key:fk,created_by:state.email,insp_level:level,area_detail:areaDetail||null});
  })));
  const {error}=await sb.schema('acc').from('inspection').insert(rows);
  if(error){toast(error.message,'err'); if(b){b.disabled=false;b.innerHTML='<i class="fa-solid fa-check"></i> Submit';} return;}
  /* After the insert, so a photo that uploaded but whose inspection then failed is not counted. */
  /* The unit is built from the values this submit actually used rather than re-read from the form,
     because navTo below clears the screen - by the time a form-reading helper ran, the fields it
     wanted would already be gone. */
  const submittedUnit=inspUnit({project,block,floor,flat,area_detail:areaDetail});
  if(photo){ try{ usageQueue('inspection.new_inspection.upload_or_paste_defect_photo','create',
    {title:(photoFile?photoFile.name:photo), source:(photoFile?'upload':'link'),
     unit:submittedUnit||undefined, category:cat||undefined}, project||undefined); }catch(_e){} }
  // Same reasoning: a section/overall remark is optional free text with no button of its own -
  // only counts as used when the inspector actually typed one, and only once the rows exist.
  if(sec||overall){ try{ usageQueue('inspection.new_inspection.add_section_overall_remarks','create',
    {title:(sec||overall).slice(0,80),
     unit:submittedUnit||undefined, category:cat||undefined}, project||undefined); }catch(_e){} }
  INSP_ROWS=null; INSP_FORM_STATE=null; toast(rows.length+' checks submitted','ok'); navTo('inspection');
};
/* ---- set/change password so Google users can also use email+password ---- */
function userHasPassword(){ try{ return !(state.profile && state.profile.password_set===false); }catch(e){ return true; } }
window.setPasswordModal=function(){
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-key"></i> Set a password</h3></div>
  <div class="modal-body frm">
    <p style="color:var(--slate);font-size:13.5px;margin-bottom:4px">Set a password so you can sign in with <b>email + password</b> as well as Google. This is required before you can continue.</p>
    <label>New password</label><input type="password" id="npw" autocomplete="new-password" placeholder="At least 6 characters">
    <label>Confirm password</label><input type="password" id="npw2" autocomplete="new-password" placeholder="Re-enter password">
  </div>
  <div class="modal-foot"><button class="btn btn-primary" id="spwBtn" onclick="setPasswordSave()"><i class="fa-solid fa-check"></i> Save password</button></div>`);
};
window.setPasswordSave=async function(){
  const p=$('npw').value, p2=$('npw2').value;
  if(!p||p.length<6){toast('Password must be at least 6 characters','err');return;}
  if(p!==p2){toast('Passwords do not match','err');return;}
  const b=$('spwBtn');if(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const {error}=await sb.auth.updateUser({password:p});
  if(error){toast(error.message,'err');if(b){b.disabled=false;b.innerHTML='Save password';}return;}
  try{ await sb.schema('acc').from('user_profile').update({password_set:true}).eq('email',state.email); state.profile=Object.assign(state.profile||{},{password_set:true}); refreshBootCache(); }catch(e){}
  closeModal();toast('Password set — you can now sign in with email + password too','ok');
};
/* ---- complete a "Forgot password" reset (lands here via PASSWORD_RECOVERY after the emailed link) ---- */
window.resetPasswordModal=function(){
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-key"></i> Reset your password</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <p style="color:var(--slate);font-size:13.5px;margin-bottom:4px">Enter a new password for your JAIN-E account.</p>
    <label>New password</label><input type="password" id="rpw" autocomplete="new-password" placeholder="At least 6 characters">
    <label>Confirm password</label><input type="password" id="rpw2" autocomplete="new-password" placeholder="Re-enter password">
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="rpwBtn" onclick="resetPasswordSave()"><i class="fa-solid fa-check"></i> Save new password</button></div>`);
};
window.resetPasswordSave=async function(){
  const p=$('rpw').value, p2=$('rpw2').value;
  if(!p||p.length<6){toast('Password must be at least 6 characters','err');return;}
  if(p!==p2){toast('Passwords do not match','err');return;}
  const b=$('rpwBtn');if(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const {error}=await sb.auth.updateUser({password:p});
  if(error){toast(error.message,'err');if(b){b.disabled=false;b.innerHTML='Save new password';}return;}
  try{ await sb.schema('acc').from('user_profile').update({password_set:true}).eq('email',state.email); state.profile=Object.assign(state.profile||{},{password_set:true}); refreshBootCache(); }catch(e){}
  closeModal();toast('Password updated — you can sign in with it from now on','ok');
};
function promptSetPassword(){
  try{
    if(!userHasPassword()){
      setTimeout(function(){ if(typeof setPasswordModal==='function') setPasswordModal(); }, 1400);
    }
  }catch(e){}
}


boot();


