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
  sel:new Set(),draftMem:{},draftRecur:{},timer:null,busy:false,formPpl:new Set(),kpiT:null,noteT:{},formAg:[],agTimer:null,agView:null,agFollow:true,railOff:undefined};

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
  // Repeating meetings: make sure this week's and next week's dates exist before reading.
  try{ await sb.rpc('ops_meeting_series_fill'); }catch(e){}
  try{
    const r=await Promise.all([sb.rpc('ops_weekly_meetings'), sb.rpc('ops_weekly_items'), sb.schema('acc').rpc('people'), sb.rpc('ops_weekly_notes')]);
    WM.notes=(r[3]&&!r[3].error&&r[3].data)||[];
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
  loader(v);
  await wmLoad();
  if(WM.items===null){
    v.innerHTML=WM_CSS+'<div class="wm"><div class="wm-top"><h1>Weekly Status</h1></div><div class="wm-empty"><b>Could not load.</b>'+esc(WM.err||'')+'</div></div>';
    return;
  }
  const today=wmToday();
  // Opens on today's meeting; otherwise on the latest regular meeting (a kind held more than once,
  // such as OPS), so a one-off - a test or a sample - never becomes the page you land on.
  const ms=WM.meetings||[], regular=m=>ms.filter(x=>x.kind===m.kind).length>1;
  WM.cur=(ms.find(m=>m.meeting_date===today)||ms.find(m=>m.meeting_date<=today&&regular(m))||ms.find(m=>m.meeting_date<=today)||ms[0]||{}).id||null;
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
  <div class="wm-grid ${wmRailOff()?'off':''}" id="wmGrid"><div id="wmMain"></div><aside class="wm-rail">
    <div class="wm-railfold"><button class="wm-ib" onclick="wmRailToggle()" title="Show meetings"><i class="fa-solid fa-angles-left"></i></button><button class="wm-ib" onclick="wmStartMeeting()" title="Start a meeting"><i class="fa-solid fa-play"></i></button><button class="wm-ib" onclick="wmScheduleMeeting()" title="Schedule a meeting"><i class="fa-regular fa-calendar-plus"></i></button></div>
    <div class="wm-railopen"><div class="wm-railbtns"><button class="wm-btn wm-sm wm-light" onclick="wmStartMeeting()"><i class="fa-solid fa-play"></i> Start a meeting</button><button class="wm-btn wm-sm wm-line" onclick="wmScheduleMeeting()"><i class="fa-regular fa-calendar-plus"></i> Schedule a meeting</button><button class="wm-ib" onclick="wmRailToggle()" title="Hide this panel"><i class="fa-solid fa-angles-right"></i></button></div><div class="wm-box" id="wmNav"></div></div></aside></div>`;
  wmPaintNav();
  if(WM.view==='all') wmPaintAll(); else wmPaintMeeting();
}
function wmCounts(){ const n=WM.items.filter(it=>!it.draft&&wmOpen(it)).length; const e=$('wmPend'); if(e) e.textContent=n; }

/* ---------- right rail: the week, Monday to Saturday ---------- */
function wmMonday(iso){ const d=new Date(iso+'T00:00'); d.setDate(d.getDate()-((d.getDay()+6)%7)); return wmIso(d); }
const WM_DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const wmTime=t=>t?String(t).slice(0,5):'';
// The arrows step to the next week that has a meeting in it: meetings are every two or three
// weeks, and walking through the empty weeks between them one click at a time would be tedious.
function wmWeeks(){ const s=new Set((WM.meetings||[]).map(m=>wmMonday(m.meeting_date))); s.add(wmMonday(wmToday())); return [...s].sort(); }
window.wmWeekStep=function(dir){
  const ws=wmWeeks(), w=dir>0?ws.find(x=>x>WM.wk):ws.filter(x=>x<WM.wk).pop();
  if(w){ WM.wk=w; WM.showPast=false; wmPaintNav(); }
};
// Two weeks at a time: the week the arrows are on and the one after it, so this week and next
// week show together. The arrows still jump to the nearest week that has meetings.
function wmPaintNav(){
  const nav=$('wmNav'); if(!nav) return;
  const today=wmToday(), cur=wmMonday(today), mon=WM.wk||cur, ws=wmWeeks(), i=ws.indexOf(mon), next=wmAdd(mon,7);
  const fmtD=s=>new Date(s+'T00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'});
  const label=w=>w===cur?'This week':w===wmAdd(cur,7)?'Next week':w===wmAdd(cur,-7)?'Last week':fmtD(w)+' – '+fmtD(wmAdd(w,6));
  const week=w=>{ const thisWeek=w===cur;
    const days=WM_DAYS.map((d,k)=>{ const date=wmAdd(w,k), ms=(WM.meetings||[]).filter(m=>m.meeting_date===date).sort((a,b)=>String(a.start_time||'')<String(b.start_time||'')?-1:1);
      if(thisWeek&&!WM.showPast&&date<today&&!ms.some(m=>m.id===WM.cur&&WM.view==='meeting')) return '';
      if(!ms.length&&date!==today) return '';
      return `<div class="wm-dl ${date===today?'today':''}">${date===today?'Today':d.slice(0,3)+' '+new Date(date+'T00:00').getDate()}</div>`+
        (ms.map(m=>`<div class="wm-mi ${WM.view==='meeting'&&WM.cur===m.id?'on':''} ${date>today?'up':''}" onclick="wmOpenMeeting(${m.id})"><span class="t">${esc(wmTime(m.start_time))}</span><span class="n">${esc(m.kind||'Meeting')}${m.series_id&&m.series_active?' <i class="fa-solid fa-repeat wm-mi-rep" title="Repeats '+esc(m.recur||'')+'"></i>':''}</span>${date===today&&!m.ended_at?'<span class="live"></span>':''}</div>`).join('')||'<div class="wm-mi up" style="cursor:default">No meeting</div>'); }).join('');
    const lb=label(w), range=fmtD(w)+' – '+fmtD(wmAdd(w,6));
    return `<div class="wm-wkh">${esc(lb)}${lb===range?'':`<small>${esc(range)}</small>`}</div>
      ${thisWeek?`<button class="wm-quiet" style="margin:2px 0 4px" onclick="WM.showPast=!WM.showPast;wmPaintNav()"><i class="fa-solid fa-chevron-${WM.showPast?'down':'up'}"></i> ${WM.showPast?'Hide earlier days':'Earlier this week'}</button>`:''}
      ${days||'<div class="wm-mi up" style="cursor:default;margin-top:6px">No meetings</div>'}`; };
  nav.innerHTML=`<div class="wm-wk"><button onclick="wmWeekStep(-1)" ${i===0||(i<0&&!ws.some(w=>w<mon))?'disabled':''} title="Earlier meetings"><i class="fa-solid fa-chevron-left"></i></button>
      <span>${mon===cur?'Coming up':esc(fmtD(mon)+' – '+fmtD(wmAdd(next,6)))}</span>
      <button onclick="wmWeekStep(1)" ${!ws.some(w=>w>mon)?'disabled':''} title="Later meetings"><i class="fa-solid fa-chevron-right"></i></button></div>
    ${week(mon)}<div class="wm-wksep"></div>${week(next)}`;
}
// Hidden or shown, remembered on this computer.
function wmRailOff(){ if(WM.railOff===undefined){ try{ WM.railOff=localStorage.getItem('wm_rail_off')==='1'; }catch(e){ WM.railOff=false; } } return WM.railOff; }
window.wmRailToggle=function(){
  const off=WM.railOff=!wmRailOff(); try{ localStorage.setItem('wm_rail_off',off?'1':'0'); }catch(e){}
  const g=$('wmGrid'); if(g) g.classList.toggle('off',off);
};

/* ---------- a meeting ---------- */
window.wmOpenMeeting=function(id){ const m=wmMeeting(id); WM.view='meeting'; WM.cur=id;
  // A meeting next week is already in view beside this week, so the panel stays on this week.
  if(m){ const mw=wmMonday(m.meeting_date), cw=wmMonday(wmToday()); WM.wk=mw===wmAdd(cw,7)?cw:mw; } WM.tab='pending'; WM.q=''; WM.who=''; WM.showPpl=false; WM.picked={mem:[],due:null,recur:'none'}; wmRender(); window.scrollTo({top:0,behavior:'smooth'}); };
function wmPaintMeeting(){
  clearInterval(WM.timer);
  const main=$('wmMain'); if(!main) return;
  const m=wmMeeting(WM.cur);
  if(!m){ main.innerHTML=`<div class="wm-card"><div class="wm-card-top"><h2>No meeting yet</h2><div class="wm-mute" style="margin-top:8px">Start one from the list on the right.</div></div></div>`; return; }
  const today=wmToday(), series=wmSeries(m.kind), first=series.length?series[series.length-1].meeting_date:m.meeting_date;
  const isToday=m.meeting_date===today, att=m.attendees||[], ended=!!m.ended_at;
  const started=(function(){ try{ return Number(localStorage.getItem('wm_start_'+m.id))||0; }catch(e){ return 0; } })();
  main.innerHTML=`<div class="wm-card wm-in"><div class="wm-card-top">
    <div class="wm-mh">
      <div>
        <div class="wm-eyebrow">${ended?`<span class="wm-ended"><i class="fa-solid fa-circle-check"></i> ${isToday?'Today':esc(wmFmt(m.meeting_date))} · ended at ${esc(wmClock(m.ended_at))}${m.ran_minutes?' · ran '+m.ran_minutes+' min':''}</span><button class="wm-quiet" onclick="wmReopen()">Reopen</button>`
          :isToday?`<span class="wm-live">Today${m.start_time?' · '+esc(wmTime(m.start_time)):''}</span>`:m.meeting_date>today?'Coming up · '+esc(wmFmt(m.meeting_date))+(m.start_time?', '+esc(wmTime(m.start_time)):''):'Held on '+esc(wmFmt(m.meeting_date))}</div>
        <h2>${esc(m.kind||'Meeting')}<span class="wm-info"><i class="fa-solid fa-circle-info"></i><span class="tip">${series.length} meeting${series.length===1?'':'s'} of this kind since ${esc(wmFmtS(first))}${m.note?'<br>'+esc(m.note):''}</span></span></h2>
      </div>
      ${isToday&&!ended?`<div class="wm-mh-r">${started?`<div class="wm-clock" title="How long this meeting has been running"><span>Meeting running</span><b id="wmTimer">0m 00s</b><small>Started ${esc(wmClock(started))} · now <em id="wmNow">${esc(wmClock(Date.now()))}</em></small></div>`:''}<button class="wm-btn wm-red" onclick="wmEndMeeting()">End meeting</button></div>`:''}
    </div>
    <div class="wm-mh2">
      <div class="wm-dd" id="wmPpl">${wmPplHtml(att)}</div>
      ${m.series_id&&m.recur?`<span class="wm-rep ${m.series_active?'':'off'}" title="${m.series_active?'A repeating meeting':'This meeting no longer repeats'}"><i class="fa-solid fa-repeat"></i> ${esc(m.series_active?wmRecurWords(m.recur,(wmSeries(m.kind).filter(x=>x.series_id===m.series_id).pop()||m).meeting_date,m.start_time):'Stopped repeating')}${m.series_active?` · <button class="wm-quiet" onclick="wmSeriesStop(${m.series_id})">Stop repeating</button>`:''}</span>`:''}
      ${series.length>1?`<select class="wm-hsel" onchange="wmOpenMeeting(Number(this.value))" title="Earlier meetings">${series.map(x=>`<option value="${x.id}" ${x.id===m.id?'selected':''}>${x.id===m.id?'Earlier meetings':(x.meeting_date===today?'Today':esc(wmFmt(x.meeting_date)))}</option>`).join('')}</select>`:''}
    </div>
    </div><div class="wm-card-body">
    ${m.agenda?'<div class="wm-ag" id="wmAg"></div>':`${m.has_kpi?`<div class="wm-kpi"><div class="wm-sec"><span><i class="fa-solid fa-chart-line" style="margin-right:6px"></i>KPI notes</span><span class="r wm-mute" id="wmKpiSt" style="letter-spacing:0;text-transform:none;font-weight:400"></span></div>
      <textarea id="wmKpiTxt" placeholder="Numbers, targets and how they moved since last time…" oninput="wmKpiInput(this)" onblur="wmKpiSave(this)">${esc(m.kpi_notes||'')}</textarea></div>`:''}
    ${m.has_oo?`<div id="wmOoHost" style="margin-top:16px">${wmOoHtml(m)}</div>`:''}
    ${!m.has_kpi||!m.has_oo?`<div class="wm-addsec">${!m.has_kpi?`<button class="wm-quiet" onclick="wmKpiAdd()"><i class="fa-solid fa-plus"></i> Add a KPI section</button>`:''}${!m.has_oo?`<button class="wm-quiet" onclick="wmOoAdd()"><i class="fa-solid fa-plus"></i> Add Obstacles &amp; Opportunities</button>`:''}</div>`:''}
    <div class="wm-addsec" style="margin-top:10px"><button class="wm-quiet" onclick="wmAgAdd()"><i class="fa-solid fa-stopwatch"></i> Run this meeting on the timed agenda</button></div>`}
    <div class="wm-cap">
      <div class="wm-cap-in"><input id="wmSmart" autocomplete="off" placeholder="Write a task and press Enter…" oninput="wmParse()" onkeydown="wmKey(event)"><span class="kbd">Enter ↵</span></div>
      <div class="wm-parsed" id="wmParsed"></div>
      <div class="wm-sugg" id="wmSugg" style="display:none"></div>
    </div>
    <div id="wmDrafts"></div>
    <div class="wm-v6" id="wmTasks"></div>
  </div></div>`;
  wmParse(); wmPaintDrafts(); wmPaintTabs();
  if(m.agenda) wmPaintAgenda(true);
  if(isToday&&started&&!ended){
    // The meeting clock: how long it has run (h:mm:ss once past an hour), and the time now.
    const tick=()=>{ const t=$('wmTimer'); if(!t) return; const x=Math.max(0,Math.floor((Date.now()-started)/1000)), h=Math.floor(x/3600), mm=Math.floor(x%3600/60), ss=x%60;
      t.textContent=h?h+'h '+String(mm).padStart(2,'0')+'m':mm+'m '+String(ss).padStart(2,'0')+'s';
      const n=$('wmNow'); if(n) n.textContent=wmClock(Date.now()); };
    tick(); WM.timer=setInterval(tick,1000);
  }
}

/* Who was there, as a dropdown of JainE's people chips. It redraws only itself, so a task half typed
   in the line below is never lost by opening or closing it. */
function wmPplHtml(att){
  const m=wmMeeting(WM.cur), ahead=!!m&&m.meeting_date>wmToday();
  return `<button class="wm-quiet" onclick="wmTogglePpl()">${att.length?att.length+(ahead?' invited':' present'):(ahead?'Nobody invited yet':'No attendance yet')} <i class="fa-solid fa-chevron-${WM.showPpl?'up':'down'}"></i></button>`+
    (WM.showPpl?`<div class="wm-dd-panel">${att.map(n=>{ const p=WM.people.find(x=>x.name.toLowerCase()===String(n).toLowerCase());
        return `<span class="people-chip">${avatar(n)} <span>${esc(n)}</span>${p&&p.dept?`<em>${esc(p.dept)}</em>`:''}</span>`; }).join('')||'<div class="wm-mute" style="font-size:13px;padding:4px 2px">Nobody marked yet.</div>'}
      <button class="wm-quiet wm-dd-edit" onclick="wmEditAttendance()"><i class="fa-solid fa-pen"></i> ${ahead?'Edit who is invited':att.length?'Edit attendance':'Who was there?'}</button></div>`:'');
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
/* The people picked here get the meeting in their JainE calendar (and JainE's usual invite); the
   person setting it up gets it as the organiser. The list starts with whoever was at the last
   meeting of the same kind, so a regular meeting is one click. */
function wmLastPeople(kind){
  const last=(WM.meetings||[]).find(m=>m.kind===kind&&((m.invitees||[]).length||(m.attendees||[]).length));
  if(!last) return [];
  const byName=(last.attendees||[]).map(n=>WM.people.find(p=>p.name.toLowerCase()===String(n).toLowerCase())).filter(Boolean).map(p=>p.email);
  return [...new Set((last.invitees||[]).concat(byName))].filter(e=>!wmIsMe(e));
}
function wmFormPeople(){
  const host=$('wmFormPpl'); if(!host) return;
  const picked=WM.formPpl, others=WM.people.filter(p=>!wmIsMe(p.email));
  host.innerHTML=`<div class="wm-fp-chips">${[...picked].map(e=>`<span class="people-chip">${wmAvatar(wmName(e),20)} <span>${esc(wmName(e))}</span><i class="fa-solid fa-xmark" style="cursor:pointer;margin-left:4px;color:#94a3b8" onclick="WM.formPpl.delete('${esc(e)}');wmFormPeople()"></i></span>`).join('')||'<span class="wm-fp-none">Nobody picked yet</span>'}</div>
    <input type="text" id="wmFpQ" placeholder="Search people to add" oninput="wmFormPeopleList()" autocomplete="off">
    <div class="wm-fp-list" id="wmFpList"></div>`;
  wmFormPeopleList();
}
window.wmFormPeopleList=function(){
  const q=(($('wmFpQ')||{}).value||'').toLowerCase().trim(), list=$('wmFpList'); if(!list) return;
  const rows=WM.people.filter(p=>!wmIsMe(p.email)&&!WM.formPpl.has(p.email)&&(!q||(p.name+' '+(p.dept||'')).toLowerCase().includes(q))).slice(0,q?30:8);
  list.innerHTML=rows.map(p=>`<div onclick="WM.formPpl.add('${esc(p.email)}');wmFormPeople();$('wmFpQ').focus()">${wmAvatar(p.name,22)} <span>${esc(p.name)}</span><em>${esc(p.dept||'')}</em></div>`).join('')||'<div class="wm-fp-none" style="cursor:default">No one else matches</div>';
};
window.wmFormKind=function(){
  const sel=$('wmKind').value; $('wmKindNew').style.display=sel==='__new'?'':'none';
  WM.formPpl=new Set(sel==='__new'?[]:wmLastPeople(sel)); wmFormPeople();
  // The agenda starts as the last meeting of this kind ran it, else the standard one.
  const last=sel==='__new'?null:(WM.meetings||[]).find(m=>m.kind===sel&&m.agenda&&m.agenda.items);
  WM.formAg=wmAgMerge(last?last.agenda:null).map(x=>({k:x.k,mins:x.mins,on:x.on})); wmFormAgenda();
};
function wmFormAgenda(){
  const host=$('wmAgForm'); if(!host) return;
  const tot=WM.formAg.filter(x=>x.on).reduce((s,x)=>s+(Number(x.mins)||0),0);
  host.innerHTML=WM.formAg.map((x,i)=>{ const d=WM_AGENDA.find(a=>a.k===x.k);
    // Plain rows rather than form fields: JainE's form styles stretch every input to full width.
    return `<div class="wm-agf-row ${x.on?'on':'off'}" role="checkbox" aria-checked="${x.on}" tabindex="0" onclick="WM.formAg[${i}].on=!WM.formAg[${i}].on;wmFormAgenda()" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}">
      <span class="ck"><i class="fa-solid fa-check"></i></span>
      <span class="ic"><i class="fa-solid ${d.i}"></i></span>
      <span class="nm">${esc(d.l)}${d.n?'<em>Notes</em>':''}</span>
      <span class="mn" onclick="event.stopPropagation()"><button type="button" tabindex="-1" onclick="wmFormAgMins(${i},-1)" ${x.on?'':'disabled'}>−</button><input type="number" min="1" max="180" value="${x.mins}" ${x.on?'':'disabled'} onchange="wmFormAgMins(${i},0,this.value)"><button type="button" tabindex="-1" onclick="wmFormAgMins(${i},1)" ${x.on?'':'disabled'}>+</button><small>min</small></span>
    </div>`; }).join('')
    +`<div class="wm-agf-tot">${WM.formAg.some(x=>x.on)?`<span>${WM.formAg.filter(x=>x.on).length} of ${WM.formAg.length} steps</span><b>${tot} min</b>`:'<span>No agenda — the meeting runs without the timer</span>'}</div>`;
}
window.wmFormAgMins=function(i,step,v){
  const x=WM.formAg[i]; if(!x) return;
  x.mins=Math.max(1,Math.min(180,step?x.mins+step:(Number(v)||1))); wmFormAgenda();
}
window.wmMeetingForm=function(mode){
  const later=mode==='schedule', kinds=[...new Set((WM.meetings||[]).map(m=>m.kind).filter(Boolean))];
  openModal(`<div class="modal-head"><h3>${later?'Schedule a meeting':'Start a meeting'}</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Which meeting</label><select id="wmKind" onchange="wmFormKind()">${kinds.map(k=>`<option>${esc(k)}</option>`).join('')}<option value="__new">A new kind of meeting…</option></select>
    <input id="wmKindNew" placeholder="e.g. Sales Review" style="display:${kinds.length?'none':''};margin-top:8px">
    ${later?`<div class="wm-three"><div><label id="wmDateLbl">Date</label><input type="date" id="wmDate" min="${wmToday()}" value="${wmAdd(wmToday(),1)}" onchange="wmFormRecur()"></div>
      <div><label>Time</label><input type="time" id="wmTime" value="10:30" onchange="wmFormRecur()"></div>
      <div><label>Repeats</label><select id="wmRecur" onchange="wmFormRecur()"><option value="none">Once</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></div></div>
      <div class="wm-recur-hint" id="wmRecurHint"></div>`:''}
    <label>People in this meeting <span style="font-weight:400;color:var(--slate)">— it goes into their JainE calendar and yours</span></label>
    <div class="wm-fp" id="wmFormPpl"></div>
    <label>Timed agenda <span style="font-weight:400;color:var(--slate)">— untick what this meeting skips; the minutes can be changed</span></label>
    <div class="wm-agf" id="wmAgForm"></div>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="wmStartBtn" onclick="wmMeetingSave('${later?'schedule':'start'}')"><i class="fa-solid fa-${later?'calendar-plus':'play'}"></i> ${later?'Schedule':'Start'}</button></div>`);
  if(!kinds.length) $('wmKind').value='__new';
  wmFormKind(); wmFormRecur();
};
// How often, said in words under the three fields: "Every Monday at 10:30, starting 9 Nov".
const wmOrd=n=>n+(n%10===1&&n!==11?'st':n%10===2&&n!==12?'nd':n%10===3&&n!==13?'rd':'th');
function wmRecurWords(recur,date,time){
  const d=new Date(date+'T00:00'), t=time?' at '+wmTime(time):'';
  if(recur==='daily') return 'Every day'+t;
  if(recur==='weekly') return 'Every '+d.toLocaleDateString('en-IN',{weekday:'long'})+t;
  if(recur==='monthly') return 'Every month on the '+wmOrd(d.getDate())+t+(d.getDate()>28?' (months without that day are skipped)':'');
  if(recur==='quarterly'){ const ms=[0,3,6,9].map(k=>new Date(2000,(d.getMonth()+k)%12,1).toLocaleDateString('en-IN',{month:'short'}));
    return 'Every 3 months on the '+wmOrd(d.getDate())+' ('+ms.join(', ')+')'+t; }
  if(recur==='yearly') return 'Every year on '+d.getDate()+' '+d.toLocaleDateString('en-IN',{month:'long'})+t+(d.getMonth()===1&&d.getDate()===29?' (leap years only)':'');
  return '';
}
window.wmFormRecur=function(){
  const r=$('wmRecur'), h=$('wmRecurHint'); if(!r||!h) return;
  const date=$('wmDate').value, rep=r.value!=='none';
  $('wmDateLbl').textContent=rep?'First meeting':'Date';
  h.innerHTML=rep&&date?`<i class="fa-solid fa-repeat"></i> ${esc(wmRecurWords(r.value,date,$('wmTime').value))}, starting ${esc(wmFmt(date))} — ${/quarterly|yearly/.test(r.value)?"each date goes into everyone's calendar, with an invite, two weeks before":"in everyone's calendar on each date"}`:'';
};
window.wmStartMeeting=function(){ wmMeetingForm('start'); };
window.wmScheduleMeeting=function(){ wmMeetingForm('schedule'); };
window.wmMeetingSave=async function(mode){
  const later=mode==='schedule', sel=$('wmKind').value, kind=sel==='__new'?($('wmKindNew').value||'').trim():sel;
  const date=later?($('wmDate').value||''):wmToday(), time=later?($('wmTime').value||null):(wmNowTime()||null);
  const emails=[...(WM.formPpl||[])], ag=(WM.formAg||[]).some(x=>x.on)?{items:WM.formAg.map(x=>({k:x.k,mins:x.mins,on:x.on}))}:null;
  const on=k=>!!ag&&ag.items.some(x=>x.k===k&&x.on), kpi=on('kpi'), oo=on('oo');
  // Started now: the timer starts with it, on the first step.
  const run=ag&&!later?{k:ag.items.find(x=>x.on).k,at:Date.now(),paused:false}:null;
  const recur=later&&$('wmRecur')?$('wmRecur').value:'none';
  if(!kind){ toast('Choose which meeting this is','err'); return; }
  if(!date){ toast('Choose a date','err'); return; }
  if(later&&date<wmToday()){ toast('Choose today or a later day','err'); return; }
  if(!emails.length){ toast('Add at least one person to this meeting','err'); return; }
  const b=$('wmStartBtn'); b.disabled=true;
  try{
    const {data,error}=await sb.rpc('ops_meeting_create',{p_kind:kind,p_date:date,p_time:time,p_people:emails,p_names:emails.map(wmName),p_kpi:kpi,p_oo:oo,p_agenda:ag,p_run:run,p_recur:recur}); if(error) throw error;
    if(!later){ try{ localStorage.setItem('wm_start_'+data,String(Date.now())); }catch(e){} }
    try{ usageQueue('tasks.meetings.schedule_a_meeting_one_time_or_recurring','create',{title:kind,attendees:emails.length+(emails.length===1?' person':' people')}); }catch(_e){}
    await wmReloadMeetings(); closeModal();
    toast((recur!=='none'?'Scheduled: '+wmRecurWords(recur,date,time):later?'Scheduled for '+wmFmt(date)+(time?', '+wmTime(time):''):'Meeting started')+' · in '+(emails.length+1)+' calendars','ok');
    wmOpenMeeting(Number(data));
  }catch(e){ b.disabled=false; toast('Could not '+(later?'schedule':'start')+' the meeting: '+((e&&e.message)||e),'err'); }
};

/* Stop a repeating meeting: no more dates are made, future dates nobody has written on are removed,
   and the repeating entry leaves everyone's calendar. Dates already held keep everything. */
window.wmSeriesStop=function(sid,go){
  const m=wmMeeting(WM.cur); if(!m) return;
  if(!go){
    openModal(`<div class="modal-head"><h3>Stop repeating ${esc(m.kind)}?</h3><span class="x" onclick="closeModal()">&times;</span></div>
      <div class="modal-body" style="font-size:14px;color:var(--slate);line-height:1.6">No more dates will be added. Coming dates that nothing has been written on are removed, and the repeating meeting is taken out of everyone's JainE calendar. Meetings already held keep their tasks and notes.</div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">Keep it</button><button class="btn btn-primary" style="background:#dc2626;border-color:#dc2626" onclick="wmSeriesStop(${sid},true)">Stop repeating</button></div>`);
    return;
  }
  (async()=>{
    try{
      const {data,error}=await sb.rpc('ops_meeting_series_stop',{p_series:sid}); if(error) throw error;
      closeModal(); await wmReloadMeetings();
      if(!wmMeeting(WM.cur)) WM.cur=((WM.meetings||[]).find(x=>x.meeting_date<=wmToday())||{}).id||null;
      toast('Stopped repeating'+(data?' · '+data+' coming date'+(data===1?'':'s')+' removed':''),'ok'); wmRender();
    }catch(e){ toast('Could not stop it: '+((e&&e.message)||e),'err'); }
  })();
};

