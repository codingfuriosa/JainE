/* ============================== WEEKLY STATUS ==============================
   The meetings page: run the meeting, write down what was decided, give each decision to a person,
   and see - across every meeting ever held - what is still open.

   WHAT IT IS READ FROM. Meetings and their lines live in ops.meetings / ops.items. The 29 OPS
   meetings and 495 lines imported from the Google Sheet (Feb 2025 onwards) are shown exactly as
   they were kept: the owner as the sheet named them, the four sheet states (open, in progress,
   not done, done). Anything typed here from now on and given a person becomes a real
   Accountability task (acc.ptasks, delegated by whoever typed it) and the ops.items row only points
   at it (ptask_id) - so its status is the task's own, and finishing or approving it in
   Accountability shows here too. Nothing about a task is kept twice.

   THE RULES ARE ACCOUNTABILITY'S, NOT THIS PAGE'S. A task needs a title and at least one member
   who is not you; the due date is optional and may repeat weekly or monthly; status is never
   picked - Pending, then the member marks it done (Awaiting Approval), then you approve it. The
   inserts, approvals, send-backs and reopenings below are the same writes accountability.js makes,
   because this page cannot load that file.

   A line typed with nobody named is saved as a draft (ops.items.is_draft) and shown under
   "Unassigned" - JainE will not create a task without a member, so until someone is given it, it
   is only a note on the meeting.

   A KIND IS A SERIES. "OPS", "OPS & Purchase" ... are what the sheet called each meeting; every
   meeting of one kind shares one Pending / All tasks / Finished history, because the open work of
   the last OPS meeting is the agenda of the next one. */

const WM={items:null,meetings:null,people:[],err:'',cur:null,view:'meeting',tab:'pending',q:'',who:'',
  allF:'pending',allG:'meeting',allMtg:'',allWho:'',showPpl:false,wk:null,showPast:false,
  picked:{mem:[],due:null,recur:'none'},parsed:null,sugIdx:0,lastNew:null,lastDraft:null,
  sel:new Set(),draftMem:{},draftRecur:{},timer:null,busy:false};

const WM_RECUR={none:'Does not repeat',weekly:'Weekly',monthly:'Monthly'};
const WM_LEGACY={open:'Open',in_progress:'In progress',not_done:'Not done',done:'Done'};

function wmToday(){
  try{ const d=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'}));
       return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  catch(e){ return new Date().toISOString().slice(0,10); }
}
function wmIso(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function wmAdd(s,n){ const d=new Date(s+'T00:00'); d.setDate(d.getDate()+n); return wmIso(d); }
function wmDays(a,b){ return Math.round((new Date(b+'T00:00')-new Date(a+'T00:00'))/864e5); }
function wmFmt(s){ return s?new Date(String(s).slice(0,10)+'T00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'}):''; }
function wmFmtS(s){ return s?new Date(String(s).slice(0,10)+'T00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'}):''; }
function wmQ(sel){ return document.querySelector(sel); }

/* ---------- people ---------- */
function wmPerson(email){ return WM.people.find(p=>p.email&&email&&p.email.toLowerCase()===String(email).toLowerCase()); }
function wmName(email){ const p=wmPerson(email); return p?p.name:String(email||'').split('@')[0]; }
function wmFirst(email){ return wmName(email).split(' ')[0]; }
function wmDept(email){ const p=wmPerson(email); return p&&p.dept?p.dept:''; }
function wmIsMe(email){ return !!email&&!!state.email&&String(email).toLowerCase()===state.email.toLowerCase(); }
// The @name a person is typed as: the full name without spaces, so two people who share a first
// name can never be confused.
function wmTag(p){ return p.name.replace(/\s+/g,''); }

/* ---------- one item, the same shape whether it came from the sheet or from a task ---------- */
function wmItem(r){
  const linked=r.ptask_id!=null;
  const st=linked ? (r.task_status==='Completed'?'done':r.task_status==='Awaiting Approval'?'awaiting':'pending')
                  : (r.status||'open');
  return {id:r.id, meeting:r.meeting_id, date:r.meeting_date, kind:r.kind||'Meeting', t:r.item||'', linked, draft:!!r.is_draft,
    ptask:r.ptask_id, st, due:linked?r.task_due:r.due_date, dueRaw:r.due_raw,
    mem:linked?(r.task_assignees||[]):[], owner:r.owner||r.owner_raw||'',
    doneOn:linked?(r.task_approved_at||r.task_completed_at):r.done_at, recur:r.task_recur, delegator:r.task_delegator};
}
const wmOpen=it=>it.st!=='done';
const wmOverdue=it=>wmOpen(it)&&it.due&&String(it.due).slice(0,10)<wmToday();
// Who an item is with, as one key per person: the JainE account for a task, the sheet's name for an
// imported line.
function wmWhoKeys(it){
  if(it.linked) return it.mem.map(e=>'e:'+e.toLowerCase());
  // A sheet name that is exactly someone's JainE name is that person, so their old lines and their
  // new tasks sit under one heading.
  const n=(it.owner||'').trim().toLowerCase(), p=n&&WM.people.find(x=>x.name.toLowerCase()===n);
  return [p?'e:'+p.email.toLowerCase():'o:'+(it.owner||'No owner')];
}
function wmKeyName(k){ return k.startsWith('e:')?wmName(k.slice(2)):k.slice(2); }
function wmKeyDept(k){ return k.startsWith('e:')?wmDept(k.slice(2)):''; }
function wmNames(it){ return it.linked?(it.mem.length===1?wmFirst(it.mem[0]):it.mem.length?wmFirst(it.mem[0])+' +'+(it.mem.length-1):'—'):(it.owner||'No owner'); }

/* ---------- load ---------- */
async function wmLoad(){
  try{
    const r=await Promise.all([sb.rpc('ops_weekly_meetings'), sb.rpc('ops_weekly_items'), sb.schema('acc').rpc('people')]);
    if(r[0].error) throw r[0].error;
    if(r[1].error) throw r[1].error;
    WM.meetings=(r[0].data||[]).slice().sort((a,b)=>a.meeting_date<b.meeting_date?1:a.meeting_date>b.meeting_date?-1:b.id-a.id);
    WM.items=(r[1].data||[]).map(wmItem);
    WM.people=((r[2]&&r[2].data)||[]).filter(p=>p&&p.email).map(p=>({email:p.email,name:p.full_name||String(p.email).split('@')[0],
      dept:Array.isArray(p.department)?(p.department[0]||''):(p.department||'')})).sort((a,b)=>a.name<b.name?-1:1);
  }catch(e){ WM.items=null; WM.err=(e&&e.message)||String(e); }
}
async function wmReload(){
  const {data,error}=await sb.rpc('ops_weekly_items');
  if(error) throw error;
  WM.items=(data||[]).map(wmItem);
}
async function wmReloadMeetings(){
  const {data,error}=await sb.rpc('ops_weekly_meetings');
  if(error) throw error;
  WM.meetings=(data||[]).slice().sort((a,b)=>a.meeting_date<b.meeting_date?1:a.meeting_date>b.meeting_date?-1:b.id-a.id);
}
const wmMeeting=id=>(WM.meetings||[]).find(m=>m.id===id);
const wmSeries=kind=>(WM.meetings||[]).filter(m=>m.kind===kind);

VIEWS.weekly_status=async function(v){
  setCrumb(['Overview','Weekly Status']);
  document.body.classList.add('wm-dark');
  loader(v);
  await wmLoad();
  if(WM.items===null){
    v.innerHTML=WM_CSS+'<div class="wm"><div class="wm-top"><h1>Weekly Status</h1></div><div class="wm-empty"><b>Could not load.</b>'+esc(WM.err||'')+'</div></div>';
    return;
  }
  const today=wmToday();
  WM.cur=((WM.meetings||[]).find(m=>m.meeting_date===today)||(WM.meetings||[]).find(m=>m.meeting_date<=today)||(WM.meetings||[])[0]||{}).id||null;
  WM.wk=wmMonday(today);
  v.innerHTML=WM_CSS+'<div class="wm" id="wmRoot"></div>';
  wmRender();
};

function wmRender(){
  const root=$('wmRoot'); if(!root) return;
  const hour=new Date().getHours(), hi=hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';
  const open=WM.items.filter(it=>!it.draft&&wmOpen(it));
  root.innerHTML=`
  <div class="wm-top wm-in">
    <div class="wm-date">${esc(new Date(wmToday()+'T00:00').toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'}))}</div>
    <h1>${hi}.</h1>
    <div class="wm-lead"><button class="wm-lnk ${WM.view==='all'?'on':''}" onclick="wmOpenAll('pending')"><b id="wmPend">${open.length}</b> tasks pending</button></div>
  </div>
  <div class="wm-grid"><div id="wmMain"></div><aside class="wm-rail"><div class="wm-railbtns"><button class="wm-btn wm-sm wm-light" onclick="wmStartMeeting()"><i class="fa-solid fa-play"></i> Start a meeting</button><button class="wm-btn wm-sm wm-line" onclick="wmScheduleMeeting()"><i class="fa-regular fa-calendar-plus"></i> Schedule a meeting</button></div><div class="wm-box" id="wmNav"></div></aside></div>`;
  wmPaintNav();
  if(WM.view==='all') wmPaintAll(); else wmPaintMeeting();
}
function wmCounts(){ const n=WM.items.filter(it=>!it.draft&&wmOpen(it)).length; const e=$('wmPend'); if(e) e.textContent=n; }

/* ---------- right rail: the week, Monday to Saturday ---------- */
function wmMonday(iso){ const d=new Date(iso+'T00:00'); d.setDate(d.getDate()-((d.getDay()+6)%7)); return wmIso(d); }
const WM_DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const wmTime=t=>t?String(t).slice(0,5):'';
// The arrows step to the next week that has a meeting in it: meetings are every two or three
// weeks, and walking through the empty weeks between them one click at a time would be tedious.
function wmWeeks(){ const s=new Set((WM.meetings||[]).map(m=>wmMonday(m.meeting_date))); s.add(wmMonday(wmToday())); return [...s].sort(); }
window.wmWeekStep=function(dir){
  const ws=wmWeeks(), i=ws.indexOf(WM.wk), j=i<0?ws.findIndex(w=>w>WM.wk)-(dir<0?1:0):i+dir;
  if(j>=0&&j<ws.length){ WM.wk=ws[j]; WM.showPast=false; wmPaintNav(); }
};
function wmPaintNav(){
  const nav=$('wmNav'); if(!nav) return;
  const today=wmToday(), mon=WM.wk||wmMonday(today), thisWeek=mon===wmMonday(today), ws=wmWeeks(), i=ws.indexOf(mon);
  const sat=wmAdd(mon,5), fmtD=s=>new Date(s+'T00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'});
  nav.innerHTML=`<div class="wm-wk"><button onclick="wmWeekStep(-1)" ${i<=0?'disabled':''} title="Earlier meetings"><i class="fa-solid fa-chevron-left"></i></button>
      <span>${thisWeek?'This week':esc(fmtD(mon)+' – '+fmtD(sat))}</span>
      <button onclick="wmWeekStep(1)" ${i<0||i>=ws.length-1?'disabled':''} title="Later meetings"><i class="fa-solid fa-chevron-right"></i></button></div>
    ${thisWeek?`<button class="wm-quiet" style="margin:0 0 6px" onclick="WM.showPast=!WM.showPast;wmPaintNav()"><i class="fa-solid fa-chevron-${WM.showPast?'down':'up'}"></i> ${WM.showPast?'Hide earlier days':'Earlier this week'}</button>`:''}
    ${WM_DAYS.map((d,k)=>{ const date=wmAdd(mon,k), ms=(WM.meetings||[]).filter(m=>m.meeting_date===date).sort((a,b)=>String(a.start_time||'')<String(b.start_time||'')?-1:1);
      if(thisWeek&&!WM.showPast&&date<today&&!ms.some(m=>m.id===WM.cur&&WM.view==='meeting')) return '';
      return `<div class="wm-dl ${date===today?'today':''}">${date===today?'Today':d.slice(0,3)+' '+new Date(date+'T00:00').getDate()}</div>`+
        ms.map(m=>`<div class="wm-mi ${WM.view==='meeting'&&WM.cur===m.id?'on':''} ${date>today?'up':''}" onclick="wmOpenMeeting(${m.id})"><span class="t">${esc(wmTime(m.start_time))}</span><span class="n">${esc(m.kind||'Meeting')}</span>${date===today?'<span class="live"></span>':''}</div>`).join(''); }).join('')}`;
}

/* ---------- a meeting ---------- */
window.wmOpenMeeting=function(id){ const m=wmMeeting(id); WM.view='meeting'; WM.cur=id; if(m) WM.wk=wmMonday(m.meeting_date); WM.tab='pending'; WM.q=''; WM.who=''; WM.showPpl=false; WM.picked={mem:[],due:null,recur:'none'}; wmRender(); window.scrollTo({top:0,behavior:'smooth'}); };
function wmPaintMeeting(){
  clearInterval(WM.timer);
  const main=$('wmMain'); if(!main) return;
  const m=wmMeeting(WM.cur);
  if(!m){ main.innerHTML=`<div class="wm-card"><div class="wm-card-top"><h2>No meeting yet</h2><div class="wm-mute" style="margin-top:8px">Start one from the list on the right.</div></div></div>`; return; }
  const today=wmToday(), series=wmSeries(m.kind), first=series.length?series[series.length-1].meeting_date:m.meeting_date;
  const isToday=m.meeting_date===today, att=m.attendees||[];
  const started=(function(){ try{ return Number(localStorage.getItem('wm_start_'+m.id))||0; }catch(e){ return 0; } })();
  main.innerHTML=`<div class="wm-card wm-in"><div class="wm-card-top">
    <div class="wm-mh">
      <div>
        <div class="wm-eyebrow">${isToday?`<span class="wm-live">Today${m.start_time?' · '+esc(wmTime(m.start_time)):''}</span>${started?`<span class="wm-tm" id="wmTimer"></span>`:''}`:m.meeting_date>today?'Coming up · '+esc(wmFmt(m.meeting_date))+(m.start_time?', '+esc(wmTime(m.start_time)):''):'Held on '+esc(wmFmt(m.meeting_date))}</div>
        <h2>${esc(m.kind||'Meeting')}<span class="wm-info"><i class="fa-solid fa-circle-info"></i><span class="tip">${series.length} meeting${series.length===1?'':'s'} of this kind since ${esc(wmFmtS(first))}${m.note?'<br>'+esc(m.note):''}</span></span></h2>
      </div>
      ${isToday?`<button class="wm-btn wm-red" onclick="wmEndMeeting()">End meeting</button>`:''}
    </div>
    <div class="wm-mh2">
      <div class="wm-dd" id="wmPpl">${wmPplHtml(att)}</div>
      ${series.length>1?`<select class="wm-hsel" onchange="wmOpenMeeting(Number(this.value))" title="Earlier meetings">${series.map(x=>`<option value="${x.id}" ${x.id===m.id?'selected':''}>${x.id===m.id?'Earlier meetings':(x.meeting_date===today?'Today':esc(wmFmt(x.meeting_date)))}</option>`).join('')}</select>`:''}
    </div>
    </div><div class="wm-card-body">
    <div class="wm-cap">
      <div class="wm-cap-in"><input id="wmSmart" autocomplete="off" placeholder="Write a task and press Enter…" oninput="wmParse()" onkeydown="wmKey(event)"><span class="kbd">Enter ↵</span></div>
      <div class="wm-parsed" id="wmParsed"></div>
      <div class="wm-sugg" id="wmSugg" style="display:none"></div>
    </div>
    <div id="wmDrafts"></div>
    <div class="wm-v6" id="wmTasks"></div>
  </div></div>`;
  wmParse(); wmPaintDrafts(); wmPaintTabs();
  if(isToday&&started){
    const tick=()=>{ const t=$('wmTimer'); if(!t) return; const x=Math.max(0,Math.floor((Date.now()-started)/1000)); t.textContent=String(Math.floor(x/60)).padStart(2,'0')+':'+String(x%60).padStart(2,'0'); };
    tick(); WM.timer=setInterval(tick,1000);
  }
}

/* Who was there, as a dropdown of JainE's people chips. It redraws only itself, so a task half typed
   in the line below is never lost by opening or closing it. */
function wmPplHtml(att){
  return `<button class="wm-quiet" onclick="wmTogglePpl()">${att.length?att.length+' present':'No attendance yet'} <i class="fa-solid fa-chevron-${WM.showPpl?'up':'down'}"></i></button>`+
    (WM.showPpl?`<div class="wm-dd-panel">${att.map(n=>{ const p=WM.people.find(x=>x.name.toLowerCase()===String(n).toLowerCase());
        return `<span class="people-chip">${avatar(n)} <span>${esc(n)}</span>${p&&p.dept?`<em>${esc(p.dept)}</em>`:''}</span>`; }).join('')||'<div class="wm-mute" style="font-size:13px;padding:4px 2px">Nobody marked yet.</div>'}
      <button class="wm-quiet wm-dd-edit" onclick="wmEditAttendance()"><i class="fa-solid fa-pen"></i> ${att.length?'Edit attendance':'Who was there?'}</button></div>`:'');
}
window.wmTogglePpl=function(open){
  WM.showPpl=open===undefined?!WM.showPpl:open;
  const host=$('wmPpl'), m=wmMeeting(WM.cur); if(host&&m) host.innerHTML=wmPplHtml(m.attendees||[]);
};
document.addEventListener('click',function(e){ if(WM.showPpl&&!e.target.closest('#wmPpl')&&!e.target.closest('#modalHost')) wmTogglePpl(false); });

/* Start a meeting now, or schedule one for later. Same form and the same write: Start is today at
   the current time and begins the clock; Schedule asks for the day and the time. The kinds offered
   are the ones already in use, or a new one. */
function wmNowTime(){ try{ return new Date().toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''; } }
window.wmMeetingForm=function(mode){
  const later=mode==='schedule', kinds=[...new Set((WM.meetings||[]).map(m=>m.kind).filter(Boolean))];
  openModal(`<div class="modal-head"><h3>${later?'Schedule a meeting':'Start a meeting'}</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Which meeting</label><select id="wmKind" onchange="$('wmKindNew').style.display=this.value==='__new'?'':'none'">${kinds.map(k=>`<option>${esc(k)}</option>`).join('')}<option value="__new">A new kind of meeting…</option></select>
    <input id="wmKindNew" placeholder="e.g. Sales Review" style="display:${kinds.length?'none':''};margin-top:8px">
    ${later?`<div class="two"><div><label>Date</label><input type="date" id="wmDate" min="${wmToday()}" value="${wmAdd(wmToday(),1)}"></div>
      <div><label>Time</label><input type="time" id="wmTime" value="10:30"></div></div>`:''}
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="wmStartBtn" onclick="wmMeetingSave('${later?'schedule':'start'}')"><i class="fa-solid fa-${later?'calendar-plus':'play'}"></i> ${later?'Schedule':'Start'}</button></div>`);
  if(!kinds.length) $('wmKind').value='__new';
};
window.wmStartMeeting=function(){ wmMeetingForm('start'); };
window.wmScheduleMeeting=function(){ wmMeetingForm('schedule'); };
window.wmMeetingSave=async function(mode){
  const later=mode==='schedule', sel=$('wmKind').value, kind=sel==='__new'?($('wmKindNew').value||'').trim():sel;
  const date=later?($('wmDate').value||''):wmToday(), time=later?($('wmTime').value||null):(wmNowTime()||null);
  if(!kind){ toast('Choose which meeting this is','err'); return; }
  if(!date){ toast('Choose a date','err'); return; }
  if(later&&date<wmToday()){ toast('Choose today or a later day','err'); return; }
  const b=$('wmStartBtn'); b.disabled=true;
  try{
    const {data,error}=await sb.rpc('ops_meeting_create',{p_kind:kind,p_date:date,p_time:time}); if(error) throw error;
    if(!later){ try{ localStorage.setItem('wm_start_'+data,String(Date.now())); }catch(e){} }
    await wmReloadMeetings(); closeModal();
    toast(later?'Scheduled for '+wmFmt(date)+(time?', '+wmTime(time):''):'Meeting started','ok');
    wmOpenMeeting(Number(data));
  }catch(e){ b.disabled=false; toast('Could not '+(later?'schedule':'start')+' the meeting: '+((e&&e.message)||e),'err'); }
};