/* The KPI section: one notes box, saved as you pause typing and when you leave it. */
window.wmKpiInput=function(el){ clearTimeout(WM.kpiT); WM.kpiT=setTimeout(()=>wmKpiSave(el),900); };
window.wmKpiSave=async function(el){
  clearTimeout(WM.kpiT);
  const m=wmMeeting(WM.cur); if(!m||!el) return;
  const v=el.value; if((m.kpi_notes||'')===v) return;
  const st=$('wmKpiSt'); if(st) st.textContent='Saving…';
  try{ const {error}=await sb.rpc('ops_meeting_set_kpi',{p_meeting:m.id,p_on:true,p_notes:v}); if(error) throw error; m.kpi_notes=v; if(st) st.textContent='Saved'; }
  catch(e){ if(st) st.textContent=''; toast('Could not save the KPI notes: '+((e&&e.message)||e),'err'); }
};
/* Obstacles & Opportunities: two notes boxes, each saved on its own as you pause and when you leave it. */
window.wmNoteInput=function(f,el){ WM.noteT=WM.noteT||{}; clearTimeout(WM.noteT[f]); WM.noteT[f]=setTimeout(()=>wmNoteSave(f,el),900); };
window.wmNoteSave=async function(f,el){
  if(WM.noteT) clearTimeout(WM.noteT[f]);
  const m=wmMeeting(WM.cur); if(!m||!el) return;
  const v=el.value; if((m[f]||'')===v) return;
  const st=$('wmSt_'+f); if(st) st.textContent='Saving…';
  try{ const {error}=await sb.rpc('ops_meeting_set_note',{p_meeting:m.id,p_field:f,p_value:v}); if(error) throw error; m[f]=v; if(st) st.textContent='Saved'; }
  catch(e){ if(st) st.textContent=''; toast('Could not save the '+f+': '+((e&&e.message)||e),'err'); }
};
window.wmOoAdd=async function(){
  const m=wmMeeting(WM.cur); if(!m) return;
  try{ const {error}=await sb.rpc('ops_meeting_set_oo',{p_meeting:m.id,p_on:true}); if(error) throw error; m.has_oo=true; wmPaintMeeting(); const t=$('wmNote_obstacles'); if(t) t.focus(); }
  catch(e){ toast('Could not add the section: '+((e&&e.message)||e),'err'); }
};
/* ---------- the timed agenda ----------
   Eight steps in a fixed order, each with its own minutes. The timer starts on the first step and
   moves to the next one by itself when a step's time is up (a short chime marks it); it can be
   paused, or moved back and forward by hand. Where it stands is saved on the meeting (agenda_run:
   which step, when that step began, or how much was left when paused), so a reload - or another
   screen - picks it up where it is. */
const WM_AGENDA=[
  {k:'wins',  l:'Personal & professional wins', mins:5, i:'fa-trophy'},
  {k:'core',  l:'Core values & purpose',        mins:5, i:'fa-compass'},
  {k:'goal',  l:'Quarterly #1 goal',            mins:1, i:'fa-bullseye'},
  {k:'prio',  l:'Quarterly priorities',         mins:5, i:'fa-list-ol'},
  {k:'kpi',   l:'KPIs',                         mins:5, i:'fa-chart-line', n:'kpi'},
  {k:'events',l:'Upcoming important events',    mins:5, i:'fa-calendar-day', n:'notes', ph:'Launches, site visits, deadlines, holidays coming up…'},
  {k:'todos', l:'To-dos',                       mins:5, i:'fa-list-check', n:'notes', ph:'What needs doing, by whom…'},
  {k:'oo',    l:'Opportunities & obstacles',    mins:30,i:'fa-scale-balanced', n:'oo'}];
function wmAgMerge(agenda){
  const saved=(agenda&&agenda.items)||[];
  return WM_AGENDA.map(d=>{ const s=saved.find(x=>x.k===d.k); return Object.assign({},d,s?{mins:Number(s.mins)||d.mins,on:s.on!==false}:{on:!agenda}); });
}
const wmAgOn=m=>wmAgMerge(m.agenda).filter(x=>x.on);
// Where the timer is now. Steps whose time ran out while nobody was looking are stepped past here.
function wmAgState(m){
  const items=wmAgOn(m), run=m.agenda_run;
  if(!run||!items.length) return {items,run:null};
  if(run.done) return {items,run,done:true};
  let i=items.findIndex(x=>x.k===run.k); if(i<0) i=0;
  if(run.paused) return {items,run,i,left:Math.max(0,Number(run.left)||0)};
  let at=Number(run.at)||Date.now(), moved=false;
  while(Date.now()-at>=items[i].mins*60000){ at+=items[i].mins*60000; moved=true; if(i===items.length-1) return {items,run,i,moved,finished:true}; i++; }
  return {items,run,i,at,moved,left:Math.ceil((items[i].mins*60000-(Date.now()-at))/1000)};
}
const wmMMSS=s=>{ s=Math.max(0,Math.round(s)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); };
async function wmAgSaveRun(m,run){
  m.agenda_run=run;
  try{ const {error}=await sb.rpc('ops_meeting_set_run',{p_meeting:m.id,p_run:run}); if(error) throw error; }
  catch(e){ toast('Could not save the timer: '+((e&&e.message)||e),'err'); }
}
function wmChime(){ try{ const c=new (window.AudioContext||window.webkitAudioContext)(), o=c.createOscillator(), g=c.createGain(); o.frequency.value=880; o.connect(g); g.connect(c.destination); g.gain.setValueAtTime(.15,c.currentTime); g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.6); o.start(); o.stop(c.currentTime+.6); }catch(e){} }