/* Attendance, by name - the way the imported meetings record it. */
window.wmEditAttendance=function(){
  const m=wmMeeting(WM.cur); if(!m) return;
  const have=new Set(m.attendees||[]), names=[...new Set(WM.people.map(p=>p.name).concat(m.attendees||[]))].sort();
  window._wmAtt=have;
  openModal(`<div class="modal-head"><h3>Who was there?</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body wm-pk"><input type="text" placeholder="Search people" oninput="document.querySelectorAll('.wm-pk label').forEach(l=>l.style.display=l.textContent.toLowerCase().includes(this.value.toLowerCase())?'':'none')">
    <div style="max-height:380px;overflow-y:auto;margin-top:6px">${names.map(n=>`<label><input type="checkbox" ${have.has(n)?'checked':''} onchange="this.checked?_wmAtt.add(this.value):_wmAtt.delete(this.value)" value="${esc(n)}">${avatar(n)} ${esc(n)}</label>`).join('')}</div></div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="wmSaveAttendance()">Save</button></div>`);
};
window.wmSaveAttendance=async function(){
  try{
    const {error}=await sb.rpc('ops_meeting_set_attendees',{p_meeting:WM.cur,p_people:[..._wmAtt]}); if(error) throw error;
    await wmReloadMeetings(); closeModal(); WM.showPpl=true; wmPaintMeeting();
  }catch(e){ toast('Could not save attendance: '+((e&&e.message)||e),'err'); }
};

/* ---------- Pending / All tasks / Finished: every meeting of this kind, all its dates ---------- */
function wmPaintTabs(){
  if(WM.view!=='meeting') return wmPaintAllList();
  const host=$('wmTasks'), m=wmMeeting(WM.cur); if(!host||!m) return;
  const all=WM.items.filter(it=>it.kind===m.kind&&!it.draft);
  const match=it=>(!WM.who||wmWhoKeys(it).includes(WM.who))&&(!WM.q||it.t.toLowerCase().includes(WM.q.toLowerCase()));
  const pend=all.filter(wmOpen), fin=all.filter(it=>!wmOpen(it));
  const people=[...new Set(all.flatMap(wmWhoKeys))].sort((x,y)=>wmKeyName(x)<wmKeyName(y)?-1:1);
  const body=WM.tab==='pending'?wmPendingHtml(pend.filter(match)):WM.tab==='all'?wmAllHtml(all.filter(match),all):wmFinishedHtml(fin.filter(match));
  host.innerHTML=`<div class="ttabs">
    <button class="ttab pend ${WM.tab==='pending'?'on':''}" onclick="WM.tab='pending';wmPaintTabs()">Pending <span class="n">${pend.length}</span></button>
    <button class="ttab ${WM.tab==='all'?'on':''}" onclick="WM.tab='all';wmPaintTabs()">All tasks <span class="n">${all.length}</span></button>
    <button class="ttab fin ${WM.tab==='finished'?'on':''}" onclick="WM.tab='finished';wmPaintTabs()">Finished <span class="n">${fin.length}</span></button>
    <div class="tfilter"><input placeholder="Search tasks" value="${esc(WM.q)}" oninput="WM.q=this.value;clearTimeout(window._wmQt);window._wmQt=setTimeout(()=>{wmPaintTabs();const i=wmQ('.wm-v6 .tfilter input');i.focus();i.setSelectionRange(i.value.length,i.value.length)},250)">
      <select onchange="WM.who=this.value;wmPaintTabs()"><option value="">Everyone</option>${people.map(k=>`<option value="${esc(k)}" ${WM.who===k?'selected':''}>${esc(wmKeyName(k))}</option>`).join('')}</select></div>
  </div>${body}`;
  WM.lastNew=null;
}
// Pending: everything not finished, from every meeting of this kind, grouped by person, oldest first.
function wmPendingHtml(list){
  if(!list.length) return `<div class="empty3"><div style="font-size:28px">🎉</div><div style="margin-top:6px">Nothing pending from this meeting${WM.who||WM.q?' for this filter':''}.</div></div>`;
  const keys=[...new Set(list.flatMap(wmWhoKeys))], cnt=k=>list.filter(it=>wmWhoKeys(it).includes(k)).length;
  const hasNew=k=>list.some(it=>it.id===WM.lastNew&&wmWhoKeys(it).includes(k));
  keys.sort((x,y)=>(hasNew(y)-hasNew(x))||(cnt(y)-cnt(x)));
  return `<div style="font-size:12.5px;color:var(--slate);margin-top:10px">Oldest first. Includes everything still open from earlier meetings.</div>`+
  keys.map((k,i)=>{ const mine=list.filter(it=>wmWhoKeys(it).includes(k)).sort((x,y)=>((y.id===WM.lastNew)-(x.id===WM.lastNew))||(x.date<y.date?-1:x.date>y.date?1:x.id-y.id)), od=mine.filter(wmOverdue).length;
    return `<div class="person" style="animation-delay:${Math.min(i,12)*.03}s"><div class="who">${wmAvatar(wmKeyName(k),36)}<div><b>${esc(wmKeyName(k))}</b><span>${esc(wmKeyDept(k)||(k.startsWith('o:')?'From the minutes sheet':''))}</span><br><span class="cnt">${mine.length} pending</span>${od?` <span class="cnt red">${od} overdue</span>`:''}</div></div>
      <div>${mine.map(it=>wmRow(it,k)).join('')}</div></div>`; }).join('');
}
// All tasks: the cumulative record, one group per meeting date, newest first.
function wmAllHtml(list,all){
  const fin=all.filter(it=>!wmOpen(it)&&it.doneOn), withDue=fin.filter(it=>it.due), ontime=withDue.filter(it=>String(it.doneOn).slice(0,10)<=String(it.due).slice(0,10)).length;
  const avg=fin.length?Math.round(fin.reduce((t,it)=>t+Math.max(0,wmDays(it.date,String(it.doneOn).slice(0,10))),0)/fin.length):0;
  const dates=[...new Set(list.map(it=>it.date))].sort().reverse();
  return `<div class="sumrow"><div><b>${all.length}</b><span>tasks assigned in total</span></div><div><b>${all.filter(it=>!wmOpen(it)).length}</b><span>finished</span></div><div><b>${withDue.length?Math.round(ontime/withDue.length*100)+'%':'—'}</b><span>finished on time</span></div><div><b>${fin.length?avg+' days':'—'}</b><span>average time to finish</span></div></div>`+
  (dates.length?dates.map(d=>{ const g=list.filter(it=>it.date===d);
    return `<div class="grp">${esc(wmFmt(d))} ${d===wmToday()?'<span class="tw">Today</span>':''}<small>${g.length} assigned · ${g.filter(it=>!wmOpen(it)).length} finished</small></div>${g.map(it=>wmRow(it,null,true)).join('')}`; }).join('')
  :'<div class="empty3">No tasks match this filter.</div>');
}
// Finished: most recent first, grouped by the month it was closed.
function wmFinishedHtml(list){
  if(!list.length) return `<div class="empty3">Nothing finished yet${WM.who||WM.q?' for this filter':''}.</div>`;
  const mo=it=>String(it.doneOn||it.date).slice(0,7), months=[...new Set(list.map(mo))].sort().reverse();
  return months.map(x=>{ const g=list.filter(it=>mo(it)===x).sort((a,b)=>String(a.doneOn||a.date)<String(b.doneOn||b.date)?1:-1);
    return `<div class="grp">${esc(new Date(x+'-01T00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'}))}<small>${g.length} finished</small></div>${g.map(it=>wmRow(it,null,true)).join('')}`; }).join('');
}
// The core avatar() at a given size: same colour for the same name everywhere in JainE.
function wmAvatar(name,sz){ return '<span class="avatar-sm" style="background:'+colorFor(name)+';width:'+sz+'px;height:'+sz+'px;min-width:'+sz+'px;font-size:'+Math.round(sz*.36)+'px" title="'+esc(name)+'">'+esc(initials(name).toUpperCase())+'</span>'; }

function wmRow(it,forKey,showPeople,showMeeting){
  const bits=[], today=wmToday();
  const from=(showMeeting?esc(it.kind)+', ':'')+(it.date===today?(showMeeting?'today':'Today\'s meeting'):(showMeeting?'':'From ')+esc(wmFmtS(it.date)));
  bits.push(it.meeting!==WM.cur||WM.view!=='meeting'?`<span class="from" onclick="wmOpenMeeting(${it.meeting})">${from}</span>`:`<span>${from}</span>`);
  if(showPeople) bits.push(`<span>${it.linked?it.mem.map(e=>wmAvatar(wmName(e),18)).join('')+' '+esc(it.mem.map(wmFirst).join(', ')):esc(it.owner||'No owner')}</span>`);
  else if(it.linked&&it.mem.length>1) bits.push(`<span>with ${esc(it.mem.filter(e=>'e:'+e.toLowerCase()!==forKey).map(wmFirst).join(', '))}</span>`);
  const due=it.due?String(it.due).slice(0,10):null, done=it.doneOn?String(it.doneOn).slice(0,10):null;
  if(it.st==='done'){
    bits.push(`<span class="ok">Finished${done?' '+esc(wmFmtS(done)):''}</span>`);
    if(due&&done){ const late=wmDays(due,done); bits.push(late>0?`<span class="od">${late} day${late>1?'s':''} late</span>`:`<span>${late<0?(-late)+' day'+(late<-1?'s':'')+' early':'on the day'}</span>`); }
  } else if(it.st==='awaiting') bits.push('<span class="aw">Marked done — waiting for your approval</span>');
  else if(it.st==='in_progress') bits.push('<span class="aw">In progress</span>');
  else if(it.st==='not_done') bits.push('<span class="od">Not done</span>');
  if(wmOpen(it)&&due){ const d=wmDays(due,today); bits.push(wmOverdue(it)?`<span class="od">Overdue ${d} day${d>1?'s':''} · was due ${esc(wmFmtS(due))}</span>`:`<span>Due ${esc(wmFmt(due))}</span>`); }
  else if(wmOpen(it)&&!due&&it.dueRaw) bits.push(`<span>Due: ${esc(it.dueRaw)}</span>`);
  if(it.recur&&it.recur.freq&&it.recur.freq!=='none') bits.push(`<span><i class="fa-solid fa-repeat"></i> ${esc(it.recur.freq==='weekly'?'Weekly':it.recur.freq==='monthly'?'Monthly':it.recur.freq)}</span>`);
  // Imported lines keep the sheet's four states, so they get the sheet's control; tasks follow Accountability.
  const legacyCtl=!it.linked?`<select class="wm-st-sel" onchange="wmSetLegacy(${it.id},this.value,this)">${Object.entries(WM_LEGACY).map(([k,l])=>`<option value="${k}" ${it.st===k?'selected':''}>${l}</option>`).join('')}</select>`:'';
  const pill=it.st==='done'?['f','Finished']:it.st==='awaiting'?['a','Awaiting approval']:wmOverdue(it)?['o','Overdue']:['p',it.linked?'Pending':WM_LEGACY[it.st]||'Open'];
  return `<div class="task ${it.st==='done'?'done':''} ${it.id===WM.lastNew?'new':''}">
    <div class="bx" onclick="wmToggle(${it.id})" title="${it.st==='done'?'Reopen':'Mark finished'}">${it.st==='done'?'<i class="fa-solid fa-check"></i>':''}</div>
    <div style="flex:1;min-width:0"><div class="tt">${esc(it.t)}</div><div class="mt">${bits.join('')}</div>
      ${it.st==='awaiting'?`<div style="display:flex;gap:6px;margin-top:6px"><button class="b ok sm" onclick="wmApprove(${it.id},true)"><i class="fa-solid fa-check"></i> Approve</button><button class="b sb sm" onclick="wmApprove(${it.id},false)">Send back</button></div>`:''}</div>
    ${showPeople?`<span class="st ${pill[0]}">${pill[1]}</span>`:legacyCtl}
  </div>`;
}