function wmPaintAgenda(fresh){
  clearInterval(WM.agTimer);
  const host=$('wmAg'), m=wmMeeting(WM.cur); if(!host||!m||!m.agenda) return;
  const s=wmAgState(m), tot=s.items.reduce((a,x)=>a+x.mins,0);
  if(fresh||!WM.agView||!s.items.some(x=>x.k===WM.agView)) { WM.agView=s.run&&!s.done&&s.i!=null?s.items[s.i].k:(s.items[0]||{}).k; WM.agFollow=true; }
  const curK=s.run&&!s.done&&!s.finished?s.items[s.i].k:null;
  const ctl=!s.run?`<button class="wm-btn wm-sm wm-red" onclick="wmAgStart()"><i class="fa-solid fa-play"></i> Start the timer</button>`
    :s.done||s.finished?`<span class="wm-mute" style="font-size:13px"><i class="fa-solid fa-flag-checkered"></i> Agenda finished</span><button class="wm-ib" title="Back to the last step" onclick="wmAgStep(-1)"><i class="fa-solid fa-backward-step"></i></button>`
    :`<button class="wm-ib" title="Back a step" onclick="wmAgStep(-1)"><i class="fa-solid fa-backward-step"></i></button>
      <button class="wm-btn wm-sm wm-light" onclick="wmAgPause()"><i class="fa-solid fa-${s.run.paused?'play':'pause'}"></i> ${s.run.paused?'Resume':'Pause'}</button>
      <button class="wm-ib" title="Next step" onclick="wmAgStep(1)"><i class="fa-solid fa-forward-step"></i></button>`;
  host.innerHTML=`<div class="wm-ag-head"><div><b>Agenda</b> <span class="wm-mute">· ${tot} min</span></div><div class="wm-ag-ctl">${ctl}</div></div>
    <div class="wm-ag-grid"><div class="wm-ag-steps">${s.items.map((x,j)=>{ const past=s.run&&(s.done||s.finished||j<s.i), now=x.k===curK;
      return `<div class="wm-ag-step ${now?'now':''} ${past?'past':''} ${WM.agView===x.k?'view':''}" onclick="wmAgView('${x.k}')">
        <span class="ic">${past?'<i class="fa-solid fa-check"></i>':`<i class="fa-solid ${x.i}"></i>`}</span><span class="l">${esc(x.l)}</span>
        ${now?`<span class="cd" id="wmAgCd">${wmMMSS(s.left)}</span>`:`<input class="mn" type="number" min="1" max="180" value="${x.mins}" title="Minutes" onclick="event.stopPropagation()" onchange="wmAgMins('${x.k}',this.value)"><span class="mu">m</span>`}
        ${now?`<span class="bar"><span id="wmAgBar" style="width:${Math.min(100,100-(s.left/(x.mins*60))*100)}%"></span></span>`:''}</div>`; }).join('')}</div>
      <div class="wm-ag-panel" id="wmAgPanel"></div></div>`;
  wmPaintAgPanel(s);
  if(s.moved||s.finished) wmAgAdvanced(m,s);
  if(s.run&&!s.run.paused&&!s.done&&!s.finished) WM.agTimer=setInterval(wmAgTick,1000);
}
// Every second: the countdown and its bar only, so nothing being typed is disturbed. A step that
// runs out moves the agenda on; the open notes follow it unless someone is typing in them.
function wmAgTick(){
  const m=wmMeeting(WM.cur); if(!m||!$('wmAg')){ clearInterval(WM.agTimer); return; }
  const s=wmAgState(m);
  if(s.moved||s.finished){ wmAgAdvanced(m,s); return; }
  const cd=$('wmAgCd'), bar=$('wmAgBar'), it=s.items[s.i];
  if(cd) cd.textContent=wmMMSS(s.left); if(bar) bar.style.width=Math.min(100,100-(s.left/(it.mins*60))*100)+'%';
  const big=$('wmAgBig'); if(big) big.textContent=wmMMSS(s.left);
  const bb=$('wmAgBigBar'); if(bb) bb.style.width=Math.min(100,100-(s.left/(it.mins*60))*100)+'%';
  const w=document.querySelector('.wm-ag-bigw'); if(w) w.classList.toggle('low',s.left<=60);
}
function wmAgAdvanced(m,s){
  wmChime();
  const run=s.finished?{k:s.items[s.items.length-1].k,done:true}:{k:s.items[s.i].k,at:s.at,paused:false};
  if(!s.finished) toast('Next: '+s.items[s.i].l+' · '+s.items[s.i].mins+' min','ok'); else toast('Agenda finished','ok');
  wmAgSaveRun(m,run);
  const typing=document.activeElement&&document.activeElement.closest&&document.activeElement.closest('#wmAgPanel');
  if(WM.agFollow&&!typing&&!s.finished) WM.agView=run.k;
  wmPaintAgenda(false);
}
function wmPaintAgPanel(s){
  const p=$('wmAgPanel'), m=wmMeeting(WM.cur); if(!p||!m) return;
  const x=s.items.find(i=>i.k===WM.agView); if(!x){ p.innerHTML=''; return; }
  const running=s.run&&!s.done&&!s.finished&&s.items[s.i].k===x.k;
  const head=`<div class="wm-ag-ph"><div><div class="wm-eyebrow">${running?'<span class="wm-live">Now</span>':s.run&&!s.done&&!s.finished&&s.items.findIndex(i=>i.k===x.k)<s.i||s.done||s.finished?'Done':'Coming up'} · ${x.mins} min</div><h3><i class="fa-solid ${x.i}"></i> ${esc(x.l)}</h3></div>
</div>
    ${running?`<div class="wm-ag-bigw ${s.run.paused?'paused':''}"><div class="wm-ag-big" id="wmAgBig">${wmMMSS(s.left)}</div>
      <div class="wm-ag-bigr"><span>${s.run.paused?'Paused':'left'} of ${x.mins} min</span><div class="wm-ag-bigbar"><span id="wmAgBigBar" style="width:${Math.min(100,100-(s.left/(x.mins*60))*100)}%"></span></div></div></div>`:''}
    ${!running&&s.run&&!s.done&&!s.finished?`<button class="wm-quiet" style="margin:-4px 0 10px" onclick="wmAgView('${esc(s.items[s.i].k)}')"><i class="fa-solid fa-arrow-left"></i> Back to the step the timer is on</button>`:''}`;
  let body='';
  if(x.n==='kpi') body=wmKpiTableHtml(m)+wmKpiReviewHtml(m)+`<div class="wm-sec" style="margin-top:16px"><span>KPI notes</span><span class="r wm-mute wm-nst" id="wmKpiSt"></span></div>
      <textarea class="wm-ag-ta" id="wmKpiTxt" placeholder="Anything behind the numbers…" oninput="wmKpiInput(this)" onblur="wmKpiSave(this)">${esc(m.kpi_notes||'')}</textarea>`;
  else if(x.n==='notes') body=`<div class="wm-sec"><span>Notes</span><span class="r wm-mute wm-nst" id="wmSt_${x.k}"></span></div>
      <textarea class="wm-ag-ta" id="wmAgNote_${x.k}" placeholder="${esc(x.ph||'')}" oninput="wmAgNoteInput('${x.k}',this)" onblur="wmAgNoteSave('${x.k}',this)">${esc((m.agenda_notes||{})[x.k]||'')}</textarea>`;
  else if(x.n==='oo') body=`<div id="wmOoHost">${wmOoHtml(m)}</div>`;
  else body=`<div class="wm-mute" style="font-size:13.5px;padding:8px 0 4px">Go round the room. No notes are kept for this step.</div>`;
  p.innerHTML=head+body;
}
window.wmAgView=function(k){ const m=wmMeeting(WM.cur); WM.agView=k; const s=wmAgState(m); WM.agFollow=!!(s.run&&!s.done&&!s.finished&&s.items[s.i].k===k); wmPaintAgenda(false); };
window.wmAgStart=async function(){
  const m=wmMeeting(WM.cur); if(!m) return; const items=wmAgOn(m); if(!items.length) return;
  try{ if(!localStorage.getItem('wm_start_'+m.id)) localStorage.setItem('wm_start_'+m.id,String(Date.now())); }catch(e){}
  await wmAgSaveRun(m,{k:items[0].k,at:Date.now(),paused:false}); WM.agView=items[0].k; WM.agFollow=true; wmPaintMeeting();
};
window.wmAgPause=async function(){
  const m=wmMeeting(WM.cur), s=wmAgState(m); if(!s.run||s.done) return;
  const it=s.items[s.i];
  const run=s.run.paused?{k:it.k,at:Date.now()-(it.mins*60-s.left)*1000,paused:false}:{k:it.k,paused:true,left:s.left};
  await wmAgSaveRun(m,run); wmPaintAgenda(false);
};
window.wmAgStep=async function(dir){
  const m=wmMeeting(WM.cur), s=wmAgState(m); if(!s.run) return;
  const cur=s.done||s.finished?s.items.length:s.i, j=cur+dir;
  if(j<0) return;
  const run=j>=s.items.length?{k:s.items[s.items.length-1].k,done:true}:{k:s.items[j].k,at:Date.now(),paused:false};
  await wmAgSaveRun(m,run); WM.agView=run.k; WM.agFollow=true; wmPaintAgenda(false);
};
// Changing a step's minutes. On the running step the time already spent still counts.
window.wmAgMins=async function(k,v){
  const m=wmMeeting(WM.cur); if(!m) return;
  const items=wmAgMerge(m.agenda).map(x=>({k:x.k,mins:x.k===k?Math.max(1,Math.min(180,Number(v)||1)):x.mins,on:x.on}));
  try{ const {error}=await sb.rpc('ops_meeting_set_agenda',{p_meeting:m.id,p_agenda:{items}}); if(error) throw error; m.agenda={items}; }
  catch(e){ toast('Could not change the minutes: '+((e&&e.message)||e),'err'); }
  wmPaintAgenda(false);
};
// A meeting set up without the agenda can take it on later: the standard steps, keeping any KPI or
// O&O section it already had.
window.wmAgAdd=async function(){
  const m=wmMeeting(WM.cur); if(!m) return;
  const items=WM_AGENDA.map(d=>({k:d.k,mins:d.mins,on:true}));
  try{ const {error}=await sb.rpc('ops_meeting_set_agenda',{p_meeting:m.id,p_agenda:{items}}); if(error) throw error; m.agenda={items}; m.has_kpi=true; m.has_oo=true; wmPaintMeeting(); }
  catch(e){ toast('Could not add the agenda: '+((e&&e.message)||e),'err'); }
};
window.wmAgNoteInput=function(k,el){ WM.noteT=WM.noteT||{}; clearTimeout(WM.noteT[k]); WM.noteT[k]=setTimeout(()=>wmAgNoteSave(k,el),900); };
window.wmAgNoteSave=async function(k,el){
  if(WM.noteT) clearTimeout(WM.noteT[k]);
  const m=wmMeeting(WM.cur); if(!m||!el) return;
  const v=el.value, have=(m.agenda_notes||{})[k]||''; if(have===v) return;
  const st=$('wmSt_'+k); if(st) st.textContent='Saving…';
  try{ const {error}=await sb.rpc('ops_meeting_set_agenda_note',{p_meeting:m.id,p_key:k,p_value:v}); if(error) throw error; m.agenda_notes=Object.assign({},m.agenda_notes,{[k]:v}); if(st) st.textContent='Saved'; }
  catch(e){ if(st) st.textContent=''; toast('Could not save the notes: '+((e&&e.message)||e),'err'); }
};

/* ---------- Obstacles & Opportunities: separate notes, solved or not, each can become a task ----------
   A note is written in one meeting. Until it is marked solved it shows again at every later meeting of
   the same kind ("From 21 Sep"). "Make a task" creates a real Accountability task the way a typed task
   is created, puts it in this meeting's task list, and links it to the note. */
const WM_OO=[['opportunity','Opportunities','fa-lightbulb','New opportunity, then Enter'],['obstacle','Obstacles','fa-triangle-exclamation','New obstacle, then Enter']];
function wmNotesFor(m,section){
  const all=(WM.notes||[]).filter(n=>n.section===section);
  // From earlier meetings: everything still unsolved, plus anything solved on or after this meeting's
  // day (so a note ticked off in the room stays in view, struck through, instead of vanishing).
  const solvedHere=n=>n.solved&&n.solved_at&&wmIso(new Date(new Date(n.solved_at).toLocaleString('en-US',{timeZone:'Asia/Kolkata'})))>=String(m.meeting_date);
  const carried=all.filter(n=>n.meeting_id!==m.id&&n.kind===m.kind&&(!n.solved||solvedHere(n))&&String(n.meeting_date)<String(m.meeting_date));
  const here=all.filter(n=>n.meeting_id===m.id);
  const both=carried.concat(here);
  return both.filter(n=>!n.solved).concat(both.filter(n=>n.solved));
}
function wmOoHtml(m){
  const legacy=['opportunities','obstacles'].filter(f=>(m[f]||'').trim());
  return (legacy.length?`<div class="wm-oo-old">${legacy.map(f=>`<div><b>${f==='obstacles'?'Obstacles':'Opportunities'} written earlier</b><div>${esc(m[f]).replace(/\n/g,'<br>')}</div></div>`).join('')}</div>`:'')
  +`<div class="wm-oo" style="margin-top:0">${WM_OO.map(([sec,l,i,ph])=>{ const list=wmNotesFor(m,sec), open=list.filter(n=>!n.solved).length;
    return `<div class="wm-oo-box ${sec==='obstacle'?'obstacles':'opportunities'}"><div class="wm-sec"><span><i class="fa-solid ${i}" style="margin-right:6px"></i>${l}</span><span class="r wm-mute wm-nst">${open} open</span></div>
      <input class="wm-nt-add" id="wmNtAdd_${sec}" placeholder="${ph}" onkeydown="if(event.key==='Enter'){event.preventDefault();wmNoteAdd('${sec}',this)}">
      <div class="wm-nt-list">${list.map(n=>wmNoteRow(n,m)).join('')||'<div class="wm-mute" style="font-size:12.5px;padding:8px 2px">Nothing yet.</div>'}</div></div>`; }).join('')}</div>`;
}
function wmNoteRow(n,m){
  const from=n.meeting_id!==m.id, who=(n.task_assignees||[]).map(wmName).join(', ');
  const tst=n.task_status==='Completed'?'done':n.task_status==='Awaiting Approval'?'waiting for your approval':n.task_status?'pending':'';
  return `<div class="wm-nt ${n.solved?'solved':''}">
    <button class="ck" title="${n.solved?'Solved - click to mark unsolved':'Unsolved - click to mark solved'}" onclick="wmNoteSolve(${n.id},${!n.solved})"><i class="fa-solid fa-check"></i></button>
    <div class="tx"><div class="bd">${esc(n.body)}</div>
      <div class="mt"><span class="st ${n.solved?'y':'n'}">${n.solved?'Solved':'Unsolved'}</span>${from?`<span class="fr">From ${esc(wmFmtS(n.meeting_date))}</span>`:''}
        ${n.ptask_id?`<span class="tk"><i class="fa-solid fa-list-check"></i> Task for ${esc(who||'—')}${tst?' · '+tst:''}</span>`:`<button class="wm-quiet" onclick="wmNoteTask(${n.id})"><i class="fa-solid fa-user-plus"></i> Make a task</button>`}
        ${!from&&!n.ptask_id?`<button class="rm" title="Delete this note" onclick="wmNoteDel(${n.id})"><i class="fa-solid fa-trash-can"></i></button>`:''}</div></div></div>`;
}
async function wmReloadNotes(){ const {data,error}=await sb.rpc('ops_weekly_notes'); if(error) throw error; WM.notes=data||[]; }
function wmPaintOo(focusSec){ const h=$('wmOoHost'), m=wmMeeting(WM.cur); if(!h||!m) return; h.innerHTML=wmOoHtml(m); if(focusSec){ const i=$('wmNtAdd_'+focusSec); if(i) i.focus(); } }
window.wmNoteAdd=async function(sec,el){
  const m=wmMeeting(WM.cur), v=(el.value||'').trim(); if(!m||!v) return;
  el.disabled=true;
  try{ const {error}=await sb.rpc('ops_note_add',{p_meeting:m.id,p_section:sec,p_body:v}); if(error) throw error; await wmReloadNotes(); wmPaintOo(sec); }
  catch(e){ el.disabled=false; toast('Could not add the note: '+((e&&e.message)||e),'err'); }
};
window.wmNoteSolve=async function(id,v){
  try{ const {error}=await sb.rpc('ops_note_set',{p_id:id,p_body:null,p_solved:v}); if(error) throw error; await wmReloadNotes(); wmPaintOo(); toast(v?'Marked solved':'Marked unsolved','ok'); }
  catch(e){ toast('Could not change it: '+((e&&e.message)||e),'err'); }
};
window.wmNoteDel=async function(id){
  if(!confirm('Delete this note?')) return;
  try{ const {error}=await sb.rpc('ops_note_delete',{p_id:id}); if(error) throw error; await wmReloadNotes(); wmPaintOo(); }
  catch(e){ toast('Could not delete it: '+((e&&e.message)||e),'err'); }
};
// Make a task from a note: the same rules as a typed task - a title, at least one person, never
// yourself, an optional due date that is not in the past.
window.wmNoteTask=function(id){
  const n=(WM.notes||[]).find(x=>x.id===id), m=wmMeeting(WM.cur); if(!n||!m) return;
  window._wmNtPick=new Set();
  const here=new Set(m.attendees||[]), others=WM.people.filter(p=>!wmIsMe(p.email)), inRoom=others.filter(p=>here.has(p.name)), rest=others.filter(p=>!here.has(p.name));
  const row=p=>`<label class="pp"><input type="checkbox" onchange="this.checked?_wmNtPick.add('${esc(p.email)}'):_wmNtPick.delete('${esc(p.email)}')">${wmAvatar(p.name,26)} ${esc(p.name)}<span>${esc(p.dept||'')}</span></label>`;
  openModal(`<div class="modal-head"><h3>Make a task from this ${n.section}</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm wm-ntm">
    <label>Task</label><input type="text" id="wmNtTitle" value="${esc(n.body)}">
    <label>Due date <span style="font-weight:400;color:var(--slate)">(optional)</span></label><input type="date" id="wmNtDue" min="${wmToday()}">
    <label>Give it to</label><input type="text" placeholder="Search people" oninput="document.querySelectorAll('#wmNtPpl label').forEach(l=>l.style.display=l.textContent.toLowerCase().includes(this.value.toLowerCase())?'':'none')">
    <div id="wmNtPpl" style="max-height:260px;overflow-y:auto;margin-top:6px">${inRoom.length?`<div class="g">In this meeting</div>${inRoom.map(row).join('')}<div class="g">Everyone else</div>`:''}${rest.map(row).join('')}</div></div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="wmNtGo" onclick="wmNoteTaskSave(${id})"><i class="fa-solid fa-check"></i> Create task</button></div>`);
};
window.wmNoteTaskSave=async function(id){
  const m=wmMeeting(WM.cur), title=($('wmNtTitle').value||'').trim(), due=$('wmNtDue').value||null, mem=[...(window._wmNtPick||[])];
  if(!title){ toast('Type a title','err'); return; }
  if(!mem.length){ toast('Pick at least one member','err'); return; }
  if(due&&due<wmToday()){ toast('Choose today or a later date','err'); return; }
  const b=$('wmNtGo'); b.disabled=true;
  try{
    const tid=await wmCreateTask(title,mem,due,'none');
    const r1=await sb.rpc('ops_item_add',{p_meeting:m.id,p_item:title,p_ptask:tid,p_owner:mem.map(wmName).join(', '),p_due:due}); if(r1.error) throw r1.error;
    const r2=await sb.rpc('ops_note_link_task',{p_id:id,p_ptask:tid}); if(r2.error) throw r2.error;
    closeModal(); toast('Task created for '+mem.map(wmName).join(', '),'ok');
    await Promise.all([wmReload(),wmReloadNotes()]); wmCounts(); wmPaintOo(); wmPaintTabs(); wmPaintNav();
  }catch(e){ b.disabled=false; toast('Failed: '+((e&&e.message)||e),'err'); }
};