/* ---------- ticking, approving: the same writes Accountability makes ---------- */
const ACCX=()=>sb.schema('acc');
function wmFind(id){ return WM.items.find(it=>it.id===id); }
async function wmAfterWrite(){ await wmReload(); wmCounts(); wmPaintTabs(); wmPaintNav(); }
window.wmSetLegacy=async function(id,status,el){
  if(el) el.disabled=true;
  try{
    const {error}=await sb.rpc('ops_item_set_status',{p_id:id,p_status:status}); if(error) throw error;
    usageQueue('weekly_status.tick_an_action_item','update',{status:status});
    toast(status==='done'?'Closed — with your name on it':'Marked '+WM_LEGACY[status].toLowerCase(),'ok');
    await wmAfterWrite();
  }catch(e){ if(el) el.disabled=false; toast('Could not update: '+((e&&e.message)||e),'err'); }
};
window.wmToggle=async function(id){
  const it=wmFind(id); if(!it) return;
  if(!it.linked) return wmSetLegacy(id,it.st==='done'?'open':'done');
  if(!wmIsMe(it.delegator)){ toast('Only '+wmName(it.delegator)+', who assigned it, can close or reopen this task','warn'); return; }
  const tid=it.ptask;
  try{
    if(it.st==='done'){
      await ACCX().from('ptasks').update({approval_state:'open',status:'Pending'}).eq('id',tid);
      await ACCX().from('ptask_activity').insert({task_id:tid,action:'reopened',detail:'Task reopened'});
      try{ await ACCX().from('ptask_comments').insert({task_id:tid,body:'reopened the task',system:true}); }catch(e){}
      toast('Reopened','ok');
    } else {
      // You assigned it, so ticking it completes it outright - Accountability's owner path.
      try{ const r=await ACCX().rpc('complete_subtree',{tid}); if(r&&r.error) throw r.error; }
      catch(e){ await ACCX().from('ptasks').update({status:'Completed',approval_state:'approved',progress:100,approved_at:new Date().toISOString()}).eq('id',tid); }
      try{ await ACCX().rpc('bubble_after_approve',{tid}); }catch(e){}
      await ACCX().from('ptask_activity').insert({task_id:tid,action:'completed',detail:'Completed by owner'});
      usageQueue('weekly_status.tick_an_action_item','update',{status:'done'});
      toast('Completed','ok');
    }
    await wmAfterWrite();
  }catch(e){ toast('Could not update the task: '+((e&&e.message)||e),'err'); }
};
window.wmApprove=async function(id,yes){
  const it=wmFind(id); if(!it||!it.linked) return; const tid=it.ptask;
  try{
    if(yes){
      await ACCX().from('ptasks').update({approval_state:'approved',status:'Completed',approved_by:state.email,approved_at:new Date().toISOString()}).eq('id',tid);
      await ACCX().from('ptask_activity').insert({task_id:tid,action:'approved',detail:'Approved'});
      try{ await ACCX().rpc('complete_subtree',{tid}); }catch(e){}
      try{ await ACCX().rpc('bubble_after_approve',{tid}); }catch(e){}
    } else {
      try{ const r=await ACCX().rpc('reset_subtree',{tid}); if(r&&r.error) throw r.error; }
      catch(e){ await ACCX().from('ptasks').update({approval_state:'declined',status:'Pending'}).eq('id',tid); }
      await ACCX().from('ptask_activity').insert({task_id:tid,action:'declined',detail:'Declined — task restored'});
      try{ await ACCX().from('ptask_comments').insert({task_id:tid,body:'declined the task — restored to the assignee',system:true}); }catch(e){}
    }
    try{ await ACCX().from('notifications').update({read:true}).eq('task_id',tid).eq('kind','approval').eq('recipient',state.email); }catch(e){}
    toast(yes?'Approved':'Sent back','ok');
    await wmAfterWrite();
  }catch(e){ toast('Failed: '+((e&&e.message)||e),'err'); }
};

/* ---------- every pending task, across all meetings ---------- */
window.wmOpenAll=function(f){ if(WM.view==='all'&&WM.allF===f){ WM.view='meeting'; wmRender(); return; } WM.view='all'; WM.allF=f; wmRender(); window.scrollTo({top:0,behavior:'smooth'}); };
function wmPaintAll(){
  clearInterval(WM.timer);
  const main=$('wmMain'); if(!main) return;
  const live=WM.items.filter(it=>!it.draft), n=k=>live.filter(it=>k==='pending'?wmOpen(it):k==='awaiting'?it.st==='awaiting':wmOverdue(it)).length;
  const kinds=[...new Set((WM.meetings||[]).map(m=>m.kind).filter(Boolean))];
  const keys=[...new Set(live.filter(wmOpen).flatMap(wmWhoKeys))].sort((x,y)=>wmKeyName(x)<wmKeyName(y)?-1:1);
  const cm=wmMeeting(WM.cur);
  main.innerHTML=`<div class="wm-card wm-in"><div class="wm-card-top">
    <div class="wm-mh"><div><div class="wm-eyebrow">Across all meetings</div><h2>${{pending:'Pending',awaiting:'Waiting for your approval',overdue:'Overdue'}[WM.allF]}</h2>
      <div class="wm-mute" style="margin-top:8px;font-size:14px">Tick a task to finish it. Click a meeting's name to open it.</div></div>
      ${cm?`<button class="wm-btn wm-line" onclick="WM.view='meeting';wmRender()"><i class="fa-solid fa-arrow-left" style="font-size:11px"></i> ${esc(cm.kind)}</button>`:''}</div>
    </div><div class="wm-card-body"><div class="wm-v6" style="margin-top:26px">
    <div class="ttabs">${['pending','awaiting','overdue'].map(k=>`<button class="ttab ${k==='pending'?'pend':''} ${WM.allF===k?'on':''}" onclick="WM.allF='${k}';wmRender()">${{pending:'Pending',awaiting:'To approve',overdue:'Overdue'}[k]} <span class="n">${n(k)}</span></button>`).join('')}
      <div class="tfilter"><select onchange="WM.allG=this.value;wmPaintAllList()"><option value="meeting" ${WM.allG==='meeting'?'selected':''}>By meeting</option><option value="person" ${WM.allG==='person'?'selected':''}>By person</option></select>
        <select onchange="WM.allMtg=this.value;wmPaintAllList()"><option value="">All meetings</option>${kinds.map(k=>`<option ${WM.allMtg===k?'selected':''}>${esc(k)}</option>`).join('')}</select>
        <select onchange="WM.allWho=this.value;wmPaintAllList()"><option value="">Everyone</option>${keys.map(k=>`<option value="${esc(k)}" ${WM.allWho===k?'selected':''}>${esc(wmKeyName(k))}</option>`).join('')}</select></div></div>
    <div id="wmAllList"></div></div></div></div>`;
  wmPaintAllList();
}
function wmPaintAllList(){
  const host=$('wmAllList'); if(!host) return;
  const list=WM.items.filter(it=>!it.draft&&(WM.allF==='pending'?wmOpen(it):WM.allF==='awaiting'?it.st==='awaiting':wmOverdue(it))&&(!WM.allMtg||it.kind===WM.allMtg)&&(!WM.allWho||wmWhoKeys(it).includes(WM.allWho)))
    .sort((a,b)=>((b.st==='awaiting')-(a.st==='awaiting'))||(String(a.due||'9')<String(b.due||'9')?-1:1));
  if(!list.length){ host.innerHTML='<div class="empty3"><div style="font-size:28px">🎉</div><div style="margin-top:6px">Nothing here for this filter.</div></div>'; return; }
  const latest=kind=>{ const s=wmSeries(kind).filter(m=>m.meeting_date<=wmToday()); return (s[0]||wmSeries(kind)[0]||{}).id; };
  if(WM.allG==='meeting'){
    host.innerHTML=[...new Set(list.map(it=>it.kind))].map(kind=>{ const g=list.filter(it=>it.kind===kind);
      return `<div class="grp" style="cursor:pointer" onclick="wmOpenMeeting(${latest(kind)})">${esc(kind)}<small>${g.length} · ${g.filter(wmOverdue).length} overdue</small></div>${g.map(it=>wmRow(it,null,true)).join('')}`; }).join('');
  } else {
    const keys=[...new Set(list.flatMap(wmWhoKeys))].map(k=>({k,g:list.filter(it=>wmWhoKeys(it).includes(k))})).sort((x,y)=>y.g.length-x.g.length);
    host.innerHTML=keys.map(({k,g})=>`<div class="grp">${wmAvatar(wmKeyName(k),22)} ${esc(wmKeyName(k))}<small>${esc(wmKeyDept(k))}${wmKeyDept(k)?' · ':''}${g.length} pending · ${g.filter(wmOverdue).length} overdue</small></div>${g.map(it=>wmRow(it,k,false,true)).join('')}`).join('');
  }
}

/* ---------- writing a task: type, Enter ---------- */
const WM_WD={sunday:0,sun:0,monday:1,mon:1,tuesday:2,tue:2,tues:2,wednesday:3,wed:3,thursday:4,thu:4,thurs:4,friday:5,fri:5,saturday:6,sat:6};
const WM_MON={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};
function wmParseText(raw){
  let txt=' '+raw+' ', mem=[], due=null, recur='none';
  const others=WM.people.filter(p=>!wmIsMe(p.email));
  txt=txt.replace(/@([A-Za-z.]+)/g,(m,n)=>{
    const k=n.toLowerCase();
    let p=others.find(x=>wmTag(x).toLowerCase()===k);
    if(!p){ const f=others.filter(x=>x.name.split(' ')[0].toLowerCase()===k); if(f.length===1) p=f[0]; }
    if(p){ if(!mem.includes(p.email)) mem.push(p.email); return ' '; } return m; });
  const today=wmToday(), base=new Date(today+'T00:00'), add=n=>wmAdd(today,n);
  // Dates first, then repeats; "weekly"/"monthly" only count at the very end, so "send weekly MIS"
  // keeps its title while "every week" anywhere, or a trailing "weekly", sets the repeat.
  const rules=[
    [/\b(?:by |on |due )?today\b/i,()=>{due=add(0);}],
    [/\b(?:by |on |due )?tomorrow\b/i,()=>{due=add(1);}],
    [/\b(?:by |on |due )?(?:end of (?:the )?week|eow)\b/i,()=>{due=add(Math.max(0,6-base.getDay()));}],
    [/\b(?:by |on |due )?next week\b/i,()=>{due=add(((8-base.getDay())%7)||7);}],
    [/\b(?:by |due )?in (\d+) days?\b/i,m=>{due=add(+m[1]);}],
    [/\b(?:by |on |due )?(\d{1,2})(?:st|nd|rd|th)? (jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\b/i,m=>{ const d=new Date(base.getFullYear(),WM_MON[m[2].toLowerCase()],+m[1]); if(wmIso(d)<today) d.setFullYear(d.getFullYear()+1); due=wmIso(d); }],
    [/\b(?:by |on |due |this |next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thurs?|fri|sat)\b/i,m=>{ const t=WM_WD[m[1].toLowerCase()]; let n=(t-base.getDay()+7)%7; if(n===0) n=7; due=add(n); }],
    [/\bevery ?week\b|\bweekly\s*$/i,()=>{recur='weekly';}],
    [/\bevery ?month\b|\bmonthly\s*$/i,()=>{recur='monthly';}]
  ];
  rules.forEach(([re,fn])=>{ const m=txt.match(re); if(m){ fn(m); txt=txt.replace(re,' '); } });
  const title=txt.replace(/\s+/g,' ').replace(/^[\s,:\-–]+|[\s,:\-–]+$/g,'').replace(/\s+(by|on|due|for|to)$/i,'');
  return {title:title.charAt(0).toUpperCase()+title.slice(1),mem,due,recur};
}
window.wmParse=function(){
  const inp=$('wmSmart'); if(!inp) return;
  const r=wmParseText(inp.value), P=WM.picked;
  const mem=[...new Set([...r.mem,...P.mem])], due=r.due||P.due, recur=r.recur!=='none'?r.recur:P.recur;
  WM.parsed={title:r.title,mem,due,recur:due?recur:'none'};
  const box=$('wmParsed');
  if(!inp.value.trim()&&!P.mem.length) box.innerHTML=`<span class="hint">Add people and dates now or later — <code>@Name</code>, <code>by Friday</code>, <code>in 3 days</code>, <code>every week</code>.</span>`;
  else box.innerHTML=mem.map(e=>`<span class="tok">${wmAvatar(wmName(e),20)} ${esc(wmName(e))} <i class="fa-solid fa-xmark x" onclick="wmDropMem('${esc(e)}')"></i></span>`).join('')+
    `<button class="ctl" onclick="wmPickPeople(WM.parsed.mem,'Assign to',m=>{WM.picked.mem=m;wmParse()})"><i class="fa-solid fa-plus" style="font-size:10px"></i> ${mem.length?'Person':'Assign to'}</button>`+
    `<span class="tok"><i class="fa-regular fa-calendar"></i><input type="date" min="${wmToday()}" value="${due||''}" onchange="WM.picked.due=this.value||null;wmParse()"></span>`+
    (due?`<span class="tok"><i class="fa-solid fa-repeat"></i><select onchange="WM.picked.recur=this.value;wmParse()">${Object.entries(WM_RECUR).map(([k,v])=>`<option value="${k}" ${recur===k?'selected':''}>${v}</option>`).join('')}</select></span>`:'')+
    `<span style="margin-left:auto">${mem.length?'Enter creates the task':'Enter saves it — assign later'}</span>`;
  wmSuggest();
};
window.wmDropMem=function(e){ WM.picked.mem=WM.picked.mem.filter(x=>x!==e); const p=wmPerson(e), i=$('wmSmart'); if(p) i.value=i.value.replace(new RegExp('@('+wmTag(p)+'|'+p.name.split(' ')[0]+')\\b','i'),'').replace(/\s+/g,' '); wmParse(); };
function wmSuggest(){
  const inp=$('wmSmart'), box=$('wmSugg'); if(!inp||!box) return;
  const m=inp.value.slice(0,inp.selectionStart).match(/@([A-Za-z.]*)$/);
  if(!m){ box.style.display='none'; return; }
  const q=m[1].toLowerCase(), list=WM.people.filter(p=>!wmIsMe(p.email)&&p.name.toLowerCase().replace(/\s+/g,'').includes(q)).slice(0,7);
  if(!list.length){ box.style.display='none'; return; }
  WM.sugIdx=Math.min(WM.sugIdx,list.length-1);
  box.innerHTML=list.map((p,i)=>`<div class="${i===WM.sugIdx?'on':''}" onmousedown="event.preventDefault();wmChoose('${esc(p.email)}')">${wmAvatar(p.name,24)} ${esc(p.name)}<span>${esc(p.dept||'')}</span></div>`).join('');
  box.style.display='block'; box._list=list;
}
window.wmChoose=function(email){
  const p=wmPerson(email), inp=$('wmSmart'); if(!p||!inp) return;
  const pos=inp.selectionStart, before=inp.value.slice(0,pos).replace(/@([A-Za-z.]*)$/,'@'+wmTag(p)+' ');
  inp.value=before+inp.value.slice(pos); inp.setSelectionRange(before.length,before.length); WM.sugIdx=0; wmParse(); inp.focus();
};
window.wmKey=function(e){
  const box=$('wmSugg');
  if(box&&box.style.display==='block'){
    if(e.key==='ArrowDown'){ WM.sugIdx++; wmSuggest(); e.preventDefault(); return; }
    if(e.key==='ArrowUp'){ WM.sugIdx=Math.max(0,WM.sugIdx-1); wmSuggest(); e.preventDefault(); return; }
    if(e.key==='Enter'||e.key==='Tab'){ wmChoose(box._list[WM.sugIdx].email); e.preventDefault(); return; }
    if(e.key==='Escape'){ box.style.display='none'; return; }
  }
  if(e.key==='Enter'){ e.preventDefault(); wmAdd1(); }
};

// The repeat rule in Accountability's own shape: weekly on the due date's weekday, monthly on its date.
function wmRule(recur,due){
  if(!due||!recur||recur==='none') return null;
  const d=new Date(due+'T00:00');
  return recur==='weekly'?{freq:'weekly',weekdays:[d.getDay()]}:recur==='monthly'?{freq:'monthly',monthdays:[d.getDate()]}:null;
}
/* Create the Accountability task exactly as "Delegated by me" does: the task, its members, its
   place at the end of your list, and the usage record with the full names. */
async function wmCreateTask(title,mem,due,recur){
  const {data:t,error}=await ACCX().from('ptasks').insert({title,delegator:state.email,due_date:due||null,project_id:null,order_index:0,recur:wmRule(recur,due)}).select().single();
  if(error) throw error;
  const a=await ACCX().from('ptask_assignees').insert(mem.map(e=>({task_id:t.id,email:e})));
  if(a.error) throw a.error;
  try{ await ACCX().rpc('task_rank_append',{p_task_id:t.id}); }catch(e){}
  try{ usageQueue('tasks.tasks.create_task','create',{title:title,assignee:mem.map(wmName).join(', ')}); }catch(e){}
  return t.id;
}
async function wmAdd1(){
  if(WM.busy) return;
  const c=WM.parsed||{}; const m=wmMeeting(WM.cur); if(!m) return;
  // Same checks, order and wording as Accountability's accInsCreate.
  if(!c.title){ toast('Type a title','err'); return; }
  WM.busy=true;
  try{
    if(c.mem.length){
      const tid=await wmCreateTask(c.title,c.mem,c.due,c.recur);
      const {data,error}=await sb.rpc('ops_item_add',{p_meeting:m.id,p_item:c.title,p_ptask:tid,p_owner:c.mem.map(wmName).join(', '),p_due:c.due||null}); if(error) throw error;
      WM.lastNew=data; WM.tab='pending';
      toast('Task created for '+c.mem.map(wmName).join(', '),'ok');
    } else {
      const {data,error}=await sb.rpc('ops_item_add',{p_meeting:m.id,p_item:c.title,p_ptask:null,p_owner:null,p_due:c.due||null}); if(error) throw error;
      WM.lastDraft=data; if(c.recur&&c.recur!=='none') WM.draftRecur[data]=c.recur;
    }
    $('wmSmart').value=''; WM.picked={mem:[],due:null,recur:'none'};
    await wmReload(); wmCounts(); wmParse(); wmPaintDrafts(); wmPaintTabs(); wmPaintNav();
    $('wmSmart').focus();
  }catch(e){ toast('Failed: '+((e&&e.message)||e),'err'); }
  finally{ WM.busy=false; }
}

/* ---------- Unassigned: one at a time, or tick several and give them all the same person ---------- */
function wmDrafts(){ return WM.items.filter(it=>it.draft&&it.meeting===WM.cur); }
function wmPaintDrafts(){
  const host=$('wmDrafts'); if(!host) return;
  const list=wmDrafts();
  [...WM.sel].forEach(id=>{ if(!list.some(d=>d.id===id)) WM.sel.delete(id); });
  if(!list.length){ host.innerHTML=''; return; }
  const memOf=d=>WM.draftMem[d.id]||[], ready=list.filter(d=>memOf(d).length).length, allOn=list.every(d=>WM.sel.has(d.id));
  host.innerHTML=`<div class="wm-un">
    <div class="wm-sec"><input type="checkbox" class="wm-ck" title="Select all" ${allOn?'checked':''} onchange="wmSelAll(this.checked)"> Unassigned <em>${list.length}</em>
      <span class="r">${ready?`<button class="wm-btn wm-sm wm-light" onclick="wmPromote(wmDrafts().filter(d=>(WM.draftMem[d.id]||[]).length).map(d=>d.id))">Create ${ready} ready</button>`:'<span class="wm-mute" style="font-size:12.5px;letter-spacing:0;text-transform:none">Give each a person to send it to Accountability</span>'}</span></div>
    ${WM.sel.size?`<div class="wm-bulk"><b>${WM.sel.size} selected</b>
      <button class="ctl" onclick="wmBulkPeople()"><i class="fa-regular fa-user"></i> Assign to…</button>
      <label class="ctl"><i class="fa-regular fa-calendar"></i><input type="date" min="${wmToday()}" onchange="wmBulkDue(this.value)"></label>
      <span style="margin-left:auto;display:flex;gap:14px;align-items:center"><button class="ctl" onclick="WM.sel.clear();wmPaintDrafts()">Clear</button><button class="wm-btn wm-sm wm-red" onclick="wmPromote([...WM.sel])">Create ${WM.sel.size}</button></span></div>`:''}
    ${list.map(d=>{ const mem=memOf(d), due=d.due?String(d.due).slice(0,10):'';
      return `<div class="wm-dr ${d.id===WM.lastDraft?'new':''}">
      <input type="checkbox" class="wm-ck" ${WM.sel.has(d.id)?'checked':''} onchange="this.checked?WM.sel.add(${d.id}):WM.sel.delete(${d.id});wmPaintDrafts()">
      <input class="ti" value="${esc(d.t)}" onchange="wmDraftText(${d.id},this.value)" title="Click to edit">
      <button class="ctl ${mem.length?'set':''}" onclick="wmPickPeople(WM.draftMem[${d.id}]||[],'Assign to',m=>{WM.draftMem[${d.id}]=m;wmPaintDrafts()})">${mem.length?mem.map(e=>wmAvatar(wmName(e),20)).join('')+' '+esc(mem.map(wmFirst).join(', ')):'<i class="fa-regular fa-user"></i> Assign to'}</button>
      <input type="date" class="${due?'set':''}" min="${wmToday()}" value="${due}" onchange="wmDraftDue(${d.id},this.value)">
      <button class="go ${mem.length?'ready':''}" onclick="wmPromote([${d.id}])">Create →</button>
      <button class="rm" title="Remove" onclick="wmDraftDelete(${d.id})"><i class="fa-solid fa-xmark"></i></button>
    </div>`; }).join('')}
  </div>`;
  WM.lastDraft=null;
}
window.wmSelAll=function(on){ wmDrafts().forEach(d=>on?WM.sel.add(d.id):WM.sel.delete(d.id)); wmPaintDrafts(); };
window.wmBulkPeople=function(){ wmPickPeople([],`Assign ${WM.sel.size} task${WM.sel.size>1?'s':''} to`,m=>{ WM.sel.forEach(id=>WM.draftMem[id]=m.slice()); wmPaintDrafts(); }); };
window.wmBulkDue=async function(v){
  try{ for(const id of WM.sel){ const {error}=await sb.rpc('ops_item_set_due',{p_id:id,p_due:v||null}); if(error) throw error; }
       await wmReload(); wmPaintDrafts(); }catch(e){ toast('Could not set the date: '+((e&&e.message)||e),'err'); }
};
window.wmDraftDue=async function(id,v){
  try{ const {error}=await sb.rpc('ops_item_set_due',{p_id:id,p_due:v||null}); if(error) throw error; await wmReload(); wmPaintDrafts(); }
  catch(e){ toast('Could not set the date: '+((e&&e.message)||e),'err'); }
};
window.wmDraftText=async function(id,v){
  if(!String(v||'').trim()){ toast('Type a title','err'); wmPaintDrafts(); return; }
  try{ const {error}=await sb.rpc('ops_item_set_text',{p_id:id,p_item:v}); if(error) throw error; await wmReload(); }
  catch(e){ toast('Could not save: '+((e&&e.message)||e),'err'); }
};
window.wmDraftDelete=async function(id){
  try{ const {error}=await sb.rpc('ops_item_delete_draft',{p_id:id}); if(error) throw error; WM.sel.delete(id); delete WM.draftMem[id]; await wmReload(); wmPaintDrafts(); }
  catch(e){ toast('Could not remove: '+((e&&e.message)||e),'err'); }
};
window.wmPromote=async function(ids){
  const ds=ids.map(id=>wmFind(id)).filter(Boolean);
  if(!ds.length) return;
  if(ds.some(d=>!(WM.draftMem[d.id]||[]).length)){ toast('Pick at least one member','err'); return; }
  if(WM.busy) return; WM.busy=true;
  let made=0, lastNames='';
  try{
    for(const d of ds){
      const mem=WM.draftMem[d.id], due=d.due?String(d.due).slice(0,10):null;
      lastNames=mem.map(wmName).join(', ');
      const tid=await wmCreateTask(d.t,mem,due,WM.draftRecur[d.id]||'none');
      const {error}=await sb.rpc('ops_item_link_task',{p_id:d.id,p_ptask:tid,p_owner:mem.map(wmName).join(', '),p_due:due}); if(error) throw error;
      delete WM.draftMem[d.id]; delete WM.draftRecur[d.id]; WM.sel.delete(d.id); WM.lastNew=d.id; made++;
    }
    toast(made>1?made+' tasks created':'Task created for '+lastNames,'ok');
  }catch(e){ toast((made?made+' created, then: ':'')+'Failed: '+((e&&e.message)||e),'err'); }
  finally{ WM.busy=false; WM.tab='pending'; await wmReload(); wmCounts(); wmPaintDrafts(); wmPaintTabs(); wmPaintNav(); }
};

// One people picker for the typing line, one draft, or several drafts at once. Never yourself: in
// JainE you cannot be a member of a task you delegate.
window.wmPickPeople=function(initial,title,onDone){
  const draft=new Set(initial||[]); window._wmPick=draft; window._wmPickDone=onDone;
  const m=wmMeeting(WM.cur), here=new Set(m&&m.attendees||[]);
  const others=WM.people.filter(p=>!wmIsMe(p.email)), inRoom=others.filter(p=>here.has(p.name)), rest=others.filter(p=>!here.has(p.name));
  const row=p=>`<label><input type="checkbox" ${draft.has(p.email)?'checked':''} onchange="this.checked?_wmPick.add('${esc(p.email)}'):_wmPick.delete('${esc(p.email)}')">${wmAvatar(p.name,26)} ${esc(p.name)}<span>${esc(p.dept||'')}</span></label>`;
  openModal(`<div class="modal-head"><h3>${esc(title)}</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body wm-pk"><input type="text" placeholder="Search people" oninput="document.querySelectorAll('.wm-pk label').forEach(l=>l.style.display=l.textContent.toLowerCase().includes(this.value.toLowerCase())?'':'none')">
    <div style="max-height:380px;overflow-y:auto;margin-top:6px">${inRoom.length?`<div class="g">In this meeting</div>${inRoom.map(row).join('')}<div class="g">Everyone else</div>`:''}${rest.map(row).join('')}</div></div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="closeModal();_wmPickDone([..._wmPick])">Done</button></div>`);
};

/* ---------- end of meeting ---------- */
window.wmEndMeeting=function(force){
  const m=wmMeeting(WM.cur); if(!m) return;
  const left=wmDrafts().length;
  if(left&&!force){
    openModal(`<div class="modal-head"><h3>${left} task${left>1?'s have':' has'} no one assigned</h3><span class="x" onclick="closeModal()">&times;</span></div>
      <div class="modal-body" style="font-size:14px;color:var(--slate);line-height:1.6">They stay saved on this meeting, but only become Accountability tasks once each has a person.</div>
      <div class="modal-foot"><button class="btn" onclick="closeModal();wmEndMeeting(true)">End anyway</button><button class="btn btn-primary" onclick="closeModal();$('wmDrafts').scrollIntoView({behavior:'smooth',block:'center'})">Assign them now</button></div>`);
    return;
  }
  let mins=0; try{ const s=Number(localStorage.getItem('wm_start_'+m.id))||0; if(s){ mins=Math.max(1,Math.round((Date.now()-s)/60000)); localStorage.removeItem('wm_start_'+m.id); } }catch(e){}
  const mine=WM.items.filter(it=>it.meeting===m.id&&!it.draft), keys=[...new Set(mine.flatMap(wmWhoKeys))];
  const open=WM.items.filter(it=>it.kind===m.kind&&!it.draft&&wmOpen(it)).length;
  openModal(`<div class="modal-head"><h3>Meeting ended</h3><span class="x" onclick="closeModal();wmPaintMeeting()">&times;</span></div>
    <div class="modal-body"><div style="color:var(--slate);font-size:13.5px">${esc(m.kind)}${mins?' · '+mins+' min':''} · ${(m.attendees||[]).length} present · ${mine.length} task${mine.length===1?'':'s'} written · ${open} still pending for this meeting</div>
      <div style="margin-top:14px">${keys.map(k=>`<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--line-2)">${wmAvatar(wmKeyName(k),30)}<div><b>${esc(wmKeyName(k))}</b>${mine.filter(it=>wmWhoKeys(it).includes(k)).map(it=>`<div style="font-size:13px;color:#334155">${esc(it.t)}${it.due?` <span style="color:var(--slate)">· ${esc(wmFmtS(it.due))}</span>`:''}</div>`).join('')}</div></div>`).join('')||'<div style="color:var(--slate)">No tasks were written in this meeting.</div>'}</div></div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal();wmPaintMeeting()">Done</button></div>`);
};

const WM_CSS='<style id="wmCss">'
  /* The page background is white with a soft red glow from the top right and bottom left; the
     meeting card, the week panel and the task list stay dark on top of it. */
  +'body.wm-dark .main,body.wm-dark .view{background:#fff}'
  +'body.wm-dark .view{background:radial-gradient(1000px 560px at 88% -10%,rgba(224,18,28,.10),transparent 62%),'
    +'radial-gradient(820px 520px at -6% 108%,rgba(224,18,28,.07),transparent 60%),#fff;background-attachment:fixed}'
  /* What sits straight on the white page (the greeting, the two meeting buttons) is dark text. */
  +'.wm .wm-top,.wm>.wm-empty{--ink:#0b0c10;--ink2:#374151;--mute:#6b7280;--mute2:#9ca3af}'
  +'.wm-railbtns .wm-light{background:#0b0c10;color:#fff}.wm-railbtns .wm-light:hover{background:#262a33}'
  +'.wm-railbtns .wm-line{color:#0b0c10;background:#fff;box-shadow:inset 0 0 0 1px #d1d5db}.wm-railbtns .wm-line:hover{box-shadow:inset 0 0 0 1px #0b0c10}'
  +'.wm-card,.wm-box{box-shadow:0 18px 44px rgba(11,12,16,.16)}'
  +'.wm{--ink:#f3f4f7;--ink2:#c3c8d2;--mute:#8a909c;--mute2:#5c6270;--hair:rgba(255,255,255,.09);--hair2:rgba(255,255,255,.055);--red:#e0121c;--green:#16a34a;color:var(--ink);padding:12px 18px 60px}'
  +'@keyframes wmIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}'
  +'@keyframes wmFlash{0%{background:rgba(224,18,28,.16)}100%{background:transparent}}'
  +'@keyframes wmPulse{0%{box-shadow:0 0 0 0 rgba(224,18,28,.45)}100%{box-shadow:0 0 0 8px rgba(224,18,28,0)}}'
  +'.wm-in{animation:wmIn .4s cubic-bezier(.2,.8,.2,1) both}'
  +'.wm button{font:inherit}'
  +'.wm-mute{color:var(--mute)}'
  +'.wm-top{max-width:1320px;margin:0 auto 32px}'
  +'.wm-date{font-size:12.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);font-weight:600}'
  +'.wm-top h1{font-size:40px;font-weight:700;letter-spacing:-1.4px;color:var(--ink);margin-top:6px;line-height:1.1}'
  +'.wm-lead{margin-top:14px}'
  +'.wm-lnk{border:0;background:none;padding:0;color:var(--ink2);font-size:15px;cursor:pointer;border-bottom:1px solid transparent}'
  +'.wm-lnk b{color:var(--ink);font-weight:700}.wm-lnk:hover,.wm-lnk.on{border-bottom-color:var(--ink)}'
  +'.wm-empty{padding:60px 0;color:var(--mute)}.wm-empty b{display:block;color:var(--ink);font-size:17px;margin-bottom:6px}'
  +'.wm-grid{max-width:1320px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:24px;align-items:start}'
  +'.wm-rail{position:sticky;top:84px}'
  +'.wm-box{background:#121419;border:1px solid var(--hair2);border-radius:20px;padding:20px 20px 16px}'
  +'.wm-railbtns{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}.wm-railbtns .wm-btn{flex:1;justify-content:center}'
  +'.wm-wk{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}'
  +'.wm-wk span{font-size:13px;font-weight:600;color:var(--ink)}'
  +'.wm-wk button{width:28px;height:28px;border:0;border-radius:50%;background:none;color:var(--mute);cursor:pointer}'
  +'.wm-wk button:hover:not(:disabled){background:var(--hair2);color:var(--ink)}.wm-wk button:disabled{opacity:.3;cursor:default}'
  +'.wm-dl.today{color:var(--red)}'
  +'.wm-dl{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute2);font-weight:600;margin:16px 0 6px}'
  +'.wm-mi{display:flex;align-items:baseline;gap:12px;padding:6px 0 6px 12px;margin-left:-12px;border-left:2px solid transparent;cursor:pointer;color:var(--ink2);font-size:13.5px}'
  +'.wm-mi:hover{color:var(--ink)}.wm-mi.up{color:var(--mute)}'
  +'.wm-mi .t{font-size:12px;color:var(--mute2);width:38px;flex:none;font-variant-numeric:tabular-nums}'
  +'.wm-mi .n{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  +'.wm-mi .c{font-size:11px;color:var(--mute)}'
  +'.wm-mi.on{border-left-color:var(--red);color:var(--ink);font-weight:600}'
  +'.wm-mi .live{width:6px;height:6px;border-radius:50%;background:var(--red);flex:none;align-self:center;animation:wmPulse 1.6s infinite}'
  +'.wm-btn{height:40px;border:0;border-radius:20px;padding:0 20px;font-size:13.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:9px;white-space:nowrap}'
  +'.wm-btn.wm-sm{height:30px;padding:0 13px;font-size:12.5px;letter-spacing:0;text-transform:none}'
  +'.wm-red{background:var(--red);color:#fff}.wm-red:hover{background:#c10f18}'
  +'.wm-light{background:#fff;color:#0b0c10}.wm-light:hover{background:#e8ebf0}'
  +'.wm-line{background:transparent;color:#fff;box-shadow:inset 0 0 0 1px var(--hair)}.wm-line:hover{box-shadow:inset 0 0 0 1px #fff}'
  +'.wm-quiet{border:0;background:none;padding:0;color:var(--mute);font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:7px}'
  +'.wm-quiet:hover{color:var(--ink)}.wm-quiet i{font-size:10px}'
  +'.wm-card{background:#121419;border:1px solid var(--hair2);border-radius:24px;overflow:hidden}'
  +'.wm-card-top{padding:28px 32px 24px;background:radial-gradient(700px 280px at 100% -40%,rgba(224,18,28,.42),transparent 65%),radial-gradient(500px 240px at -10% 150%,rgba(129,140,248,.14),transparent 60%),linear-gradient(135deg,#0d0e13,#1a1d25)}'
  +'.wm-card-top h2{font-size:34px;font-weight:700;letter-spacing:-1.1px;color:var(--ink);margin-top:8px;line-height:1.15}'
  +'.wm-card-body{padding:4px 32px 34px}'
  +'.wm-mh{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap}'
  +'.wm-eyebrow{font-size:12.5px;color:var(--mute);display:flex;align-items:center;gap:8px;font-weight:500}'
  +'.wm-live{color:var(--red);font-weight:600;display:inline-flex;align-items:center;gap:7px}'
  +'.wm-live:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--red);animation:wmPulse 1.6s infinite}'
  +'.wm-tm{font-variant-numeric:tabular-nums;color:var(--ink2)}'
  +'.wm-info{position:relative;display:inline-flex;vertical-align:middle;margin-left:10px;color:var(--mute2);font-size:15px;cursor:default}'
  +'.wm-info:hover{color:var(--ink2)}'
  +'.wm-info .tip{display:none;position:absolute;left:50%;top:calc(100% + 10px);transform:translateX(-50%);background:#1d2029;color:var(--ink2);font-size:13px;font-weight:400;letter-spacing:0;line-height:1.6;white-space:nowrap;padding:10px 14px;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.5);z-index:10}'
  +'.wm-info:hover .tip{display:block}'
  +'.wm-mh2{display:flex;align-items:center;gap:22px;margin-top:22px;flex-wrap:wrap;font-size:13px;color:var(--mute)}'
  /* Who was there: JainE's own people chips (initials + full name), in a dropdown under the count. */
  +'.wm-dd{position:relative}'
  +'.wm-dd-panel{position:absolute;left:0;top:calc(100% + 10px);z-index:20;min-width:280px;max-height:340px;overflow-y:auto;background:#1b1e26;border:1px solid var(--hair);border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:6px;box-shadow:0 20px 50px rgba(0,0,0,.5);animation:wmIn .18s both}'
  +'.wm-dd-panel .people-chip{border-color:rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:var(--ink);font-size:13px}'
  +'.wm-dd-panel .people-chip em{margin-left:auto;font-style:normal;font-size:11.5px;color:var(--mute);padding-left:12px}'
  +'.wm-dd-edit{margin:6px 2px 2px}'
  +'.wm-hsel{border:0;background:none;color:var(--mute);font:inherit;font-size:13px;cursor:pointer;outline:none;padding:0}'
  +'.wm-hsel:hover{color:var(--ink)}.wm-hsel option{background:#171a21;color:#f3f4f7}'
  +'.wm-cap{margin-top:30px;position:relative}'
  +'.wm-cap-in{display:flex;align-items:center;gap:14px;border-bottom:1px solid var(--hair);padding-bottom:12px}'
  +'.wm-cap-in:focus-within{border-bottom-color:var(--ink)}'
  +'.wm-cap-in input{flex:1;min-width:0;border:0;outline:none;background:transparent;font:inherit;font-size:21px;font-weight:500;color:var(--ink);height:40px}'
  +'.wm-cap-in input::placeholder{color:var(--mute2);font-weight:400}'
  +'.wm-cap-in .kbd{font-size:11.5px;color:var(--mute);border:1px solid var(--hair);border-radius:6px;padding:2px 7px;white-space:nowrap}'
  +'.wm-parsed{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:13px;color:var(--mute)}'
  +'.wm-cap:not(:focus-within) .wm-parsed .hint{display:none}'
  +'.wm-parsed .tok{display:inline-flex;align-items:center;gap:7px;color:var(--ink2)}'
  +'.wm-parsed .tok i{color:var(--mute2);font-size:11px}.wm-parsed .tok .x{cursor:pointer}'
  +'.wm-parsed .ctl{border:0;background:none;color:var(--mute);cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:0;font-size:13px}'
  +'.wm-parsed .ctl:hover{color:var(--ink)}'
  +'.wm-parsed input[type=date],.wm-parsed select{border:0;background:none;font:inherit;font-size:13px;color:var(--ink2);outline:none;cursor:pointer;padding:0;color-scheme:dark}'
  +'.wm-parsed select option{background:#171a21}'
  +'.wm-parsed code{font-family:inherit;color:var(--ink2)}'
  +'.wm-sugg{position:absolute;left:0;top:58px;background:#1b1e26;border-radius:14px;padding:6px;min-width:300px;z-index:6;box-shadow:0 20px 50px rgba(0,0,0,.5)}'
  +'.wm-sugg div{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;cursor:pointer;font-size:13.5px;color:var(--ink)}'
  +'.wm-sugg div span{margin-left:auto;font-size:12px;color:var(--mute)}'
  +'.wm-sugg div.on,.wm-sugg div:hover{background:rgba(255,255,255,.07)}'
  +'.wm-un{margin-top:30px}'
  +'.wm-sec{display:flex;align-items:center;gap:12px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);font-weight:600;margin-bottom:6px;min-height:30px}'
  +'.wm-sec em{font-style:normal;color:var(--ink)}.wm-sec .r{margin-left:auto}'
  +'.wm-ck{width:15px;height:15px;accent-color:var(--red);cursor:pointer;flex:none;margin:0}'
  +'.wm-bulk{display:flex;align-items:center;gap:18px;flex-wrap:wrap;background:#fff;color:#0b0c10;border-radius:14px;padding:10px 12px 10px 16px;margin:4px 0 8px;font-size:13px}'
  +'.wm-bulk .ctl{border:0;background:none;color:#0b0c10;cursor:pointer;display:inline-flex;align-items:center;gap:7px;font-size:13px;padding:0}'
  +'.wm-bulk input[type=date]{border:0;background:none;font:inherit;font-size:13px;color:#0b0c10;outline:none}'
  +'.wm-dr{display:flex;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid var(--hair2)}'
  +'.wm-dr.new{animation:wmFlash 1.6s both}'
  +'.wm-dr .ti{flex:1;min-width:0;border:0;outline:none;background:none;font:inherit;font-size:15px;color:var(--ink);padding:2px 0}'
  +'.wm-dr .ctl{border:0;background:none;color:var(--mute);cursor:pointer;display:inline-flex;align-items:center;gap:7px;font-size:13px;white-space:nowrap;padding:0}'
  +'.wm-dr .ctl:hover,.wm-dr .ctl.set{color:var(--ink)}'
  +'.wm-dr input[type=date]{border:0;background:none;font:inherit;font-size:13px;color:var(--mute);outline:none;cursor:pointer;width:112px;color-scheme:dark}'
  +'.wm-dr input[type=date].set{color:var(--ink)}'
  +'.wm-dr .go{border:0;background:none;font-size:13px;font-weight:600;cursor:pointer;color:var(--mute2);padding:0}'
  +'.wm-dr .go.ready{color:var(--red)}'
  +'.wm-dr .rm{border:0;background:none;color:var(--mute2);cursor:pointer;opacity:0}'
  +'.wm-dr:hover .rm{opacity:1}.wm-dr .rm:hover{color:var(--red)}'
  /* The task section: grouped by person, every detail on show - kept exactly as designed. */
  +'.wm-v6{--ink2:#f3f4f7;--line3:rgba(255,255,255,.08);--soft:rgba(255,255,255,.06);--slate:#8a909c;background:#08090c;color:#f3f4f7;color-scheme:dark;border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:2px 22px 18px;margin-top:34px}'
  +'.wm-v6 .ttabs{display:flex;align-items:center;gap:6px;margin:8px 0 6px;border-bottom:1px solid var(--line3);flex-wrap:wrap}'
  +'.wm-v6 .ttab{border:0;background:none;font:inherit;font-size:14px;font-weight:700;color:var(--slate);padding:10px 4px 12px;margin-right:16px;cursor:pointer;position:relative;display:inline-flex;align-items:center;gap:8px}'
  +'.wm-v6 .ttab .n{font-size:11.5px;font-weight:800;background:var(--soft);color:var(--slate);border-radius:9px;padding:1px 8px}'
  +'.wm-v6 .ttab.on{color:var(--ink2)}'
  +'.wm-v6 .ttab.on:after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:3px;border-radius:3px 3px 0 0;background:#e0121c}'
  +'.wm-v6 .ttab.on .n{background:#fff;color:#08090c}.wm-v6 .ttab.on.pend .n{background:#e0121c;color:#fff}.wm-v6 .ttab.on.fin .n{background:#16a34a;color:#fff}'
  +'.wm-v6 .tfilter{margin-left:auto;display:flex;gap:8px;align-items:center;padding-bottom:6px;flex-wrap:wrap}'
  +'.wm-v6 .tfilter select,.wm-v6 .tfilter input{height:32px;border:1px solid var(--line3);border-radius:9px;padding:0 10px;font:inherit;font-size:12.5px;background:#14161c;color:var(--ink2);outline:none}'
  +'.wm-v6 .tfilter select option{background:#14161c;color:var(--ink2)}.wm-v6 .tfilter input{width:170px}'
  +'.wm-v6 .sumrow{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0 6px}'
  +'.wm-v6 .sumrow div{background:var(--soft);border-radius:14px;padding:12px 14px}'
  +'.wm-v6 .sumrow b{font-size:22px;font-weight:800;color:var(--ink2);display:block;letter-spacing:-.5px}'
  +'.wm-v6 .sumrow span{font-size:11.5px;color:var(--slate)}'
  +'.wm-v6 .grp{display:flex;align-items:center;gap:10px;margin:18px 0 6px;font-size:12px;font-weight:800;color:var(--ink2)}'
  +'.wm-v6 .grp:after{content:"";flex:1;height:1px;background:var(--line3)}'
  +'.wm-v6 .grp small{font-weight:600;color:var(--slate)}'
  +'.wm-v6 .grp .tw{background:#e0121c;color:#fff;font-size:10px;border-radius:6px;padding:1px 6px}'
  +'.wm-v6 .person{display:grid;grid-template-columns:200px 1fr;gap:16px;padding:14px 0;border-top:1px solid var(--line3);animation:wmIn .4s both}'
  +'.wm-v6 .person:first-of-type{border-top:0}'
  +'.wm-v6 .who{display:flex;gap:10px;align-items:flex-start}'
  +'.wm-v6 .who b{font-size:13.5px;color:var(--ink2);display:block}'
  +'.wm-v6 .who span{font-size:11.5px;color:var(--slate)}'
  +'.wm-v6 .who .cnt{display:inline-block;margin-top:5px;font-size:11px;font-weight:800;color:var(--ink2);background:var(--soft);border-radius:7px;padding:1px 7px}'
  +'.wm-v6 .who .cnt.red{background:rgba(224,18,28,.16);color:#ff6b72}'
  +'.wm-v6 .task{display:flex;gap:10px;align-items:flex-start;padding:7px 10px;border-radius:11px}'
  +'.wm-v6 .task:hover{background:rgba(255,255,255,.04)}'
  +'.wm-v6 .task.new{animation:wmFlash 1.6s both;background:rgba(224,18,28,.1)}'
  +'.wm-v6 .task .bx{width:18px;height:18px;border-radius:50%;border:1.5px solid #4b5160;flex:none;margin-top:1px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff}'
  +'.wm-v6 .task .bx:hover{border-color:#22c55e}'
  +'.wm-v6 .task.done .bx{background:#22c55e;border-color:#22c55e}'
  +'.wm-v6 .task.done .tt{color:#6b7280}'
  +'.wm-v6 .task .tt{font-size:13.5px;color:var(--ink2);line-height:1.4}'
  +'.wm-v6 .task .mt{font-size:11.5px;color:var(--slate);margin-top:3px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}'
  +'.wm-v6 .task .od{color:#ff5a62;font-weight:700}.wm-v6 .task .aw{color:#f59e0b;font-weight:700}'
  +'.wm-v6 .task span.ok{color:#4ade80;font-weight:700}'
  +'.wm-v6 .task .from{color:#a5b4fc;font-weight:600;cursor:pointer}.wm-v6 .task .from:hover{text-decoration:underline}'
  +'.wm-v6 .st{flex:none;font-size:11px;font-weight:800;border-radius:7px;padding:2px 8px;margin-top:1px}'
  +'.wm-v6 .st.p{background:rgba(255,255,255,.07);color:#c3c8d2}.wm-v6 .st.a{background:rgba(245,158,11,.15);color:#fbbf24}.wm-v6 .st.f{background:rgba(34,197,94,.15);color:#4ade80}.wm-v6 .st.o{background:rgba(224,18,28,.16);color:#ff6b72}'
  +'.wm-v6 .wm-st-sel{flex:none;height:26px;border:1px solid var(--line3);border-radius:7px;background:#14161c;color:var(--ink2);font:inherit;font-size:11.5px;padding:0 6px;cursor:pointer}'
  +'.wm-v6 .b{height:28px;border:0;border-radius:8px;font:inherit;font-weight:700;font-size:12px;padding:0 10px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;white-space:nowrap}'
  +'.wm-v6 .b.ok{background:#16a34a;color:#fff}.wm-v6 .b.ok:hover{background:#15803d}'
  +'.wm-v6 .b.sb{background:rgba(255,255,255,.08);color:#f3f4f7}.wm-v6 .b.sb:hover{background:rgba(255,255,255,.14)}'
  +'.wm-v6 .empty3{border:1.5px dashed var(--line3);border-radius:16px;padding:34px;text-align:center;color:var(--slate);margin-top:14px}'
  +'.wm-pk input[type=text]{width:100%;height:40px;border:1px solid var(--line);border-radius:9px;font:inherit;font-size:14px;outline:none;padding:0 12px}'
  +'.wm-pk label{display:flex;align-items:center;gap:12px;padding:8px 4px;cursor:pointer;font-size:14px;border-radius:8px}'
  +'.wm-pk label:hover{background:#f8fafc}.wm-pk label span{margin-left:auto;font-size:12px;color:var(--slate)}'
  +'.wm-pk .g{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--slate);font-weight:700;padding:14px 4px 4px}'
  +'@media(max-width:1100px){.wm-grid{grid-template-columns:1fr}.wm-rail{position:static}}'
  +'@media(max-width:700px){.wm{padding:6px 0 40px}.wm-top h1{font-size:30px}.wm-card-top,.wm-card-body{padding-left:18px;padding-right:18px}.wm-card-top h2{font-size:26px}'
    +'.wm-v6{padding:2px 14px 14px}.wm-v6 .person{grid-template-columns:1fr;gap:6px}.wm-v6 .sumrow{grid-template-columns:repeat(2,1fr)}.wm-v6 .tfilter{margin-left:0;width:100%}.wm-v6 .tfilter input{flex:1}.wm-dr{flex-wrap:wrap}.wm-dr .ti{flex-basis:100%}}'
+'</style>';