/* ---------- KPI review: the values from every earlier meeting of this kind, by date and time ---------- */
function wmKpiReviewHtml(m){
  const past=(WM.meetings||[]).filter(x=>x.kind===m.kind&&x.id!==m.id&&String(x.meeting_date)<=String(m.meeting_date)
    &&Object.values(x.kpi_vals||{}).some(v=>Object.values(v||{}).some(s=>String(s||'').trim()))).slice(0,12);
  if(!past.length) return `<div class="wm-kr-empty"><i class="fa-solid fa-clock-rotate-left"></i> KPI review: earlier ${esc(m.kind)} meetings have no KPI values yet.</div>`;
  const names=[]; [m].concat(past).forEach(x=>(x.kpi_cols||[]).forEach(c=>{ const n=(c.name||'').trim(); if(n&&!names.includes(n)) names.push(n); }));
  const val=(x,person,name)=>{ const c=(x.kpi_cols||[]).find(c=>(c.name||'').trim()===name); return c?(((x.kpi_vals||{})[person]||{})[c.id]||''):''; };
  const rows=past.map(x=>{ const ppl=Object.keys(x.kpi_vals||{}).filter(p=>names.some(n=>String(val(x,p,n)).trim()));
    return ppl.map((p,j)=>`<tr class="${j===0?'first':''}">${j===0?`<td class="mt" rowspan="${ppl.length}"><b>${esc(wmFmt(x.meeting_date))}</b><span>${x.start_time?esc(wmTime(x.start_time)):''}</span></td>`:''}<td class="p">${wmAvatar(p,20)} ${esc(p)}</td>${names.map(n=>`<td>${esc(val(x,p,n))}</td>`).join('')}</tr>`).join(''); }).join('');
  return `<div class="wm-kr"><div class="wm-sec" style="margin-top:18px"><span><i class="fa-solid fa-clock-rotate-left" style="margin-right:6px"></i>KPI review · earlier ${esc(m.kind)} meetings</span></div>
    <div class="wm-kt-wrap"><table class="wm-kt wm-kr-t"><thead><tr><th>Meeting</th><th>Person</th>${names.map(n=>`<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

/* ---------- the KPI table: one row per person in the meeting, columns you add ---------- */
function wmKpiTableHtml(m){
  const ppl=m.attendees||[], cols=Array.isArray(m.kpi_cols)?m.kpi_cols:[], vals=m.kpi_vals||{};
  if(!ppl.length) return `<div class="wm-mute" style="font-size:13.5px;padding:6px 0">Add the people in this meeting first; each one gets a row here.</div>`;
  return `<div class="wm-kt-wrap"><table class="wm-kt"><thead><tr><th>Person</th>${cols.map(c=>`<th><input class="h" value="${esc(c.name)}" placeholder="Column name" onchange="wmKpiColName('${esc(c.id)}',this.value)"><button class="x" title="Remove this column" onclick="wmKpiColDel('${esc(c.id)}')"><i class="fa-solid fa-xmark"></i></button></th>`).join('')}
      <th class="add"><button class="wm-quiet" onclick="wmKpiColAdd()"><i class="fa-solid fa-plus"></i> Add column</button></th></tr></thead>
    <tbody>${ppl.map(n=>`<tr><td class="p">${wmAvatar(n,22)} ${esc(n)}</td>${cols.map(c=>`<td><input value="${esc(((vals[n]||{})[c.id])||'')}" onchange="wmKpiCell(${JSON.stringify(n).replace(/"/g,'&quot;')},'${esc(c.id)}',this.value)"></td>`).join('')}<td></td></tr>`).join('')}</tbody></table></div>
    ${cols.length?'':'<div class="wm-mute" style="font-size:12.5px;margin-top:8px">Add a column for each number you track (bookings, collections, site visits…). The columns carry over to the next meeting of this kind.</div>'}`;
}
async function wmKpiSaveCols(m,cols){
  try{ const {error}=await sb.rpc('ops_meeting_set_kpi_cols',{p_meeting:m.id,p_cols:cols}); if(error) throw error; m.kpi_cols=cols; }
  catch(e){ toast('Could not save the columns: '+((e&&e.message)||e),'err'); }
}
window.wmKpiColAdd=async function(){
  const m=wmMeeting(WM.cur); if(!m) return; const id='c'+Date.now().toString(36);
  await wmKpiSaveCols(m,(m.kpi_cols||[]).concat([{id,name:''}])); wmPaintAgPanel(wmAgState(m));
  const hs=document.querySelectorAll('.wm-kt th input.h'); if(hs.length) hs[hs.length-1].focus();
};
window.wmKpiColName=async function(id,v){ const m=wmMeeting(WM.cur); if(!m) return; await wmKpiSaveCols(m,(m.kpi_cols||[]).map(c=>c.id===id?{id,name:v.trim()}:c)); };
window.wmKpiColDel=async function(id){
  const m=wmMeeting(WM.cur); if(!m) return; const c=(m.kpi_cols||[]).find(x=>x.id===id);
  if(!confirm('Remove the column "'+((c&&c.name)||'untitled')+'" from this meeting\'s table?')) return;
  await wmKpiSaveCols(m,(m.kpi_cols||[]).filter(x=>x.id!==id)); wmPaintAgPanel(wmAgState(m));
};
window.wmKpiCell=async function(person,col,v){
  const m=wmMeeting(WM.cur); if(!m) return;
  try{ const {error}=await sb.rpc('ops_meeting_set_kpi_cell',{p_meeting:m.id,p_person:person,p_col:col,p_value:v}); if(error) throw error;
    m.kpi_vals=Object.assign({},m.kpi_vals); m.kpi_vals[person]=Object.assign({},m.kpi_vals[person],{[col]:v}); }
  catch(e){ toast('Could not save that value: '+((e&&e.message)||e),'err'); }
};

window.wmKpiAdd=async function(){
  const m=wmMeeting(WM.cur); if(!m) return;
  try{ const {error}=await sb.rpc('ops_meeting_set_kpi',{p_meeting:m.id,p_on:true,p_notes:m.kpi_notes||''}); if(error) throw error; m.has_kpi=true; wmPaintMeeting(); const t=$('wmKpiTxt'); if(t) t.focus(); }
  catch(e){ toast('Could not add the KPI section: '+((e&&e.message)||e),'err'); }
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
    // A meeting with a calendar entry keeps its invitees in step with who is ticked here.
    const m=wmMeeting(WM.cur), args={p_meeting:WM.cur,p_people:[..._wmAtt]};
    if(m&&m.acc_meeting_id) args.p_emails=[..._wmAtt].map(n=>WM.people.find(p=>p.name.toLowerCase()===String(n).toLowerCase())).filter(Boolean).map(p=>p.email);
    const {error}=await sb.rpc('ops_meeting_set_attendees',args); if(error) throw error;
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
window.wmEndMeeting=async function(force){
  const m=wmMeeting(WM.cur); if(!m) return;
  const left=wmDrafts().length;
  if(left&&!force){
    openModal(`<div class="modal-head"><h3>${left} task${left>1?'s have':' has'} no one assigned</h3><span class="x" onclick="closeModal()">&times;</span></div>
      <div class="modal-body" style="font-size:14px;color:var(--slate);line-height:1.6">They stay saved on this meeting, but only become Accountability tasks once each has a person.</div>
      <div class="modal-foot"><button class="btn" onclick="closeModal();wmEndMeeting(true)">End anyway</button><button class="btn btn-primary" onclick="closeModal();$('wmDrafts').scrollIntoView({behavior:'smooth',block:'center'})">Assign them now</button></div>`);
    return;
  }
  // Ending is saved on the meeting (and stops the agenda timer there), so it stays ended after a
  // reload: no End meeting button, no live dot, "ended at …" on the card.
  clearInterval(WM.agTimer); clearInterval(WM.timer);
  let mins=0, s=0; try{ s=Number(localStorage.getItem('wm_start_'+m.id))||0; if(s) mins=Math.max(1,Math.round((Date.now()-s)/60000)); }catch(e){}
  const btn=document.querySelector('.wm-btn.wm-red'); if(btn) btn.disabled=true;
  try{
    const {error}=await sb.rpc('ops_meeting_end',{p_meeting:m.id,p_minutes:mins||null}); if(error) throw error;
    m.ended_at=new Date().toISOString(); m.ran_minutes=mins||null; if(m.agenda_run&&!m.agenda_run.done) m.agenda_run={k:m.agenda_run.k,done:true};
    try{ localStorage.removeItem('wm_start_'+m.id); }catch(e){}
  }catch(e){ if(btn) btn.disabled=false; toast('Could not end the meeting: '+((e&&e.message)||e),'err'); return; }
  const mine=WM.items.filter(it=>it.meeting===m.id&&!it.draft), keys=[...new Set(mine.flatMap(wmWhoKeys))];
  const open=WM.items.filter(it=>it.kind===m.kind&&!it.draft&&wmOpen(it)).length;
  openModal(`<div class="modal-head"><h3>Meeting ended</h3><span class="x" onclick="closeModal();wmRender()">&times;</span></div>
    <div class="modal-body"><div style="color:var(--slate);font-size:13.5px">${esc(m.kind)}${mins?' · '+mins+' min':''} · ${(m.attendees||[]).length} present · ${mine.length} task${mine.length===1?'':'s'} written · ${open} still pending for this meeting</div>
      <div style="margin-top:14px">${keys.map(k=>`<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--line-2)">${wmAvatar(wmKeyName(k),30)}<div><b>${esc(wmKeyName(k))}</b>${mine.filter(it=>wmWhoKeys(it).includes(k)).map(it=>`<div style="font-size:13px;color:#334155">${esc(it.t)}${it.due?` <span style="color:var(--slate)">· ${esc(wmFmtS(it.due))}</span>`:''}</div>`).join('')}</div></div>`).join('')||'<div style="color:var(--slate)">No tasks were written in this meeting.</div>'}</div></div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal();wmRender()">Done</button></div>`);
  wmRender();
};
window.wmReopen=async function(){
  const m=wmMeeting(WM.cur); if(!m) return;
  try{ const {error}=await sb.rpc('ops_meeting_reopen',{p_meeting:m.id}); if(error) throw error; m.ended_at=null; m.ran_minutes=null; wmRender(); toast('Meeting reopened','ok'); }
  catch(e){ toast('Could not reopen it: '+((e&&e.message)||e),'err'); }
};
// "12:40" in India time, for when a meeting ended.
function wmClock(ts){ try{ return new Date(ts).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''; } }

const WM_CSS='<style id="wmCss">'
  /* Light, like the rest of JainE: white cards on the normal page background. */
  +'.wm{--ink:#0b1220;--ink2:#334155;--mute:#64748b;--mute2:#94a3b8;--hair:#e6eaf1;--hair2:#eef1f6;--red:#e0121c;--green:#16a34a;color:var(--ink);padding:12px 18px 60px}'
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
  /* The panel folds to a thin strip of three buttons; the meeting card takes the room. */
  +'.wm-grid.off{grid-template-columns:minmax(0,1fr) 44px}.wm-railfold{display:none;flex-direction:column;gap:8px}.wm-grid.off .wm-railfold{display:flex}.wm-grid.off .wm-railopen{display:none}'
  +'.wm-ib{width:36px;height:30px;flex:none;border:1px solid var(--hair);border-radius:10px;background:#fff;color:var(--mute);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:12px}.wm-ib:hover{color:var(--ink);border-color:#cbd5e1}'
  +'.wm-railfold .wm-ib{width:44px;height:40px}'
  +'.wm-wkh{display:flex;align-items:baseline;justify-content:space-between;font-size:13px;font-weight:700;color:var(--ink);margin-top:4px}.wm-wkh small{font-size:11.5px;font-weight:500;color:var(--mute2)}'
  +'.wm-wksep{height:1px;background:var(--hair2);margin:14px 0 12px}'
  +'.wm-kpi{margin-top:22px;border:1px solid var(--hair);border-left:3px solid var(--red);border-radius:14px;padding:12px 16px 14px;background:#fffafa}'
  +'.wm-kpi textarea{width:100%;min-height:96px;border:0;outline:none;resize:vertical;background:transparent;font:inherit;font-size:14.5px;line-height:1.6;color:var(--ink)}'
  +'.wm-kpi textarea::placeholder{color:var(--mute2)}'
  +'.wm-oo{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px}'
  +'.wm-oo-box{border:1px solid var(--hair);border-radius:14px;padding:12px 16px 14px}.wm-oo-box.obstacles{border-left:3px solid #d97706;background:#fffcf5}.wm-oo-box.opportunities{border-left:3px solid #16a34a;background:#f7fdf9}'
  +'.wm-oo-box textarea{width:100%;min-height:96px;border:0;outline:none;resize:vertical;background:transparent;font:inherit;font-size:14.5px;line-height:1.6;color:var(--ink)}.wm-oo-box textarea::placeholder{color:var(--mute2)}'
  +'.wm-nst{letter-spacing:0;text-transform:none;font-weight:400}'
  /* The timed agenda: steps on the left, the open step on the right. */
  +'.wm-ag{margin-top:22px;border:1px solid var(--hair);border-radius:16px;padding:14px 16px 16px}'
  +'.wm-ag-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px;font-size:14px}.wm-ag-ctl{display:flex;align-items:center;gap:8px}'
  +'.wm-ag-grid{display:grid;grid-template-columns:270px minmax(0,1fr);gap:18px;align-items:start}'
  +'.wm-ag-steps{display:flex;flex-direction:column;gap:2px}'
  +'.wm-ag-step{position:relative;display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer;font-size:13px;color:var(--ink2);overflow:hidden}'
  +'.wm-ag-step:hover{background:#f6f8fb}.wm-ag-step.view{background:#f1f4f9;color:var(--ink);font-weight:600}'
  +'.wm-ag-step .ic{width:18px;text-align:center;color:var(--mute2);font-size:12px;flex:none}.wm-ag-step .l{flex:1;min-width:0}'
  +'.wm-ag-step.past{color:var(--mute)}.wm-ag-step.past .ic{color:#16a34a}'
  +'.wm-ag-step.now{background:#fef2f2;color:var(--ink);font-weight:700}.wm-ag-step.now .ic{color:var(--red)}'
  +'.wm-ag-step .cd{font-variant-numeric:tabular-nums;color:var(--red);font-weight:800}'
  +'.wm-ag-step .bar{position:absolute;left:0;right:0;bottom:0;height:3px;background:#fde2e2}.wm-ag-step .bar span{display:block;height:100%;background:var(--red);transition:width 1s linear}'
  +'.wm-ag-step .mn{width:42px;height:24px;border:1px solid transparent;border-radius:6px;text-align:right;font:inherit;font-size:12.5px;color:var(--mute);background:transparent;padding:0 4px}'
  +'.wm-ag-step .mn:hover,.wm-ag-step .mn:focus{border-color:var(--hair);background:#fff;outline:none;color:var(--ink)}.wm-ag-step .mu{font-size:11.5px;color:var(--mute2);margin-left:-6px}'
  +'.wm-ag-panel{min-width:0;border-left:1px solid var(--hair2);padding-left:18px}'
  +'.wm-ag-ph{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}.wm-ag-ph h3{font-size:19px;font-weight:700;color:var(--ink);margin-top:4px}.wm-ag-ph h3 i{color:var(--mute2);font-size:15px;margin-right:6px}'
  +'.wm-ag-big{font-size:34px;font-weight:800;letter-spacing:-1px;color:var(--red);font-variant-numeric:tabular-nums;line-height:1}'
  +'.wm-ag-ta{width:100%;min-height:120px;border:1px solid var(--hair);border-radius:12px;padding:10px 12px;outline:none;resize:vertical;font:inherit;font-size:14.5px;line-height:1.6;color:var(--ink)}.wm-ag-ta:focus{border-color:#cbd5e1}'
  +'.wm-kt-wrap{overflow-x:auto;border:1px solid var(--hair);border-radius:12px}'
  +'.wm-kt{border-collapse:collapse;width:100%;font-size:13px}.wm-kt th,.wm-kt td{border-bottom:1px solid var(--hair2);padding:0;text-align:left;white-space:nowrap}.wm-kt tr:last-child td{border-bottom:0}'
  +'.wm-kt th{background:#f8fafc;font-weight:700;color:var(--ink2);position:relative}.wm-kt th:first-child,.wm-kt td.p{padding:8px 12px}.wm-kt td.p{display:flex;align-items:center;gap:8px;color:var(--ink)}'
  +'.wm-kt th input.h{width:120px;border:0;background:transparent;font:inherit;font-weight:700;color:var(--ink2);padding:8px 26px 8px 10px;outline:none}.wm-kt th input.h:focus{background:#fff}'
  +'.wm-kt th .x{position:absolute;right:4px;top:50%;transform:translateY(-50%);border:0;background:none;color:var(--mute2);cursor:pointer;font-size:11px;opacity:0}.wm-kt th:hover .x{opacity:1}.wm-kt th .x:hover{color:var(--red)}'
  +'.wm-kt th.add{padding:0 12px;width:1%}.wm-kt td input{width:120px;border:0;border-left:1px solid var(--hair2);font:inherit;font-size:13px;padding:8px 10px;outline:none;color:var(--ink);background:transparent}.wm-kt td input:focus{background:#fffbea}'
  +'.wm-three{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:12px}'
  +'.wm-ended{color:#15803d;font-weight:600;display:inline-flex;align-items:center;gap:6px}'
  +'.wm-recur-hint{margin-top:8px;font-size:12.5px;color:#15803d;background:#f0fdf4;border-radius:8px;padding:7px 10px}.wm-recur-hint:empty{display:none}.wm-recur-hint i{margin-right:6px}'
  +'.wm-rep{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--mute)}.wm-rep i{font-size:11px}.wm-rep.off{color:var(--mute2)}.wm-rep .wm-quiet{font-size:12.5px;text-decoration:underline;text-underline-offset:2px}'
  +'.wm-mi-rep{font-size:9.5px;color:var(--mute2);margin-left:4px}'
  /* The agenda in the start/schedule form: one tidy row per step - tick, icon, name, minutes. */
  +'.wm-agf{border:1px solid var(--line);border-radius:12px;overflow:hidden}'
  +'.wm-agf-row{display:grid;grid-template-columns:20px 18px minmax(0,1fr) auto;align-items:center;gap:12px;padding:9px 12px;border-bottom:1px solid var(--line-2);cursor:pointer;user-select:none;outline:none}'
  +'.wm-agf-row:hover,.wm-agf-row:focus-visible{background:#f8fafc}'
  +'.wm-agf-row .ck{width:18px;height:18px;border-radius:5px;border:1.5px solid #cbd5e1;display:flex;align-items:center;justify-content:center;font-size:10px;color:transparent;background:#fff}'
  +'.wm-agf-row.on .ck{background:#e0121c;border-color:#e0121c;color:#fff}'
  +'.wm-agf-row .ic{color:#94a3b8;font-size:13px;text-align:center}.wm-agf-row.on .ic{color:#64748b}'
  +'.wm-agf-row .nm{font-size:13.5px;font-weight:500;color:#0b1220;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  +'.wm-agf-row .nm em{font-style:normal;font-size:10.5px;font-weight:600;color:#15803d;background:#f0fdf4;border-radius:5px;padding:1px 6px;margin-left:8px;vertical-align:1px}'
  +'.wm-agf-row.off .nm,.wm-agf-row.off .ic{opacity:.45}.wm-agf-row.off .nm{text-decoration:line-through}'
  +'.wm-agf-row .mn{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:8px;background:#fff;height:30px;cursor:default}'
  +'.wm-agf-row .mn button{width:26px;height:28px;border:0;background:none;color:#64748b;font-size:15px;cursor:pointer;padding:0}.wm-agf-row .mn button:hover:not(:disabled){color:#0b1220}'
  +'.frm .wm-agf-row .mn input{width:34px;height:28px;border:0;border-radius:0;padding:0;margin:0;text-align:center;font-size:13.5px;font-weight:600;color:#0b1220;background:transparent;box-shadow:none;-moz-appearance:textfield}'
  +'.wm-agf-row .mn input::-webkit-outer-spin-button,.wm-agf-row .mn input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}'
  +'.wm-agf-row .mn small{font-size:11.5px;color:#94a3b8;padding:0 9px 0 2px;border-left:1px solid var(--line-2);margin-left:2px;padding-left:8px}'
  +'.wm-agf-row.off .mn{opacity:.4}'
  +'.wm-agf-tot{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;color:var(--slate);padding:9px 12px;background:#f8fafc}.wm-agf-tot b{color:#0b1220;font-size:13.5px}'
  /* Obstacles & Opportunities notes */
  +'.wm-nt-add{width:100%;height:36px;border:1px solid var(--hair);border-radius:9px;padding:0 11px;font:inherit;font-size:13.5px;outline:none;background:#fff;margin:2px 0 6px}.wm-nt-add:focus{border-color:#cbd5e1}'
  +'.wm-nt{display:flex;gap:10px;align-items:flex-start;padding:9px 2px;border-top:1px solid rgba(15,23,42,.06)}.wm-nt:first-child{border-top:0}'
  +'.wm-nt .ck{width:20px;height:20px;flex:none;border-radius:50%;border:1.5px solid #cbd5e1;background:#fff;color:transparent;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;margin-top:1px}'
  +'.wm-nt .ck:hover{border-color:#16a34a;color:#86efac}.wm-nt.solved .ck{background:#16a34a;border-color:#16a34a;color:#fff}'
  +'.wm-nt .tx{flex:1;min-width:0}.wm-nt .bd{font-size:14px;color:var(--ink);line-height:1.45;word-wrap:break-word}.wm-nt.solved .bd{color:var(--mute);text-decoration:line-through}'
  +'.wm-nt .mt{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:4px;font-size:11.5px}'
  +'.wm-nt .st{font-weight:700;border-radius:6px;padding:1px 7px}.wm-nt .st.n{background:#fef2f2;color:#dc2626}.wm-nt .st.y{background:#f0fdf4;color:#15803d}'
  +'.wm-nt .fr{color:#1d4ed8;font-weight:600}.wm-nt .tk{color:#334155;background:#f1f4f9;border-radius:6px;padding:1px 7px}.wm-nt .wm-quiet{font-size:12px}'
  +'.wm-nt .rm{border:0;background:none;color:var(--mute2);cursor:pointer;opacity:0;font-size:11px}.wm-nt:hover .rm{opacity:1}.wm-nt .rm:hover{color:var(--red)}'
  +'.wm-oo-old{display:grid;gap:8px;margin-bottom:12px;font-size:13px;color:var(--ink2);background:#f8fafc;border-radius:10px;padding:10px 12px}.wm-oo-old b{font-size:11.5px;color:var(--mute);text-transform:uppercase;letter-spacing:.06em}'
  +'.wm-ntm label.pp{display:flex!important;align-items:center;gap:12px;padding:7px 4px;margin:0!important;font-weight:400!important;font-size:14px;color:#0b1220;cursor:pointer;border-radius:8px}.wm-ntm label.pp:hover{background:#f8fafc}'
  +'.frm.wm-ntm label.pp input{width:auto;margin:0;padding:0;accent-color:#e0121c}.wm-ntm label.pp span{margin-left:auto;font-size:12px;color:var(--slate)}.wm-ntm .g{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--slate);font-weight:700;padding:12px 4px 4px}'
  /* KPI review */
  +'.wm-kr-empty{margin-top:14px;font-size:12.5px;color:var(--mute)}.wm-kr-empty i{margin-right:6px}'
  +'.wm-kr-t td{padding:7px 12px}.wm-kr-t td.mt{vertical-align:top;background:#fbfcfe;border-right:1px solid var(--hair2)}.wm-kr-t td.mt b{display:block;font-size:12.5px;color:var(--ink)}.wm-kr-t td.mt span{font-size:11.5px;color:var(--mute)}'
  +'.wm-kr-t td.p{display:flex;align-items:center;gap:8px}.wm-kr-t tr.first td{border-top:1px solid var(--hair)}.wm-kr-t th{padding:8px 12px}'
  /* The meeting clock and the section timer, big */
  +'.wm-mh-r{display:flex;align-items:center;gap:18px;flex-wrap:wrap}'
  +'.wm-clock{display:flex;flex-direction:column;align-items:flex-end;line-height:1}.wm-clock span{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);font-weight:700}'
  +'.wm-clock b{font-size:44px;font-weight:800;letter-spacing:-1.5px;color:var(--ink);font-variant-numeric:tabular-nums;margin:4px 0 4px}.wm-clock small{font-size:12px;color:var(--mute)}.wm-clock em{font-style:normal;font-weight:600;color:var(--ink2)}'
  +'.wm-ag-bigw{display:flex;align-items:center;gap:20px;background:#fef2f2;border-radius:14px;padding:14px 18px;margin:0 0 16px}'
  +'.wm-ag-bigw .wm-ag-big{font-size:68px;font-weight:800;letter-spacing:-3px;color:var(--red);font-variant-numeric:tabular-nums;line-height:1}'
  +'.wm-ag-bigr{flex:1;min-width:0}.wm-ag-bigr span{font-size:13px;color:var(--mute);font-weight:600}.wm-ag-bigbar{height:8px;border-radius:8px;background:#fde2e2;margin-top:8px;overflow:hidden}.wm-ag-bigbar span{display:block;height:100%;background:var(--red);transition:width 1s linear}'
  +'.wm-ag-bigw.paused{background:#f1f4f9}.wm-ag-bigw.paused .wm-ag-big{color:var(--mute)}.wm-ag-bigw.low .wm-ag-big{animation:wmBlink 1s steps(2) infinite}@keyframes wmBlink{50%{opacity:.45}}'
  +'.wm-ag-step .cd{font-size:15px}'
  +'.wm-addsec{display:flex;gap:22px;flex-wrap:wrap;margin-top:18px}'
  +'.wm-fp{border:1px solid var(--line);border-radius:10px;padding:8px}.wm-fp-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.wm-fp-chips .people-chip{font-size:12.5px}'
  +'.wm-fp-none{font-size:12.5px;color:var(--slate);padding:4px 2px}'
  +'.wm-fp input[type=text]{width:100%;height:34px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font:inherit;font-size:13px;outline:none}'
  +'.wm-fp-list{max-height:180px;overflow-y:auto;margin-top:6px}.wm-fp-list div{display:flex;align-items:center;gap:9px;padding:6px 6px;border-radius:8px;cursor:pointer;font-size:13px}.wm-fp-list div:hover{background:#f1f4f9}.wm-fp-list em{margin-left:auto;font-style:normal;font-size:11.5px;color:var(--slate)}'
  +'.wm-kpi-opt{display:flex!important;align-items:flex-start;gap:10px;margin-top:14px;cursor:pointer;font-weight:400!important}.wm-kpi-opt input{margin-top:3px;accent-color:#e0121c}.wm-kpi-opt small{color:var(--slate);font-size:12px}'
  +'.wm-box{background:#fff;border:1px solid var(--hair);box-shadow:var(--shadow);border-radius:20px;padding:20px 20px 16px}'
  +'.wm-railbtns{display:flex;gap:8px;margin-bottom:12px;align-items:center}.wm-railbtns .wm-ib{width:30px}.wm-railbtns .wm-btn{flex:1;justify-content:center}'
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
  +'.wm-light{background:#0b1220;color:#fff}.wm-light:hover{background:#1f2937}'
  +'.wm-line{background:#fff;color:var(--ink);box-shadow:inset 0 0 0 1px #d5dbe5}.wm-line:hover{box-shadow:inset 0 0 0 1px var(--ink)}'
  +'.wm-quiet{border:0;background:none;padding:0;color:var(--mute);font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:7px}'
  +'.wm-quiet:hover{color:var(--ink)}.wm-quiet i{font-size:10px}'
  +'.wm-card{background:#fff;border:1px solid var(--hair);box-shadow:var(--shadow);border-radius:24px;overflow:hidden}'
  +'.wm-card-top{padding:28px 32px 24px;border-bottom:1px solid var(--hair2)}'
  +'.wm-card-top h2{font-size:34px;font-weight:700;letter-spacing:-1.1px;color:var(--ink);margin-top:8px;line-height:1.15}'
  +'.wm-card-body{padding:4px 32px 34px}'
  +'.wm-mh{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap}'
  +'.wm-eyebrow{font-size:12.5px;color:var(--mute);display:flex;align-items:center;gap:8px;font-weight:500}'
  +'.wm-live{color:var(--red);font-weight:600;display:inline-flex;align-items:center;gap:7px}'
  +'.wm-live:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--red);animation:wmPulse 1.6s infinite}'
  +'.wm-tm{font-variant-numeric:tabular-nums;color:var(--ink2)}'
  +'.wm-info{position:relative;display:inline-flex;vertical-align:middle;margin-left:10px;color:var(--mute2);font-size:15px;cursor:default}'
  +'.wm-info:hover{color:var(--ink2)}'
  +'.wm-info .tip{display:none;position:absolute;left:50%;top:calc(100% + 10px);transform:translateX(-50%);background:#0b1220;color:#fff;font-size:13px;font-weight:400;letter-spacing:0;line-height:1.6;white-space:nowrap;padding:10px 14px;border-radius:12px;box-shadow:var(--shadow-lg);z-index:10}'
  +'.wm-info:hover .tip{display:block}'
  +'.wm-mh2{display:flex;align-items:center;gap:22px;margin-top:22px;flex-wrap:wrap;font-size:13px;color:var(--mute)}'
  /* Who was there: JainE's own people chips (initials + full name), in a dropdown under the count. */
  +'.wm-dd{position:relative}'
  +'.wm-dd-panel{position:absolute;left:0;top:calc(100% + 10px);z-index:20;min-width:280px;max-height:340px;overflow-y:auto;background:#fff;border:1px solid var(--hair);border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:6px;box-shadow:var(--shadow-lg);animation:wmIn .18s both}'
  +'.wm-dd-panel .people-chip{color:var(--ink);font-size:13px}'
  +'.wm-dd-panel .people-chip em{margin-left:auto;font-style:normal;font-size:11.5px;color:var(--mute);padding-left:12px}'
  +'.wm-dd-edit{margin:6px 2px 2px}'
  +'.wm-hsel{border:0;background:none;color:var(--mute);font:inherit;font-size:13px;cursor:pointer;outline:none;padding:0}'
  +'.wm-hsel:hover{color:var(--ink)}.wm-hsel option{background:#fff;color:var(--ink)}'
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
  +'.wm-parsed input[type=date],.wm-parsed select{border:0;background:none;font:inherit;font-size:13px;color:var(--ink2);outline:none;cursor:pointer;padding:0}'
  +'.wm-parsed select option{background:#fff}'
  +'.wm-parsed code{font-family:inherit;color:var(--ink2)}'
  +'.wm-sugg{position:absolute;left:0;top:58px;background:#fff;border:1px solid var(--hair);border-radius:14px;padding:6px;min-width:300px;z-index:6;box-shadow:var(--shadow-lg)}'
  +'.wm-sugg div{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;cursor:pointer;font-size:13.5px;color:var(--ink)}'
  +'.wm-sugg div span{margin-left:auto;font-size:12px;color:var(--mute)}'
  +'.wm-sugg div.on,.wm-sugg div:hover{background:#f1f4f9}'
  +'.wm-un{margin-top:30px}'
  +'.wm-sec{display:flex;align-items:center;gap:12px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);font-weight:600;margin-bottom:6px;min-height:30px}'
  +'.wm-sec em{font-style:normal;color:var(--ink)}.wm-sec .r{margin-left:auto}'
  +'.wm-ck{width:15px;height:15px;accent-color:var(--red);cursor:pointer;flex:none;margin:0}'
  +'.wm-bulk{display:flex;align-items:center;gap:18px;flex-wrap:wrap;background:#f1f4f9;color:var(--ink);border-radius:14px;padding:10px 12px 10px 16px;margin:4px 0 8px;font-size:13px}'
  +'.wm-bulk .ctl{border:0;background:none;color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;gap:7px;font-size:13px;padding:0}'
  +'.wm-bulk input[type=date]{border:0;background:none;font:inherit;font-size:13px;color:var(--ink);outline:none}'
  +'.wm-dr{display:flex;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid var(--hair2)}'
  +'.wm-dr.new{animation:wmFlash 1.6s both}'
  +'.wm-dr .ti{flex:1;min-width:0;border:0;outline:none;background:none;font:inherit;font-size:15px;color:var(--ink);padding:2px 0}'
  +'.wm-dr .ctl{border:0;background:none;color:var(--mute);cursor:pointer;display:inline-flex;align-items:center;gap:7px;font-size:13px;white-space:nowrap;padding:0}'
  +'.wm-dr .ctl:hover,.wm-dr .ctl.set{color:var(--ink)}'
  +'.wm-dr input[type=date]{border:0;background:none;font:inherit;font-size:13px;color:var(--mute);outline:none;cursor:pointer;width:112px}'
  +'.wm-dr input[type=date].set{color:var(--ink)}'
  +'.wm-dr .go{border:0;background:none;font-size:13px;font-weight:600;cursor:pointer;color:var(--mute2);padding:0}'
  +'.wm-dr .go.ready{color:var(--red)}'
  +'.wm-dr .rm{border:0;background:none;color:var(--mute2);cursor:pointer;opacity:0}'
  +'.wm-dr:hover .rm{opacity:1}.wm-dr .rm:hover{color:var(--red)}'
  /* The task section: grouped by person, every detail on show - kept exactly as designed. */
  +'.wm-v6{--ink2:#0b1220;--line3:#e6eaf1;--soft:#f1f4f9;--slate:#64748b;background:#fff;color:#0b1220;border:1px solid #e6eaf1;border-radius:18px;padding:2px 22px 18px;margin-top:34px}'
  +'.wm-v6 .ttabs{display:flex;align-items:center;gap:6px;margin:8px 0 6px;border-bottom:1px solid var(--line3);flex-wrap:wrap}'
  +'.wm-v6 .ttab{border:0;background:none;font:inherit;font-size:14px;font-weight:700;color:var(--slate);padding:10px 4px 12px;margin-right:16px;cursor:pointer;position:relative;display:inline-flex;align-items:center;gap:8px}'
  +'.wm-v6 .ttab .n{font-size:11.5px;font-weight:800;background:var(--soft);color:var(--slate);border-radius:9px;padding:1px 8px}'
  +'.wm-v6 .ttab.on{color:var(--ink2)}'
  +'.wm-v6 .ttab.on:after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:3px;border-radius:3px 3px 0 0;background:#e0121c}'
  +'.wm-v6 .ttab.on .n{background:#0b1220;color:#fff}.wm-v6 .ttab.on.pend .n{background:#e0121c;color:#fff}.wm-v6 .ttab.on.fin .n{background:#16a34a;color:#fff}'
  +'.wm-v6 .tfilter{margin-left:auto;display:flex;gap:8px;align-items:center;padding-bottom:6px;flex-wrap:wrap}'
  +'.wm-v6 .tfilter select,.wm-v6 .tfilter input{height:32px;border:1px solid var(--line3);border-radius:9px;padding:0 10px;font:inherit;font-size:12.5px;background:#fff;color:var(--ink2);outline:none}'
  +'.wm-v6 .tfilter select option{background:#fff;color:var(--ink2)}.wm-v6 .tfilter input{width:170px}'
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
  +'.wm-v6 .who .cnt.red{background:#fef2f2;color:#dc2626}'
  +'.wm-v6 .task{display:flex;gap:10px;align-items:flex-start;padding:7px 10px;border-radius:11px}'
  +'.wm-v6 .task:hover{background:#f8fafc}'
  +'.wm-v6 .task.new{animation:wmFlash 1.6s both;background:#fef2f2}'
  +'.wm-v6 .task .bx{width:18px;height:18px;border-radius:50%;border:1.5px solid #cbd5e1;flex:none;margin-top:1px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff}'
  +'.wm-v6 .task .bx:hover{border-color:#22c55e}'
  +'.wm-v6 .task.done .bx{background:#22c55e;border-color:#22c55e}'
  +'.wm-v6 .task.done .tt{color:#94a3b8}'
  +'.wm-v6 .task .tt{font-size:13.5px;color:var(--ink2);line-height:1.4}'
  +'.wm-v6 .task .mt{font-size:11.5px;color:var(--slate);margin-top:3px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}'
  +'.wm-v6 .task .od{color:#dc2626;font-weight:700}.wm-v6 .task .aw{color:#d97706;font-weight:700}'
  +'.wm-v6 .task span.ok{color:#16a34a;font-weight:700}'
  +'.wm-v6 .task .from{color:#1d4ed8;font-weight:600;cursor:pointer}.wm-v6 .task .from:hover{text-decoration:underline}'
  +'.wm-v6 .st{flex:none;font-size:11px;font-weight:800;border-radius:7px;padding:2px 8px;margin-top:1px}'
  +'.wm-v6 .st.p{background:#f1f4f9;color:#475569}.wm-v6 .st.a{background:#fffbeb;color:#b45309}.wm-v6 .st.f{background:#f0fdf4;color:#15803d}.wm-v6 .st.o{background:#fef2f2;color:#dc2626}'
  +'.wm-v6 .wm-st-sel{flex:none;height:26px;border:1px solid var(--line3);border-radius:7px;background:#fff;color:var(--ink2);font:inherit;font-size:11.5px;padding:0 6px;cursor:pointer}'
  +'.wm-v6 .b{height:28px;border:0;border-radius:8px;font:inherit;font-weight:700;font-size:12px;padding:0 10px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;white-space:nowrap}'
  +'.wm-v6 .b.ok{background:#16a34a;color:#fff}.wm-v6 .b.ok:hover{background:#15803d}'
  +'.wm-v6 .b.sb{background:#f1f4f9;color:#0b1220}.wm-v6 .b.sb:hover{background:#e6eaf1}'
  +'.wm-v6 .empty3{border:1.5px dashed var(--line3);border-radius:16px;padding:34px;text-align:center;color:var(--slate);margin-top:14px}'
  +'.wm-pk input[type=text]{width:100%;height:40px;border:1px solid var(--line);border-radius:9px;font:inherit;font-size:14px;outline:none;padding:0 12px}'
  +'.wm-pk label{display:flex;align-items:center;gap:12px;padding:8px 4px;cursor:pointer;font-size:14px;border-radius:8px}'
  +'.wm-pk label:hover{background:#f8fafc}.wm-pk label span{margin-left:auto;font-size:12px;color:var(--slate)}'
  +'.wm-pk .g{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--slate);font-weight:700;padding:14px 4px 4px}'
  +'@media(max-width:1100px){.wm-grid,.wm-grid.off{grid-template-columns:1fr}.wm-rail{position:static}.wm-railfold{flex-direction:row}}'
  +'@media(max-width:700px){.wm{padding:6px 0 40px}.wm-top h1{font-size:30px}.wm-card-top,.wm-card-body{padding-left:18px;padding-right:18px}.wm-card-top h2{font-size:26px}'
    +'.wm-v6{padding:2px 14px 14px}.wm-v6 .person{grid-template-columns:1fr;gap:6px}.wm-v6 .sumrow{grid-template-columns:repeat(2,1fr)}.wm-v6 .tfilter{margin-left:0;width:100%}.wm-v6 .tfilter input{flex:1}.wm-dr{flex-wrap:wrap}.wm-oo{grid-template-columns:1fr}.wm-ag-grid{grid-template-columns:1fr}.wm-ag-panel{border-left:0;padding-left:0}.wm-dr .ti{flex-basis:100%}}'
+'</style>';
