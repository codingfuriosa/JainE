/* ============================== JAINE-MEETINGS (page id weekly_status) ==============================
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

const WM={items:null,meetings:null,people:[],err:'',cur:null,view:'dash',from:'dash',upTab:'all',hq:'',ht:'',hs:'',liveT:null,tab:'pending',q:'',who:'',
  allF:'pending',allG:'meeting',allMtg:'',allWho:'',showPpl:false,wk:null,showPast:false,
  picked:{mem:[],due:null,recur:'none'},parsed:null,sugIdx:0,lastNew:null,lastDraft:null,
  sel:new Set(),draftMem:{},draftRecur:{},timer:null,busy:false,formPpl:new Set(),formEd:new Set(),mtab:'actions',ooF:'all',kpiT:null,noteT:{},formAg:[],agTimer:null,agView:null,agFollow:true,railOff:undefined};

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
// Who a task in this meeting can be given to. Everyone but yourself - except that whoever started the
// meeting may give its tasks to themselves as well.
// An editor (picked as Editor when the starter picks the people) has the same rights as the starter.
function wmIsStarterOrEditor(m){ return !!(m&&((m.created_by&&wmIsMe(m.created_by))||(m.editors||[]).some(wmIsMe))); }
function wmSelfOK(){ return wmIsStarterOrEditor(wmMeeting(WM.cur)); }
function wmAssignable(p){ return !wmIsMe(p.email)||wmSelfOK(); }
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
  if(!WM.ro){ try{ await sb.rpc('ops_meeting_series_fill'); }catch(e){} }
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
// Sees every meeting (the database says the same in app.ws_sees_all).
const WS_OWNERS=['businessanalyst@thejaingroup.com'];
const wmMeeting=id=>(WM.meetings||[]).find(m=>m.id===id);
const wmSeries=kind=>(WM.meetings||[]).filter(m=>m.kind===kind);

VIEWS.weekly_status=async function(v){
  setCrumb(['Overview',WM_NAME]);
  // The handoff's typeface, loaded once.
  if(!document.getElementById('wmFont')){ const l=document.createElement('link'); l.id='wmFont'; l.rel='stylesheet'; l.href='https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap'; document.head.appendChild(l); }
  WM.ro=!canEditWeeklyStatus();   // a person on the meeting reads it; the starter edits
  loader(v);
  await wmLoad();
  if(WM.items===null){
    v.innerHTML=WM_CSS+'<div class="wm"><div class="wm-top"><h1>'+WM_NAME+'</h1></div><div class="wm-empty"><b>Could not load.</b>'+esc(WM.err||'')+'</div></div>';
    return;
  }
  const today=wmToday();
  // Opens on today's meeting; otherwise on the latest regular meeting - a kind held at least three
  // times, such as OPS or OPS & Purchase - so a test or a sample meeting (even one tried twice) never
  // becomes the page you land on.
  const ms=WM.meetings||[], regular=m=>ms.filter(x=>x.kind===m.kind).length>=3;
  WM.cur=(ms.find(m=>m.meeting_date===today)||ms.find(m=>m.meeting_date<=today&&regular(m))||ms.find(m=>m.meeting_date<=today)||ms[0]||{}).id||null;
  WM.view='dash'; WM.from='dash';
  v.innerHTML=WM_CSS+'<div class="wm" id="wmRoot"></div>';
  wmWatchReadOnly();
  wmRender();
};

/* WHO CAN DO WHAT (16 Nov 2026).
   * Seeing a meeting: you were in it, you started it, you were made its editor - or you are the owner.
   * Changing a meeting: only whoever started it, the editors they chose, and the owner (m.can_edit, from
     app.ws_can_edit). Everyone else reads it: whatever would change it is hidden or switched off here,
     and the database refuses it in any case.
   * Starting or scheduling a new meeting needs Weekly Status itself (WM.ro is true without it).
   Ticking or approving a task follows Accountability's own rule (only who assigned it), so those stay. */
const WM_NEW=/\bwm(?:StartMeeting|ScheduleMeeting|MeetingSave)\b/;
const WM_EDIT=/\bwm(?:EditItem|NoteEdit|SeriesStop|EndMeeting|Reopen|AgStart|AgStep|AgPause|AgAdd|AgEdit|AgEditSave|AgStepAdd|AgStepAddSave|AgStepDel|AgMins|AgNoteInput|AgNoteSave|KpiAdd|KpiInput|KpiSave|KpiColAdd|KpiColDel|KpiColName|KpiCell|OoAdd|NoteAdd|NoteInput|NoteSave|NoteSolve|NoteTask|NoteTaskSave|NoteDel|Reschedule|RescheduleSave|EditAttendance|SaveAttendance|Parse|Key|DropMem|PickPeople|SelAll|Promote|BulkPeople|BulkDue|DraftText|DraftDue|DraftDelete|Choose|Add1)\b/;
function wmCanEdit(id){ const m=wmMeeting(id); return !m||m.can_edit!==false; }
function wmLockIn(scope,re){
  if(!scope) return;
  scope.querySelectorAll('[onclick],[onchange],[oninput],[onkeydown],[onblur]').forEach(function(el){
    const hit=['onclick','onchange','oninput','onkeydown','onblur'].some(function(a){ const v=el.getAttribute(a); return v&&re.test(v); });
    if(!hit) return;
    if(/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)){ if('readOnly' in el) el.readOnly=true; el.disabled=true; el.style.pointerEvents='none'; el.style.opacity='.7'; }
    else el.style.display='none';
  });
}
function wmLockView(){
  const root=$('wmRoot'); if(!root) return;
  if(WM.ro) wmLockIn(root,WM_NEW);
  if(WM.view==='board'&&WM.cur&&!wmCanEdit(WM.cur)){
    wmLockIn(root,WM_EDIT);
    root.querySelectorAll('.wm-cap,#wmDrafts,.wm-nt-add').forEach(function(el){ el.style.display='none'; });
  }
}
function wmWatchReadOnly(){
  if(WM.lockObs){ WM.lockObs.disconnect(); WM.lockObs=null; }
  const root=$('wmRoot'); if(!root) return;
  WM.lockObs=new MutationObserver(wmLockView);
  WM.lockObs.observe(root,{childList:true,subtree:true});
}


/* ---------- JainE-Meetings (24 Nov 2026) ----------
   The page is one workspace with its own Meetings sidebar inside JainE:
   * Dashboard - this week in numbers, today's schedule, what is live, this week by kind of meeting,
     open actions across all meetings, and the meetings finished most recently;
   * Upcoming - every meeting still to come, by day, with a countdown on today's, Reschedule and Join;
   * Running - every meeting live now, with its clock, progress against its agenda and the step it is on;
   * History - every past meeting, searchable, with a CSV download and a summary of each;
   * Tasks - every open task across all meetings (the old "N tasks pending" link).
   The top bar searches meetings, people, notes and tasks; "+ New meeting" starts one now or schedules
   one; the bell opens the tasks waiting for your approval. Opening a meeting shows the meeting page
   (agenda, Action Taken, KPI, Opportunities & Obstacles) inside the same workspace.
   The old right-hand panel is gone: Start / Schedule are under "+ New meeting", the coming weeks are
   Upcoming, earlier days are History, and the live dot is Running. */
const WM_NAME='JainE-Meetings';
function wmCounts(){ wmPaintSide(); wmPaintBoardStats(); if(typeof wmPaintWTabs==='function') wmPaintWTabs(); }
function wmMonday(iso){ const d=new Date(iso+'T00:00'); d.setDate(d.getDate()-((d.getDay()+6)%7)); return wmIso(d); }
const WM_DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const wmTime=t=>t?String(t).slice(0,5):'';
// Everything that changes a task or a meeting repaints the sidebar counts through this old name.
function wmPaintNav(){ wmPaintSide(); }

/* ---------- when a meeting is: Upcoming, Live, or past (Ended / Held) ----------
   Ended = End meeting was pressed. Live = today, not ended, and started on this page (its clock or its
   agenda timer) or its start time has come and it is within its length plus half an hour. Upcoming =
   a later day, or today before it starts. Anything else from today or earlier is past. */
function wmNowSec(){ try{ const d=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'})); return d.getHours()*3600+d.getMinutes()*60+d.getSeconds(); }catch(e){ const d=new Date(); return d.getHours()*3600+d.getMinutes()*60+d.getSeconds(); } }
const wmMin=t=>t?Number(String(t).slice(0,2))*60+Number(String(t).slice(3,5)):null;
function wmStartMs(m){ try{ return Number(localStorage.getItem('wm_start_'+m.id))||0; }catch(e){ return 0; } }
// How long a meeting is: what it ran if it has ended, else its agenda's minutes, else an hour.
function wmDur(m){ if(m.ended_at&&m.ran_minutes) return m.ran_minutes; const t=m.agenda?wmAgOn(m).reduce((a,x)=>a+(Number(x.mins)||0),0):0; return t||60; }
function wmStatus(m){
  const today=wmToday();
  if(m.ended_at) return 'ended';
  if(m.meeting_date>today) return 'up';
  if(m.meeting_date<today) return 'held';
  if(wmStartMs(m)||m.agenda_run) return 'live';
  const s=wmMin(m.start_time), now=Math.floor(wmNowSec()/60);
  if(s==null||now<s) return 'up';
  return now<s+wmDur(m)+30?'live':'held';
}
function wmElapsed(m){ const s=wmStartMs(m); if(s) return Math.max(0,Math.floor((Date.now()-s)/1000)); const t=wmMin(m.start_time); return t==null?0:Math.max(0,wmNowSec()-t*60); }
const wmHMS=x=>{ const h=Math.floor(x/3600), mm=Math.floor(x%3600/60), ss=x%60; return (h?h+':'+String(mm).padStart(2,'0'):String(mm).padStart(2,'0'))+':'+String(ss).padStart(2,'0'); };
const wmByTime=(a,b)=>String(a.start_time||'99')<String(b.start_time||'99')?-1:String(a.start_time||'99')>String(b.start_time||'99')?1:a.id-b.id;
function wmUpList(){ return (WM.meetings||[]).filter(m=>wmStatus(m)==='up').sort((a,b)=>a.meeting_date<b.meeting_date?-1:a.meeting_date>b.meeting_date?1:wmByTime(a,b)); }
function wmLiveList(){ return (WM.meetings||[]).filter(m=>wmStatus(m)==='live').sort(wmByTime); }
function wmPastList(){ return (WM.meetings||[]).filter(m=>{ const s=wmStatus(m); return s==='ended'||s==='held'; }); }
function wmHost(m){ return m.created_by?wmName(m.created_by):'Minutes sheet'; }
function wmPplN(m){ return (m.attendees||[]).length||(m.invitees||[]).length; }
function wm12(t){ if(!t) return ['—','']; let h=Number(String(t).slice(0,2)); const mi=String(t).slice(3,5), ap=h>=12?'PM':'AM'; h=h%12||12; return [h+':'+mi,ap]; }
const wmWhen=m=>wmFmt(m.meeting_date)+(m.start_time?', '+wmTime(m.start_time):'');

/* Each kind of meeting keeps one colour everywhere: the handoff's four, then two more. */
const WM_TY=[['#E7EEFF','#3767DB'],['#FFF1E2','#C46E12'],['#F0EBFF','#7550E0'],['#FDECEE','#D23F57'],['#E3F6EC','#1E8A55'],['#E4F3F6','#1C7C8C']];
function wmKinds(){ const c={}; (WM.meetings||[]).forEach(m=>{ const k=m.kind||'Meeting'; c[k]=(c[k]||0)+1; }); return Object.keys(c).sort((a,b)=>c[b]-c[a]||(a<b?-1:1)); }
function wmTy(kind){ const i=wmKinds().indexOf(kind||'Meeting'); return WM_TY[(i<0?0:i)%WM_TY.length]; }
function wmTyPill(kind){ const c=wmTy(kind); return `<span class="mt-pill" style="background:${c[0]};color:${c[1]}">${esc(kind||'Meeting')}</span>`; }
const WM_STP={live:['#FDECEC','#D63B41','Live'],up:['#EDEBFE','#4A3AD6','Upcoming'],ended:['#F0F1F5','#7A8095','Done'],held:['#F0F1F5','#7A8095','Done']};
function wmStPill(m){ const s=wmStatus(m), c=WM_STP[s]; return `<span class="mt-pill" style="background:${c[0]};color:${c[1]}">${s==='live'?'<i class="mt-dot"></i>':''}${c[2]}</span>`; }
// A past meeting's state, for History: its tasks first, then whether it was ended on this page.
function wmHistSt(m){
  if(Number(m.open_count)>0) return ['open','Tasks open','#EFEAFE','#6A4BD8'];
  if(Number(m.item_count)>0) return ['done','Tasks finished','#E3F6EC','#1E8A55'];
  if(m.ended_at) return ['ended','Ended','#E6F0FF','#2F64D0'];
  return ['rec','Recorded','#F0F1F5','#5D6378'];
}
const WM_HST=[['open','Tasks open'],['done','Tasks finished'],['ended','Ended'],['rec','Recorded']];
function wmRecurShort(m){ return m.series_id&&m.recur&&m.recur!=='none'?String(m.recur).charAt(0).toUpperCase()+String(m.recur).slice(1):m.created_by?'Once':'Minutes sheet'; }

/* ---------- the workspace ---------- */
function wmRender(){
  const root=$('wmRoot'); if(!root) return;
  clearInterval(WM.timer); clearInterval(WM.liveT);
  if(!['dash','up','run','hist','board','all'].includes(WM.view)) WM.view='dash';
  if(!$('wmShell')){
    root.innerHTML=`<div class="mt-shell wm-in ${wmSideOff()?'mini':''}" id="wmShell"><aside class="mt-side" id="wmSide"></aside><div class="mt-main"><header class="mt-top" id="wmTop"></header><div class="mt-content" id="wmView"></div></div></div>`;
    wmPaintTop();
  }
  wmPaintSide();
  const rs=$('wmRes'); if(rs) rs.style.display='none';
  const v=$('wmView'); if(!v) return;
  if(WM.view==='board') return wmRenderBoard();
  if(WM.view==='all'){ v.innerHTML='<div id="wmMain"></div>'; wmPaintAll(); return; }
  v.innerHTML=(WM.ro&&WM.view==='dash'?'<div class="mt-ro"><i class="fa-solid fa-eye"></i> You can see the meetings you are in. Only the person who started a meeting (or someone they made an editor) can change it.</div>':'')
    +(WM.view==='dash'?wmDashHtml():WM.view==='up'?wmUpHtml():WM.view==='run'?wmRunHtml():wmHistHtml());
  if(WM.view==='hist') wmPaintHist();
  wmLiveTick(); WM.liveT=setInterval(wmLiveTick,1000);
}
// The Meetings sidebar folds to a strip of icons; remembered on this computer.
function wmSideOff(){ if(WM.sideOff===undefined){ try{ WM.sideOff=localStorage.getItem('wm_side_off')==='1'; }catch(e){ WM.sideOff=false; } } return WM.sideOff; }
window.wmSideToggle=function(){
  const off=WM.sideOff=!wmSideOff(); try{ localStorage.setItem('wm_side_off',off?'1':'0'); }catch(e){}
  const s=$('wmShell'); if(s) s.classList.toggle('mini',off); wmPaintSide();
};
window.wmGo=function(v){ WM.view=v; wmRender(); window.scrollTo({top:0,behavior:'smooth'}); };
function wmPaintSide(){
  const s=$('wmSide'); if(!s||!WM.items) return;
  const up=wmUpList().length, live=wmLiveList().length, pend=WM.items.filter(it=>!it.draft&&wmOpen(it)).length;
  const me=String(state.email||''), nm=me?wmName(me):'You';
  const role=WS_OWNERS.includes(me.toLowerCase())?'Owner · sees every meeting':WM.ro?'Sees the meetings they are in':'Can start meetings';
  const it=(v,ic,l,pill)=>`<button class="mt-nav ${WM.view===v?'on':''}" title="${l}" onclick="wmGo('${v}')"><i class="${ic}"></i><span>${l}</span>${pill||''}</button>`;
  const cur=WM.view==='board'?wmMeeting(WM.cur):null;
  const off=wmSideOff();
  s.innerHTML=`<div class="mt-logo"><span class="sq">JM</span><b>${WM_NAME}</b><button class="mt-fold" onclick="wmSideToggle()" title="${off?'Show the menu':'Hide the menu'}" aria-label="${off?'Show the menu':'Hide the menu'}"><i class="fa-solid fa-angles-${off?'right':'left'}"></i></button></div>
    <div class="mt-sl">Meetings</div>
    <nav class="mt-navs">${it('dash','fa-solid fa-table-cells-large','Dashboard')}${it('up','fa-regular fa-clock','Upcoming',up?`<span class="mt-cnt">${up}</span>`:'')}${it('run','fa-solid fa-video','Running',live?`<span class="mt-cnt live"><i></i>${live}</span>`:'')}${it('hist','fa-solid fa-clock-rotate-left','History')}</nav>
    <div class="mt-sl">Work</div>
    <nav class="mt-navs">${it('all','fa-solid fa-list-check','Tasks',pend?`<span class="mt-cnt">${pend}</span>`:'')}</nav>
    ${cur?`<div class="mt-sl">Open meeting</div><nav class="mt-navs"><button class="mt-nav on" title="${esc(cur.kind||'Meeting')}" onclick="wmGoPanel('wmShell')"><i class="fa-solid fa-door-open"></i><span>${esc(cur.kind||'Meeting')}</span></button></nav>`:''}
    <div class="mt-user" title="${esc(nm)} · ${esc(role)}"><span class="mt-av">${esc(initials(nm).toUpperCase())}</span><div><b>${esc(nm)}</b><span>${esc(role)}</span></div></div>`;
  // The bell: tasks you gave that are marked done and wait for your approval.
  const aw=WM.items.filter(x=>!x.draft&&x.st==='awaiting'&&wmIsMe(x.delegator)).length, b=$('wmBell'), d=$('wmBellDot');
  if(d) d.className=aw?'on':''; if(b) b.title=aw?aw+' task'+(aw===1?'':'s')+' waiting for your approval':'Nothing waiting for your approval';
}
function wmPaintTop(){
  const t=$('wmTop'); if(!t) return;
  t.innerHTML=`<div class="mt-search"><i class="fa-solid fa-magnifying-glass"></i><input id="wmSearch" placeholder="Search meetings, people, notes…" autocomplete="off" oninput="wmSearch(this.value)" onfocus="wmSearch(this.value)" onkeydown="if(event.key==='Escape'){this.value='';wmSearch('')}"><div class="mt-res" id="wmRes" style="display:none"></div></div>
    <div class="mt-top-r"><span class="mt-date">${esc(new Date(wmToday()+'T00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'}))}</span>
    ${WM.ro?'':`<div class="mt-neww"><button class="mt-btn" onclick="wmNewMenu(event)"><i class="fa-solid fa-plus"></i> New meeting</button><div class="mt-menu" id="wmNewMenu" style="display:none">
      <button onclick="wmNewMenu();wmStartMeeting()"><i class="fa-solid fa-play"></i><span><b>Start now</b><small>Today, at the time now - the clock starts</small></span></button>
      <button onclick="wmNewMenu();wmScheduleMeeting()"><i class="fa-regular fa-calendar-plus"></i><span><b>Schedule for later</b><small>Pick the day, the time and how often it repeats</small></span></button></div></div>`}
    <button class="mt-bell" id="wmBell" onclick="wmOpenAll('awaiting')"><i class="fa-regular fa-bell"></i><span id="wmBellDot"></span></button></div>`;
}
window.wmNewMenu=function(e){ if(e) e.stopPropagation(); const m=$('wmNewMenu'); if(m) m.style.display=m.style.display==='none'?'':'none'; };
document.addEventListener('click',function(e){
  const m=$('wmNewMenu'); if(m&&m.style.display!=='none'&&!e.target.closest('.mt-neww')) m.style.display='none';
  const r=$('wmRes'); if(r&&r.style.display!=='none'&&!e.target.closest('.mt-search')) r.style.display='none';
});
// Search: meetings (kind, host, note), people (the meetings they were in), notes of every kind, tasks.
window.wmSearch=function(q){
  const r=$('wmRes'); if(!r) return; q=String(q||'').trim().toLowerCase();
  if(q.length<2){ r.style.display='none'; r.innerHTML=''; return; }
  const ms=WM.meetings||[], hit=s=>String(s||'').toLowerCase().includes(q);
  const mt=ms.filter(m=>hit(m.kind)||hit(m.note)||hit(wmHost(m))).slice(0,6);
  const ppl=WM.people.filter(p=>hit(p.name)).slice(0,5).map(p=>({p,ms:ms.filter(m=>(m.attendees||[]).some(n=>String(n).toLowerCase()===p.name.toLowerCase())||(m.invitees||[]).some(e=>String(e).toLowerCase()===p.email.toLowerCase()))})).filter(x=>x.ms.length);
  const notes=[];
  ms.forEach(m=>{ ['kpi_notes','obstacles','opportunities'].forEach(f=>{ if(hit(m[f])) notes.push({m,t:m[f]}); }); Object.values(m.agenda_notes||{}).forEach(v=>{ if(hit(v)) notes.push({m,t:v}); }); });
  (WM.notes||[]).forEach(n=>{ const m=wmMeeting(n.meeting_id); if(m&&hit(n.body)) notes.push({m,t:n.body}); });
  const tasks=(WM.items||[]).filter(it=>hit(it.t)&&wmMeeting(it.meeting)).slice(0,6);
  const snip=t=>{ t=String(t).replace(/\s+/g,' '); const i=t.toLowerCase().indexOf(q), s=Math.max(0,i-30); return (s?'…':'')+t.slice(s,s+90)+(t.length>s+90?'…':''); };
  const g=(l,rows)=>rows.length?`<div class="mt-rg">${l}</div>`+rows.join(''):'';
  const row=(id,ic,a,b)=>`<button class="mt-ri" onclick="$('wmRes').style.display='none';wmOpenMeeting(${id})"><i class="${ic}"></i><span><b>${a}</b><small>${b}</small></span></button>`;
  const html=g('Meetings',mt.map(m=>row(m.id,'fa-regular fa-calendar',esc(m.kind||'Meeting'),esc(wmWhen(m))+' · '+esc(wmHost(m)))))
    +g('People',ppl.map(x=>row(x.ms[0].id,'fa-regular fa-user',esc(x.p.name),'In '+x.ms.length+' meeting'+(x.ms.length===1?'':'s')+' · latest '+esc(x.ms[0].kind||'')+', '+esc(wmFmtS(x.ms[0].meeting_date)))))
    +g('Notes',notes.slice(0,6).map(x=>row(x.m.id,'fa-regular fa-note-sticky',esc(snip(x.t)),esc(x.m.kind||'')+' · '+esc(wmWhen(x.m)))))
    +g('Tasks',tasks.map(it=>row(it.meeting,'fa-solid fa-list-check',esc(snip(it.t)),esc(it.kind)+' · '+esc(wmFmtS(it.date))+' · '+esc(wmNames(it)))));
  r.innerHTML=html||`<div class="mt-rnone">Nothing matches “${esc(q)}”.</div>`; r.style.display='';
};
// Every second: the clocks and progress bars on Running, and "N min in" on the Dashboard.
function wmLiveTick(){
  if(!$('wmShell')){ clearInterval(WM.liveT); return; }
  document.querySelectorAll('[data-el]').forEach(el=>{ const m=wmMeeting(Number(el.dataset.el)); if(!m) return;
    const x=wmElapsed(m), pc=Math.min(100,x/(wmDur(m)*60)*100); el.textContent=wmHMS(x);
    const p=document.querySelector('[data-p="'+m.id+'"]'); if(p){ p.style.width=pc+'%'; p.classList.toggle('hot',pc>85); } });
  document.querySelectorAll('[data-min]').forEach(el=>{ const m=wmMeeting(Number(el.dataset.min)); if(m) el.textContent=Math.floor(wmElapsed(m)/60)+' min in'; });
}

/* ---------- Dashboard ---------- */
function wmGreet(){ const h=Number(String(wmNowTime()||'12').slice(0,2)); return h<12?'Good morning':h<17?'Good afternoon':'Good evening'; }
function wmNewBtns(){ return WM.ro?'':`<div class="mt-btns" style="justify-content:center;margin-top:10px"><button class="mt-btn sm" onclick="wmStartMeeting()"><i class="fa-solid fa-play"></i> Start now</button><button class="mt-btn sm ghost" onclick="wmScheduleMeeting()"><i class="fa-regular fa-calendar-plus"></i> Schedule</button></div>`; }
function wmDashHtml(){
  const today=wmToday(), mon=wmMonday(today), sun=wmAdd(mon,6), ms=WM.meetings||[];
  const wk=ms.filter(m=>m.meeting_date>=mon&&m.meeting_date<=sun), last=ms.filter(m=>m.meeting_date>=wmAdd(mon,-7)&&m.meeting_date<mon).length;
  const up=wmUpList(), live=wmLiveList(), todayUp=up.filter(m=>m.meeting_date===today).length;
  const hrs=Math.round(wk.reduce((a,m)=>a+wmDur(m),0)/6)/10, d=wk.length-last;
  const nm=state.email?wmFirst(state.email):'';
  const stat=(l,v,n,c,go,tip)=>`<button class="mt-card mt-stat" onclick="${go}" title="${tip}"><span>${l}</span><b>${v}</b><em style="color:${c}">${n}</em></button>`;
  const todays=ms.filter(m=>m.meeting_date===today).sort(wmByTime);
  const sched=todays.map(m=>{ const c=wmTy(m.kind);
    return `<div class="mt-sch" onclick="wmOpenMeeting(${m.id})"><div class="t"><b>${esc(m.start_time?wmTime(m.start_time):'—')}</b><small>${wmDur(m)} min</small></div><span class="bar" style="background:${c[1]}"></span>
      <div class="mid"><b>${esc(m.kind||'Meeting')}</b><small>${esc(wmHost(m))} · ${wmPplN(m)} ${m.meeting_date>today||wmStatus(m)==='up'?'invited':'people'}</small></div>${wmStPill(m)}</div>`; }).join('')
    ||`<div class="mt-empty">No meetings today.${wmNewBtns()}</div>`;
  const lives=live.slice(0,3).map(m=>`<div class="mt-live"><div style="min-width:0"><b class="mt-trunc">${esc(m.kind||'Meeting')}</b><small>${wmPplN(m)} participant${wmPplN(m)===1?'':'s'} · <span data-min="${m.id}">${Math.floor(wmElapsed(m)/60)} min in</span></small></div><button class="mt-btn sm" onclick="wmOpenMeeting(${m.id})">Join</button></div>`).join('')
    ||'<div class="mt-empty" style="padding:10px 0 2px">Nothing is running right now.</div>';
  const byK={}; wk.forEach(m=>{ const k=m.kind||'Meeting'; byK[k]=(byK[k]||0)+1; });
  const ks=Object.keys(byK).sort((a,b)=>byK[b]-byK[a]);
  const types=ks.length?`<div class="mt-seg">${ks.map(k=>`<span style="flex:${byK[k]};background:${wmTy(k)[1]}" title="${esc(k)}: ${byK[k]}"></span>`).join('')}</div>
      <div class="mt-leg">${ks.map(k=>`<div><i style="background:${wmTy(k)[1]}"></i><span>${esc(k)}</span><b>${byK[k]}</b></div>`).join('')}</div>`:'<div class="mt-empty" style="padding:10px 0 2px">No meetings this week.</div>';
  const live2=WM.items.filter(it=>!it.draft), pend=live2.filter(wmOpen).length, aw=live2.filter(it=>it.st==='awaiting'&&wmIsMe(it.delegator)).length, od=live2.filter(wmOverdue).length;
  const recent=wmPastList().slice(0,6).map(m=>{ const h=wmHistSt(m);
    return `<div class="mt-rc" onclick="wmOpenMeeting(${m.id})"><div style="min-width:0"><b class="mt-trunc" style="display:block">${esc(m.kind||'Meeting')}</b><small>${esc(wmHost(m))}</small></div><span>${wmTyPill(m.kind)}</span><span class="hide">${esc(wmFmtS(m.meeting_date))}${m.start_time?'<small style="display:block;color:#9AA0B4">'+esc(wmTime(m.start_time))+'</small>':''}</span><span><span class="mt-pill" style="background:${h[2]};color:${h[3]}">${h[1]}</span></span></div>`; }).join('')
    ||'<div class="mt-empty">No past meetings yet.</div>';
  return `<div class="mt-ph"><div><h1>${wmGreet()}${nm?', '+esc(nm):''}</h1><p>Here's how your meetings are shaping up this week.</p></div></div>
    <div class="mt-stats">${stat('Meetings this week',wk.length,(d>0?'+':'')+d+' vs last week',d>0?'#1E8A55':d<0?'#D63B41':'#7A8095',"WM.upTab='week';wmGo('up')",'Open the meetings still to come this week')}${stat('Upcoming',up.length,todayUp+' today','#7A8095',"WM.upTab='all';wmGo('up')",'Open Upcoming')}${stat('Running now',live.length,live.length?'live':'none live',live.length?'#D63B41':'#7A8095',"wmGo('run')",'Open Running')}${stat('Hours scheduled',hrs,'this week','#7A8095',"WM.upTab='week';wmGo('up')",'Open this week')}</div>
    <div class="mt-two">
      <div class="mt-card"><div class="mt-ch"><h3>Today's schedule</h3><button class="mt-lk" onclick="wmGo('up')">Upcoming →</button></div>${sched}</div>
      <div class="mt-stack">
        <div class="mt-card"><div class="mt-ch"><h3>${live.length?'<i class="mt-dot"></i>':''}Live now</h3><button class="mt-lk" onclick="wmGo('run')">View all →</button></div>${lives}</div>
        <div class="mt-card"><div class="mt-ch"><h3>Open actions</h3><button class="mt-lk" onclick="wmOpenAll('pending')">All tasks →</button></div>
          <div class="mt-acts"><button class="mt-act" onclick="wmOpenAll('pending')"><b>${pend}</b><span>pending</span></button><button class="mt-act" onclick="wmOpenAll('awaiting')"><b style="color:${aw?'#C46E12':'inherit'}">${aw}</b><span>to approve</span></button><button class="mt-act" onclick="wmOpenAll('overdue')"><b style="color:${od?'#D63B41':'inherit'}">${od}</b><span>overdue</span></button></div></div>
        <div class="mt-card"><div class="mt-ch"><h3>This week by type</h3></div>${types}</div>
      </div>
    </div>
    <div class="mt-card"><div class="mt-ch"><h3>Recently completed</h3><button class="mt-lk" onclick="wmGo('hist')">Full history →</button></div>${recent}</div>`;
}

/* ---------- Upcoming ---------- */
function wmUpHtml(){
  const today=wmToday(), tom=wmAdd(today,1), tab=WM.upTab||'all';
  let list=wmUpList();
  if(tab==='today') list=list.filter(m=>m.meeting_date===today); else if(tab==='tomorrow') list=list.filter(m=>m.meeting_date===tom); else if(tab==='week') list=list.filter(m=>m.meeting_date<=wmAdd(today,6));
  const tabs=[['all','All'],['week','This week'],['today','Today'],['tomorrow','Tomorrow']].map(([k,l])=>`<button class="mt-tab ${tab===k?'on':''}" onclick="WM.upTab='${k}';wmRender()">${l}</button>`).join('');
  const now=Math.floor(wmNowSec()/60);
  const days=[...new Set(list.map(m=>m.meeting_date))];
  const body=days.map(d=>{ const lb=(d===today?'Today · ':d===tom?'Tomorrow · ':'')+new Date(d+'T00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
    return `<div class="mt-day">${esc(lb)}</div>`+list.filter(m=>m.meeting_date===d).map(m=>{ const t=wm12(m.start_time), s=wmMin(m.start_time), mins=d===today&&s!=null?s-now:null;
      const soon=d===today&&(mins==null||mins<=90);
      const cd=d!==today?'':mins==null?'<span class="mt-cd soon">Today</span>':`<span class="mt-cd ${mins<=90?'soon':''}">${mins<=0?'Starting now':mins<=90?'Starts in '+mins+' min':'In '+Math.floor(mins/60)+'h '+(mins%60)+'m'}</span>`;
      return `<div class="mt-card mt-up"><div class="tm"><b>${esc(t[0])}</b><small>${esc(t[1])}</small></div>
        <div style="min-width:0"><div class="ti"><b onclick="wmOpenMeeting(${m.id})">${esc(m.kind||'Meeting')}</b>${wmTyPill(m.kind)}${m.series_id&&m.series_active?`<span class="mt-rep" title="${esc(wmRecurWords(m.recur,m.meeting_date,m.start_time))}"><i class="fa-solid fa-repeat"></i> ${esc(wmRecurShort(m))}</span>`:''}</div>
          <div class="mt-meta"><span>${wmDur(m)} min</span>·<span>Host ${esc(wmHost(m))}</span>·<span>${wmPplN(m)} invited</span>${m.agenda?'·<span>Timed agenda</span>':''}${wmCanEdit(m.id)?'':'·<span><i class="fa-solid fa-eye"></i> View only</span>'}</div></div>
        ${cd||'<span></span>'}
        <div class="mt-btns">${wmCanEdit(m.id)&&!WM.ro?`<button class="mt-btn sm ghost" onclick="wmReschedule(${m.id})">Reschedule</button>`:''}<button class="mt-btn sm ${soon?'':'off'}" onclick="wmOpenMeeting(${m.id})" title="${soon?'Open the meeting':'Opens 90 minutes before - click to see it now'}">${soon?'Join':'Open'}</button></div></div>`; }).join(''); }).join('');
  return `<div class="mt-ph"><div><h1>Upcoming meetings</h1><p>Everything scheduled from now on.</p></div><div class="mt-tabs">${tabs}</div></div>
    <div class="mt-upl">${body||`<div class="mt-card mt-empty">${tab==='all'?'Nothing scheduled.':'Nothing scheduled for '+(tab==='week'?'this week':tab)+'.'}${wmNewBtns()}</div>`}</div>`;
}

/* ---------- Running ---------- */
const WM_AVC=['#5B4BE8','#2BA07A','#E07A3A','#3767DB'];
function wmRunHtml(){
  const live=wmLiveList();
  const cards=live.map(m=>{ const s=wmAgState(m), att=m.attendees||[];
    const step=!m.agenda?'No timed agenda':!s.run?'Agenda not started':s.done||s.finished?'Agenda finished':(s.items[s.i]||{}).l||'';
    const x=wmElapsed(m), pc=Math.min(100,x/(wmDur(m)*60)*100);
    return `<div class="mt-card mt-run"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="mt-lb"><i class="mt-dot"></i>LIVE</span>${wmTyPill(m.kind)}</div>
      <div><h3>${esc(m.kind||'Meeting')}</h3><div class="sub">Host · ${esc(wmHost(m))}${m.start_time?' · since '+esc(wmTime(m.start_time)):''}</div></div>
      <div><div class="mt-tmr"><b data-el="${m.id}">${wmHMS(x)}</b><span>of ${wmDur(m)} min</span></div><div class="mt-prog"><span data-p="${m.id}" class="${pc>85?'hot':''}" style="width:${pc}%"></span></div></div>
      <div class="mt-now">Now discussing · <b>${esc(step)}</b></div>
      <div class="mt-rf"><div class="mt-avs">${att.slice(0,4).map((n,i)=>`<span style="background:${WM_AVC[i%4]}" title="${esc(n)}">${esc(initials(n).toUpperCase())}</span>`).join('')}</div><em>${att.length} in the room</em>
        <button class="mt-btn sm ghost" onclick="wmOpenMeeting(${m.id});setTimeout(()=>{const i=$('wmSmart');if(i){i.scrollIntoView({block:'center'});i.focus();}},300)">Notes</button><button class="mt-btn sm" onclick="wmOpenMeeting(${m.id})">Join</button></div></div>`; }).join('');
  return `<div class="mt-ph"><div><h1>Running meetings</h1><p>${live.length?live.length+' meeting'+(live.length===1?' is':'s are')+' live across your workspace.':'Nothing is live right now.'}</p></div></div>
    ${cards?`<div class="mt-runs">${cards}</div>`:`<div class="mt-card mt-empty">No meeting is running. Start one from + New meeting, or open one from Upcoming.${wmNewBtns()}</div>`}`;
}

/* ---------- History ---------- */
function wmHistHtml(){
  return `<div class="mt-ph"><div><h1>Meeting history</h1><p>Browse and search your past meetings - with their tasks, notes and KPIs.</p></div></div>
    <div class="mt-card"><div class="mt-htool"><b id="wmHN"></b><div class="mt-hf">
      <input placeholder="Search by meeting or host" value="${esc(WM.hq||'')}" oninput="WM.hq=this.value;wmPaintHist()">
      <select onchange="WM.ht=this.value;wmPaintHist()"><option value="">All types</option>${wmKinds().map(k=>`<option ${WM.ht===k?'selected':''}>${esc(k)}</option>`).join('')}</select>
      <select onchange="WM.hs=this.value;wmPaintHist()"><option value="">All status</option>${WM_HST.map(([k,l])=>`<option value="${k}" ${WM.hs===k?'selected':''}>${l}</option>`).join('')}</select></div></div>
    <div class="mt-tw"><div class="mt-tbl"><div class="mt-tr mt-th"><span>Meeting</span><span>Date &amp; time</span><span>Duration</span><span>People</span><span>Host</span><span>Status</span><span>Actions</span></div><div id="wmHRows"></div></div></div></div>`;
}
function wmPaintHist(){
  const host=$('wmHRows'); if(!host) return;
  const q=String(WM.hq||'').trim().toLowerCase();
  const list=wmPastList().filter(m=>(!q||String(m.kind||'').toLowerCase().includes(q)||wmHost(m).toLowerCase().includes(q))&&(!WM.ht||m.kind===WM.ht)&&(!WM.hs||wmHistSt(m)[0]===WM.hs));
  const n=$('wmHN'); if(n) n.textContent=list.length+' meeting'+(list.length===1?'':'s');
  host.innerHTML=list.slice(0,300).map(m=>{ const h=wmHistSt(m), c=wmTy(m.kind);
    return `<div class="mt-tr"><div class="nm" onclick="wmOpenMeeting(${m.id})"><i class="sw" style="background:${c[1]}"></i><div style="min-width:0"><b>${esc(m.kind||'Meeting')}</b><small>${esc(wmRecurShort(m))} · ${Number(m.item_count)||0} task${Number(m.item_count)===1?'':'s'}${Number(m.open_count)?' · '+m.open_count+' open':''}</small></div></div>
      <span class="dt">${esc(wmFmtS(m.meeting_date))} ${esc(String(m.meeting_date).slice(0,4))}<small>${m.start_time?esc(wmTime(m.start_time)):'—'}</small></span>
      <span>${m.ran_minutes?m.ran_minutes+' min':'—'}</span><span>${(m.attendees||[]).length||'—'}</span><span class="mt-trunc">${esc(wmHost(m))}</span>
      <span><span class="mt-pill" style="background:${h[2]};color:${h[3]}">${h[1]}</span></span>
      <span class="mt-ia"><button class="mt-ib dl" title="Download tasks and notes (CSV)" onclick="wmDownload(${m.id})"><i class="fa-solid fa-download"></i></button><button class="mt-ib sm" title="Summary" onclick="wmSummary(${m.id})"><i class="fa-regular fa-file-lines"></i></button></span></div>`; }).join('')
    ||'<div class="mt-empty" style="padding:28px 0">No meetings match these filters.</div>';
}

/* Download: everything written in one meeting, as a CSV that opens in Excel. */
window.wmDownload=function(id){
  const m=wmMeeting(id); if(!m) return;
  const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const rows=[[WM_NAME,m.kind||'Meeting'],['Date',m.meeting_date],['Time',wmTime(m.start_time)],['Host',wmHost(m)],['People',(m.attendees||[]).join('; ')],['Ran',m.ran_minutes?m.ran_minutes+' min':''],[],['TASKS'],['Task','Given to','Due','Status']];
  WM.items.filter(it=>it.meeting===id).forEach(it=>rows.push([it.t,it.linked?it.mem.map(wmName).join('; '):it.owner,it.due?String(it.due).slice(0,10):(it.dueRaw||''),
    it.draft?'Unassigned':it.st==='done'?'Finished':it.st==='awaiting'?'Awaiting approval':wmOverdue(it)?'Overdue':it.linked?'Pending':(WM_LEGACY[it.st]||it.st)]));
  const cols=Array.isArray(m.kpi_cols)?m.kpi_cols.filter(c=>(c.name||'').trim()):[], vals=m.kpi_vals||{};
  if(cols.length){ rows.push([],['KPIS'],['Person'].concat(cols.map(c=>c.name))); Object.keys(vals).forEach(p=>rows.push([p].concat(cols.map(c=>(vals[p]||{})[c.id]||'')))); }
  const notes=(WM.notes||[]).filter(n=>n.meeting_id===id);
  if(notes.length){ rows.push([],['TO-DOS, OPPORTUNITIES & OBSTACLES'],['Kind','Note','Done / solved','Written by']); notes.forEach(n=>rows.push([WM_SEC_H[n.section]||n.section,n.body,n.solved?(wmIsTd(n)?'Done':'Solved'):(wmIsTd(n)?'To do':'Unsolved'),n.created_by?wmName(n.created_by):''])); }
  const an=Object.entries(m.agenda_notes||{}).filter(([k,v])=>String(v||'').trim());
  if(an.length||(m.kpi_notes||'').trim()||(m.obstacles||'').trim()||(m.opportunities||'').trim()){ rows.push([],['NOTES']);
    an.forEach(([k,v])=>rows.push([(wmAgMerge(m.agenda).find(a=>a.k===k)||{l:/^c_/.test(k)?'Notes of a step since removed':k}).l,v]));
    [['kpi_notes','KPI notes'],['obstacles','Obstacles'],['opportunities','Opportunities']].forEach(([f,l])=>{ if((m[f]||'').trim()) rows.push([l,m[f]]); }); }
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['﻿'+rows.map(r=>r.map(q).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  a.download=(WM_NAME+' '+(m.kind||'Meeting')+' '+m.meeting_date).replace(/[\\/:*?"<>|]+/g,'-')+'.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),3000);
  toast('Downloaded '+(m.kind||'the meeting')+', '+wmFmtS(m.meeting_date),'ok');
};
/* Summary: the meeting on one screen - who, the tasks by person, KPIs, O&O and the notes. */
window.wmSummary=function(id){
  const m=wmMeeting(id); if(!m) return;
  const mine=WM.items.filter(it=>it.meeting===id&&!it.draft), keys=[...new Set(mine.flatMap(wmWhoKeys))], drafts=WM.items.filter(it=>it.meeting===id&&it.draft).length;
  const cols=Array.isArray(m.kpi_cols)?m.kpi_cols.filter(c=>(c.name||'').trim()):[], vals=m.kpi_vals||{}, kp=Object.keys(vals).filter(p=>cols.some(c=>String((vals[p]||{})[c.id]||'').trim()));
  const notes=(WM.notes||[]).filter(n=>n.meeting_id===id);
  const an=Object.entries(m.agenda_notes||{}).filter(([k,v])=>String(v||'').trim());
  const h=t=>`<h4 style="font-size:11.5px;font-weight:700;color:#9AA0B4;text-transform:uppercase;letter-spacing:.06em;margin:18px 0 6px">${t}</h4>`;
  const st=it=>it.st==='done'?'<span style="color:#1E8A55">finished</span>':it.st==='awaiting'?'<span style="color:#C46E12">awaiting approval</span>':wmOverdue(it)?'<span style="color:#D63B41">overdue</span>':'<span style="color:#7A8095">pending</span>';
  openModal(`<div class="modal-head"><h3>${esc(m.kind||'Meeting')} · ${esc(wmFmt(m.meeting_date))}</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body" style="font-size:13.5px;line-height:1.55;max-height:68vh;overflow-y:auto">
    <div style="color:#6B7083">${m.start_time?esc(wmTime(m.start_time))+' · ':''}Host ${esc(wmHost(m))}${m.ran_minutes?' · ran '+m.ran_minutes+' min':''}${m.ended_at?' · ended '+esc(wmClock(m.ended_at)):''} · ${(m.attendees||[]).length} present · ${mine.length} task${mine.length===1?'':'s'}${drafts?' · '+drafts+' unassigned':''}</div>
    ${(m.attendees||[]).length?h('People')+`<div style="display:flex;flex-wrap:wrap;gap:6px">${(m.attendees||[]).map(n=>`<span class="people-chip">${avatar(n)} <span>${esc(n)}</span></span>`).join('')}</div>`:''}
    ${h('Tasks')}${keys.map(k=>`<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #F1F2F6">${wmAvatar(wmKeyName(k),28)}<div><b>${esc(wmKeyName(k))}</b>${mine.filter(it=>wmWhoKeys(it).includes(k)).map(it=>`<div style="color:#4A4F63">${esc(it.t)}${it.due?` <span style="color:#9AA0B4">· ${esc(wmFmtS(it.due))}</span>`:''} · ${st(it)}</div>`).join('')}</div></div>`).join('')||'<div style="color:#7A8095">No tasks were written in this meeting.</div>'}
    ${kp.length?h('KPIs')+`<div class="wm-kt-wrap"><table class="wm-kt wm-kr-t"><thead><tr><th>Person</th>${cols.map(c=>`<th>${esc(c.name)}</th>`).join('')}</tr></thead><tbody>${kp.map(p=>`<tr><td class="p">${esc(p)}</td>${cols.map(c=>`<td>${esc((vals[p]||{})[c.id]||'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:''}
    ${[['To-dos for the coming week',notes.filter(wmIsTd)],['Opportunities &amp; obstacles',notes.filter(n=>!wmIsTd(n))]].map(([t,l])=>l.length?h(t)+l.map(n=>`<div style="padding:5px 0;border-bottom:1px solid #F1F2F6"><b style="font-size:11.5px;color:${n.section==='obstacle'?'#C46E12':n.section==='opportunity'?'#1E8A55':'#5B4BE8'}">${esc(WM_SEC_H[n.section]||n.section)}</b> ${esc(n.body)} <span style="color:${n.solved?'#1E8A55':'#D63B41'};font-size:12px">· ${n.solved?(wmIsTd(n)?'done':'solved'):(wmIsTd(n)?'to do':'unsolved')}</span></div>`).join(''):'').join('')}
    ${an.length||(m.kpi_notes||'').trim()?h('Notes')+an.map(([k,v])=>`<div style="margin-bottom:8px"><b>${esc((wmAgMerge(m.agenda).find(a=>a.k===k)||{l:/^c_/.test(k)?'Notes of a step since removed':k}).l)}</b><div style="white-space:pre-wrap;color:#4A4F63">${esc(v)}</div></div>`).join('')+((m.kpi_notes||'').trim()?`<div><b>KPI notes</b><div style="white-space:pre-wrap;color:#4A4F63">${esc(m.kpi_notes)}</div></div>`:''):''}
  </div>
  <div class="modal-foot"><button class="btn" onclick="wmDownload(${id})"><i class="fa-solid fa-download"></i> Download</button><button class="btn btn-primary" onclick="closeModal();wmOpenMeeting(${id})">Open the meeting</button></div>`);
};

/* Reschedule: a new day and time. Its JainE calendar entry moves with it (database:
   ops_meeting_reschedule). One date of a repeating meeting moves alone. */
window.wmReschedule=function(id){
  const m=wmMeeting(id); if(!m||!wmCanEdit(id)) return;
  openModal(`<div class="modal-head"><h3>Reschedule ${esc(m.kind||'the meeting')}</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm"><div style="font-size:13px;color:var(--slate);margin-bottom:4px">Now: ${esc(wmWhen(m))}</div>
    <div class="wm-three" style="grid-template-columns:1fr 1fr"><div><label>New date</label><input type="date" id="wmRsDate" min="${wmToday()}" value="${esc(String(m.meeting_date).slice(0,10))}"></div><div><label>New time</label><input type="time" id="wmRsTime" value="${esc(wmTime(m.start_time))}"></div></div>
    <div class="wm-fp-help" style="margin-top:10px">${m.series_id&&m.series_active?'Only this date moves; the other dates of this repeating meeting stay as they are.':m.acc_meeting_id?"It moves in everyone's JainE calendar too.":'This meeting has no calendar entry, so only this page changes.'}</div></div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="wmRsGo" onclick="wmRescheduleSave(${id})"><i class="fa-regular fa-calendar"></i> Reschedule</button></div>`);
};
window.wmRescheduleSave=async function(id){
  const d=$('wmRsDate').value, t=$('wmRsTime').value||null;
  if(!d){ toast('Choose a date','err'); return; }
  if(d<wmToday()){ toast('Choose today or a later day','err'); return; }
  const b=$('wmRsGo'); b.disabled=true; b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
  try{ const {error}=await sb.rpc('ops_meeting_reschedule',{p_meeting:id,p_date:d,p_time:t}); if(error) throw error;
    await wmReloadMeetings(); closeModal(); toast('Moved to '+wmFmt(d)+(t?', '+t:''),'ok'); wmRender(); }
  catch(e){ b.disabled=false; b.innerHTML='<i class="fa-regular fa-calendar"></i> Reschedule'; wmErr('Could not reschedule',e); }
};

/* ---------- a meeting ---------- */
window.wmOpenMeeting=function(id){ if(WM.view!=='board') WM.from=WM.view; WM.view='board'; WM.cur=id;
  WM.tab='pending'; WM.q=''; WM.who=''; WM.showPpl=false; WM.wtab=null; WM.picked={mem:[],due:null,recur:'none'}; wmRender(); window.scrollTo({top:0,behavior:'smooth'}); };
// Older code repaints "the meeting" through this name; it is the meeting page now.
function wmPaintMeeting(){ if(WM.view==='board') wmPaintBoard(); else wmRender(); }

/* ---------- THE MEETING PAGE (design C, 18 Nov 2026; inside JainE-Meetings since 24 Nov) ----------
   * a top line: back to where you came from, four counters for this meeting's kind;
   * a meeting strip: when, the kind, who is present, how it repeats, earlier meetings, Reschedule,
     the meeting clock and End meeting; under it the agenda as eight step chips with the timer
     controls, and the open step's notes below the chips;
   * then, all visible at once: Action Taken on the left (the action line, unassigned lines, and
     Pending / All Tasks / Finished), KPI and Opportunities & Obstacles stacked on the right. */
function wmRenderBoard(){
  const v=$('wmView'); if(!v) return;
  v.innerHTML=`${WM.ro?'<div class="wm-ronote"><i class="fa-solid fa-eye"></i> You can see the meetings you are in. Only the person who started a meeting (or someone they made an editor) can change it.</div>':''}
  <div id="wmMain"></div>`;
  wmPaintBoard(); wmPaintBoardStats();
}
// Back to the view the meeting was opened from.
window.wmHome=function(){ WM.view=WM.from&&WM.from!=='board'?WM.from:'dash'; WM.tab='pending'; WM.showPpl=false; wmRender(); window.scrollTo({top:0,behavior:'smooth'}); };
// Jumping to a panel (from an agenda step) opens it if it was folded.
window.wmGoPanel=function(id){ const c=$(id); if(!c) return;
  { const tk={wmKpiCard:'kpi',wmTdCard:'td',wmOoCard:'oo'}[id]; if(tk&&$('wmWs')){ wmWTab(tk); return; } } const k={wmKpiCard:'kpi',wmTdCard:'td',wmOoCard:'oo'}[id]; if(k&&wmFolded(k)) wmFold(k,id); c.scrollIntoView({behavior:'smooth',block:'start'}); };
/* The KPI, To-dos and Opportunities & Obstacles panels fold to their header (with a count), so the
   panel being discussed has the room. Which are folded is remembered on this computer. */
function wmFoldState(){ try{ return JSON.parse(localStorage.getItem('wm_fold')||'{}')||{}; }catch(e){ return {}; } }
function wmFolded(k){ return wmFoldState()[k]===true; }
window.wmFold=function(k,id){
  const s=wmFoldState(); s[k]=!s[k]; try{ localStorage.setItem('wm_fold',JSON.stringify(s)); }catch(e){}
  const c=$(id); if(!c) return; c.classList.toggle('folded',!!s[k]);
  const b=c.querySelector('.wm-fold'); if(b){ b.setAttribute('aria-expanded',String(!s[k])); const i=b.querySelector('i'); if(i) i.className='fa-solid fa-chevron-'+(s[k]?'down':'up'); }
};
function wmCardHead(k,id,icon,title,meta){
  const f=wmFolded(k);
  return `<div class="wm-bd-h wm-fh" onclick="if(!event.target.closest('input,select,textarea,a'))wmFold('${k}','${id}')"><span><i class="fa-solid ${icon}"></i> ${title}</span>
    <span class="wm-fh-r">${meta||''}<button class="wm-fold" type="button" aria-expanded="${!f}" title="Fold or open this panel"><i class="fa-solid fa-chevron-${f?'down':'up'}"></i></button></span></div>`;
}
// Four counters for every meeting of this kind.
function wmPaintBoardStats(){
  const host=$('wmBdStats'), m=wmMeeting(WM.cur); if(!host||!m) return;
  const kind=WM.items.filter(it=>it.kind===m.kind&&!it.draft), pend=kind.filter(wmOpen);
  const obs=wmNotesFor(m,'obstacle').filter(n=>!n.solved).length;
  const c=(n,l,cls)=>`<div><b class="${cls}">${n}</b><span>${l}</span></div>`;
  const aw=kind.filter(it=>it.st==='awaiting').length, od=kind.filter(wmOverdue).length; void obs;
  host.innerHTML=c(pend.length,'pending','')+(aw?c(aw,'to approve','a'):'')+(od?c(od,'overdue','r'):'');
  host.title='Every '+(m.kind||'')+' meeting, all dates';
}
function wmPaintBoard(){
  clearInterval(WM.timer);
  const main=$('wmMain'); if(!main) return;
  const m=wmMeeting(WM.cur);
  if(!m){ main.innerHTML=`<div class="wm-card"><div class="wm-card-top"><h2>No meeting yet</h2></div></div>`; return; }
  const today=wmToday(), series=wmSeries(m.kind), first=series.length?series[series.length-1].meeting_date:m.meeting_date;
  const isToday=m.meeting_date===today, att=m.attendees||[], ended=!!m.ended_at;
  const started=(function(){ try{ return Number(localStorage.getItem('wm_start_'+m.id))||0; }catch(e){ return 0; } })();
  // The header's parts: where Back goes, the status tag, and the More menu (rights, repeats, Reschedule,
  // earlier meetings, Stop repeating) - kept out of sight until wanted.
  const backL={up:'Upcoming',run:'Running',hist:'History',all:'Tasks'}[WM.from]||'Dashboard';
  const runningNow=isToday&&!ended&&(started||m.agenda_run);
  const when=(m.meeting_date===today?'Today':wmFmtS(m.meeting_date))+(m.start_time?' · '+wmTime(m.start_time):'');
  const stag=ended?`<span class="wm-stag ok"><i class="fa-solid fa-circle-check"></i> Ended ${esc(wmClock(m.ended_at))}${m.ran_minutes?' · ran '+m.ran_minutes+' min':''}</span>${wmCanEdit(m.id)&&!WM.ro?'<button class="wm-quiet wm-reopen" onclick="wmReopen()">Reopen</button>':''}`
    :runningNow?`<span class="wm-stag live"><i class="dot"></i> Live${m.start_time?' · '+esc(wmTime(m.start_time)):''}</span>`
    :m.meeting_date>=today?`<span class="wm-stag up">${esc(m.meeting_date===today?when:'Coming up · '+when)}</span>`:`<span class="wm-stag">${esc('Held · '+when)}</span>`;
  const recurW=m.series_id&&m.recur?(m.series_active?wmRecurWords(m.recur,(wmSeries(m.kind).filter(x=>x.series_id===m.series_id).pop()||m).meeting_date,m.start_time):'Stopped repeating'):'';
  const canStop=m.series_id&&m.series_active&&(wmIsStarterOrEditor(m)||WS_OWNERS.includes(String(state.email||'').toLowerCase()));
  const canRs=!ended&&m.meeting_date>=today&&wmCanEdit(m.id)&&!WM.ro;
  const others=series.filter(x=>x.id!==m.id).slice(0,8);
  const moreInfo=[m.created_by?'Started by <b>'+esc(wmName(m.created_by))+'</b>'+((m.editors||[]).length?' · Editor'+((m.editors||[]).length>1?'s':'')+': <b>'+esc((m.editors||[]).map(wmName).join(', '))+'</b>':''):'From the minutes sheet',
    recurW?'<i class="fa-solid fa-repeat"></i> '+esc(recurW):'', series.length+' meeting'+(series.length===1?'':'s')+' of this kind since '+esc(wmFmtS(first)), m.note?esc(m.note):''].filter(Boolean).join('<br>');
  main.innerHTML=`<div class="wm-card wm-in wm-bd-strip">
    <div class="wm-bd-head wm-hd2">
      <div class="wm-bd-hl">
        <div class="wm-t1">
          <button class="wm-backb" onclick="wmHome()" title="Back to ${esc(backL)}" aria-label="Back to ${esc(backL)}"><i class="fa-solid fa-arrow-left"></i></button>
          <h2>${esc(m.kind||'Meeting')}</h2>${stag}${recurW&&m.series_active?`<span class="wm-reptag" title="${esc(recurW)}" aria-label="${esc(recurW)}"><i class="fa-solid fa-repeat"></i></span>`:''}
        </div>
        ${wmCanEdit(m.id)?'':`<div class="wm-viewonly wm-t2"><i class="fa-solid fa-eye"></i> View only</div>`}
        <div class="wm-mh2 wm-t2">
          <div class="wm-dd" id="wmPpl">${wmPplHtml(att)}</div>
          <div class="wm-more" id="wmMore"><button class="wm-quiet" onclick="wmMoreToggle(event)" aria-haspopup="true" aria-expanded="false"><i class="fa-solid fa-ellipsis"></i> More</button>
            <div class="wm-more-panel" style="display:none">
              <div class="wm-more-info">${moreInfo}</div>
              ${canRs?`<button class="it" onclick="wmMoreToggle();wmReschedule(${m.id})"><i class="fa-regular fa-calendar"></i> Reschedule</button>`:''}
              ${others.length?`<div class="wm-more-h">Earlier and later ${esc(m.kind||'')} meetings</div>`+others.map(x=>`<button class="it" onclick="wmOpenMeeting(${x.id})"><i class="fa-regular fa-calendar-check"></i> ${esc(x.meeting_date===today?'Today':wmFmt(x.meeting_date))}${x.start_time?', '+esc(wmTime(x.start_time)):''}</button>`).join(''):''}
              ${canStop?`<button class="it danger" onclick="wmMoreToggle();wmSeriesStop(${m.series_id})"><i class="fa-solid fa-ban"></i> Stop repeating</button>`:''}
            </div></div>
        </div>
      </div>
      ${isToday&&!ended?`<div class="wm-mh-r">${started?`<div class="wm-clock" title="Meeting running since ${esc(wmClock(started))}"><i class="fa-regular fa-clock"></i><b id="wmTimer">0m 00s</b></div>`:''}<button class="wm-btn wm-red" onclick="wmEndMeeting()">End meeting</button></div>`:''}
    </div>
    ${m.agenda?'<div class="wm-ag wm-bd-ag" id="wmAg"></div>':`<div class="wm-addsec" style="margin:0 22px 16px"><button class="wm-quiet" onclick="wmAgAdd()"><i class="fa-solid fa-stopwatch"></i> Run this meeting on the timed agenda</button></div>`}
  </div>
  <div class="wm-card wm-bd-ws" id="wmWs">
    <div class="wm-cap wm-ws-cap">
      <div class="wm-cap-in"><i class="fa-solid fa-plus wm-cap-ic"></i><input id="wmSmart" autocomplete="off" placeholder="Add an action - @person, a date - then Enter…" oninput="wmParse()" onkeydown="wmKey(event)"><span class="kbd">Enter ↵</span></div>
      <div class="wm-parsed" id="wmParsed"></div>
      <div class="wm-sugg" id="wmSugg" style="display:none"></div>
    </div>
    <div class="wm-wtabs" role="tablist" id="wmWTabs"></div>
    <div class="wm-wpane" data-p="act"><div class="wm-bd-in"><div id="wmDrafts"></div><div class="wm-v6" id="wmTasks"></div></div></div>
    <div class="wm-wpane wm-bd-col" data-p="kpi" id="wmKpiCard"></div>
    <div class="wm-wpane wm-bd-col" data-p="td" id="wmTdCard"></div>
    <div class="wm-wpane wm-bd-col" data-p="oo" id="wmOoCard"></div>
  </div>`;
  if(!WM.wtab){ const s0=m.agenda?wmAgState(m):null; WM.wtab=s0&&s0.run&&!s0.done&&!s0.finished&&s0.items[s0.i]?wmTabOf(s0.items[s0.i].k):'act'; }
  wmRepaintKpi(); wmRepaintTd(); wmRepaintOo(); wmParse(); wmPaintDrafts(); wmPaintTabs(); wmPaintWTabs();
  if(m.agenda) wmPaintAgenda(true);
  if(isToday&&started&&!ended){
    const tick=()=>{ const t=$('wmTimer'); if(!t) return; const x=Math.max(0,Math.floor((Date.now()-started)/1000)), hh=Math.floor(x/3600), mm=Math.floor(x%3600/60), ss=x%60;
      t.textContent=hh?hh+'h '+String(mm).padStart(2,'0')+'m':mm+'m '+String(ss).padStart(2,'0')+'s';
      const n=$('wmNow'); if(n) n.textContent=wmClock(Date.now()); };
    tick(); WM.timer=setInterval(tick,1000);
  }
}
// The agenda as eight step chips: done ones ticked, the running one red with its countdown and bar,
// the minutes of the others editable. The open step (big countdown, its notes) sits under the chips.
const WM_AG_SHORT={wins:'Wins',core:'Core values',goal:'#1 goal',prio:'Priorities',kpi:'KPIs',events:'Upcoming events',todos:'To-dos',oo:'Opportunities & obstacles'};
// The agenda on the meeting page (refined 24 Nov): one "Now" bar - the step, one big countdown, a bar,
// what comes next, when it ends, the timer buttons and Edit agenda - and under it a single row of slim
// step pills. Minutes, order and steps of your own are changed in Edit agenda, not on the pills.
// The agenda on the meeting page (cleaned up 24 Nov): the Now area - the step, one big countdown, what
// comes next, when it ends, the timer buttons and Edit agenda - and under it one thin bar with a segment
// per step, as wide as its minutes: done green, the running one filling red, the rest grey. Hovering a
// segment names the step; clicking it opens that step (its notes, or its KPIs / To-dos / O&O tab).
function wmPaintAgChips(host,s,curK,ctl,tot){
  const m=wmMeeting(WM.cur), canEd=!!m&&wmCanEdit(m.id)&&!WM.ro&&!m.ended_at, nowMin=Math.floor(wmNowSec()/60);
  const cur=curK?s.items[s.i]:null, nxt=cur?s.items[s.i+1]:(!s.run?s.items[0]:null);
  let ends='';
  if(cur){ const rem=Math.ceil(s.left/60)+s.items.slice(s.i+1).reduce((a,x)=>a+x.mins,0); ends='ends about '+wmHHMM(nowMin+rem); }
  else if(!s.run&&m&&m.start_time) ends=wmTime(m.start_time)+' – '+wmHHMM(wmMin(m.start_time)+tot);
  const edit=canEd?`<button class="wm-agedit" onclick="wmAgEdit()" title="Minutes, order, steps of your own"><i class="fa-solid fa-sliders"></i> Edit agenda</button>`:'';
  const pc=cur?Math.min(100,100-(s.left/(cur.mins*60))*100):0;
  const bar=cur?`<div class="wm-agnow ${s.run.paused?'paused':''}">
      <div class="l"><span class="k">${s.run.paused?'Paused':'<i class="dot"></i>Now'} · step ${s.i+1} of ${s.items.length}</span><b>${esc(cur.l)}</b>
        <span class="sub">${nxt?'Next: '+esc(nxt.l)+' · ':'Last step · '}${esc(ends)}</span></div>
      <b class="cd" id="wmAgBig">${wmMMSS(s.left)}</b>
      <div class="wm-ag-ctl">${ctl}${edit}</div></div>`
    :`<div class="wm-agnow idle"><div class="l"><span class="k"><i class="fa-solid fa-stopwatch"></i> ${s.done||s.finished?'Agenda finished':'Agenda'}</span><b>${s.items.length} step${s.items.length===1?'':'s'} · ${tot} min</b>${ends?`<span class="sub">${esc(ends)}</span>`:''}</div>
      <div class="wm-ag-ctl">${ctl}${edit}</div></div>`;
  host.innerHTML=bar+`<div class="wm-agseg ${cur&&s.run.paused?'paused':''}" role="list" aria-label="Agenda steps">${s.items.map((x,j)=>{ const past=s.run&&(s.done||s.finished||j<s.i), now=x.k===curK, lab=(j+1)+'. '+x.l+' · '+x.mins+' min'+(now?' · now':past?' · done':'');
      return `<button role="listitem" class="seg ${now?'n':''} ${past?'d':''} ${WM.agView===x.k&&!now?'v':''}" style="flex:${Math.max(1,x.mins)} 1 0" onclick="wmAgView('${x.k}')" title="${esc(lab)}" aria-label="${esc(lab)}">${now?`<i id="wmAgBigBar" style="width:${pc}%"></i>`:''}</button>`; }).join('')}</div>
    <div class="wm-ag-panel wm-bd-panel" id="wmAgPanel"></div>`;
}
// The KPI and Opportunities & Obstacles panels, redrawn after their own changes.
function wmRepaintKpi(){
  const m=wmMeeting(WM.cur); if(!m) return;
  if(WM.view==='board'){ const c=$('wmKpiCard'); if(c){ const prev=wmKpiPrev(m), nc=(m.kpi_cols||[]).length;
    c.innerHTML=wmCardHead('kpi','wmKpiCard','fa-chart-line','KPIs · '+esc(wmFmtS(m.meeting_date)),`<span class="wm-kpi-state" id="wmKpiState"></span><span class="wm-fh-n">${nc} column${nc===1?'':'s'}</span>`)
      +`<div class="wm-bd-in">${wmKpiTableHtml(m)}${prev?`<div class="wm-kpi-grey">Small grey figures are from the last meeting, ${esc(wmFmtS(prev.meeting_date))}.</div>`:''}
      <div class="wm-sec" style="margin-top:14px"><span>KPI notes</span><span class="r wm-mute wm-nst" id="wmKpiSt"></span></div>
      <textarea class="wm-ag-ta" id="wmKpiTxt" placeholder="Anything behind the numbers…" oninput="wmKpiInput(this)" onblur="wmKpiSave(this)">${esc(m.kpi_notes||'')}</textarea>${wmKpiReviewHtml(m)}</div>`;
    c.classList.toggle('folded',wmFolded('kpi')); } }
  else if($('wmAgPanel')) wmPaintAgPanel(wmAgState(m));
  wmCounts();
}
function wmRepaintOo(focusSec){
  const m=wmMeeting(WM.cur); if(!m) return;
  if(WM.view==='board'){ const c=$('wmOoCard'); if(c){ const open=['opportunity','obstacle'].flatMap(s=>wmNotesFor(m,s)).filter(n=>!n.solved).length;
    c.innerHTML=wmCardHead('oo','wmOoCard','fa-scale-balanced','Opportunities &amp; Obstacles',`<span class="wm-fh-n">${open} open</span>`)+`<div class="wm-bd-in">${wmOoTabHtml(m)}</div>`; c.classList.toggle('folded',wmFolded('oo')); } }
  else { const c=$('wmOoHost'); if(c) c.innerHTML=wmOoHtml(m); }
  wmCounts();
  if(focusSec){ const i=$('wmNtAdd_'+focusSec); if(i) i.focus(); }
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
  host.innerHTML=`<div class="wm-fp-chips">${[...picked].map(e=>{ const ed=WM.formEd.has(e);
      return `<span class="people-chip wm-fp-chip ${ed?'ed':''}">${wmAvatar(wmName(e),20)} <span>${esc(wmName(e))}</span><button type="button" class="wm-fp-ed" title="${ed?'Editor: same rights as you in this meeting - click to make view only':'View only - click to make them an editor with the same rights as you'}" onclick="WM.formEd.${ed?'delete':'add'}('${esc(e)}');wmFormPeople()"><i class="fa-solid fa-${ed?'user-pen':'eye'}"></i> ${ed?'Editor':'View only'}</button><i class="fa-solid fa-xmark" style="cursor:pointer;margin-left:2px;color:#94a3b8" onclick="WM.formPpl.delete('${esc(e)}');WM.formEd.delete('${esc(e)}');wmFormPeople()"></i></span>`; }).join('')||'<span class="wm-fp-none">Nobody picked yet</span>'}</div>
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
  WM.formPpl=new Set(sel==='__new'?[]:wmLastPeople(sel));
  // Editors carry over from the last meeting of this kind, for the people still picked.
  const lastEd=sel==='__new'?null:(WM.meetings||[]).find(m=>m.kind===sel&&(m.editors||[]).length);
  WM.formEd=new Set(((lastEd&&lastEd.editors)||[]).filter(e=>WM.formPpl.has(e))); wmFormPeople();
  // The agenda starts as the last meeting of this kind ran it, else the standard one.
  const last=sel==='__new'?null:(WM.meetings||[]).find(m=>m.kind===sel&&m.agenda&&m.agenda.items);
  WM.formAg=wmAgMerge(last?last.agenda:null).map(x=>Object.assign({},x)); wmFormAgenda();
};
function wmFormAgenda(){
  const host=$('wmAgForm'); if(!host) return;
  const on=WM.formAg.filter(x=>x.on), tot=on.reduce((s,x)=>s+(Number(x.mins)||0),0);
  const t=WM.agEditing?'':($('wmTime')?$('wmTime').value:wmNowTime()), ends=t&&tot?' · ends about '+wmHHMM(wmMin(t)+tot):'';
  const keep=document.activeElement&&document.activeElement.id==='wmAgNewName';
  host.innerHTML=WM.formAg.map((x,i)=>
    // Plain rows rather than form fields: JainE's form styles stretch every input to full width.
    `<div class="wm-agf-row ${x.on?'on':'off'} ${x.custom?'own':''}" role="checkbox" aria-checked="${x.on}" tabindex="0" onclick="WM.formAg[${i}].on=!WM.formAg[${i}].on;wmFormAgenda()" onkeydown="if(event.target===this&&(event.key===' '||event.key==='Enter')){event.preventDefault();this.click()}">
      <span class="ck"><i class="fa-solid fa-check"></i></span>
      <span class="ic"><i class="fa-solid ${x.i}"></i></span>
      <span class="nm">${x.custom?`<input class="wm-agf-nm" value="${esc(x.l)}" maxlength="60" title="Rename this step" onclick="event.stopPropagation()" onkeydown="event.stopPropagation()" onchange="wmFormAgName(${i},this.value)">`:esc(x.l)}${x.n?'<em>Notes</em>':''}</span>
      <span class="mv" onclick="event.stopPropagation()"><button type="button" tabindex="-1" title="Move up" onclick="wmFormAgMove(${i},-1)" ${i?'':'disabled'}><i class="fa-solid fa-arrow-up"></i></button><button type="button" tabindex="-1" title="Move down" onclick="wmFormAgMove(${i},1)" ${i<WM.formAg.length-1?'':'disabled'}><i class="fa-solid fa-arrow-down"></i></button>${x.custom?`<button type="button" tabindex="-1" class="del" title="Remove this step" onclick="wmFormAgDel(${i})"><i class="fa-solid fa-trash-can"></i></button>`:'<span class="sp"></span>'}</span>
      <span class="mn" onclick="event.stopPropagation()"><button type="button" tabindex="-1" onclick="wmFormAgMins(${i},-1)" ${x.on?'':'disabled'}>−</button><input type="number" min="1" max="180" value="${x.mins}" ${x.on?'':'disabled'} onchange="wmFormAgMins(${i},0,this.value)"><button type="button" tabindex="-1" onclick="wmFormAgMins(${i},1)" ${x.on?'':'disabled'}>+</button><small>min</small></span>
    </div>`).join('')
    +`<div class="wm-agf-add"><i class="fa-solid fa-plus"></i><input id="wmAgNewName" maxlength="60" placeholder="Add your own step, e.g. Site safety review" onkeydown="if(event.key==='Enter'){event.preventDefault();wmFormAgNew()}"><input id="wmAgNewMins" type="number" min="1" max="180" value="5" title="Minutes" onkeydown="if(event.key==='Enter'){event.preventDefault();wmFormAgNew()}"><small>min</small><button type="button" class="wm-agf-addbtn" onclick="wmFormAgNew()">Add step</button></div>`
    +`<div class="wm-agf-tot">${on.length?`<span>${on.length} of ${WM.formAg.length} steps${esc(ends)}</span><b>${tot} min</b>`:'<span>No agenda — the meeting runs without the timer</span>'}</div>`;
  if(keep){ const n=$('wmAgNewName'); if(n) n.focus(); }
}
window.wmFormAgMove=function(i,d){ const a=WM.formAg, j=i+d; if(j<0||j>=a.length) return; const x=a[i]; a[i]=a[j]; a[j]=x; wmFormAgenda(); };
window.wmFormAgDel=function(i){ WM.formAg.splice(i,1); wmFormAgenda(); };
window.wmFormAgName=function(i,v){ const x=WM.formAg[i], l=String(v||'').trim(); if(x&&x.custom&&l) x.l=l.slice(0,60); };
// A new step goes before Opportunities & obstacles (the long closing discussion); the arrows move it.
window.wmFormAgNew=function(){
  const n=$('wmAgNewName'), mm=$('wmAgNewMins'), l=String(n.value||'').trim();
  if(!l){ toast('Give the step a name','err'); n.focus(); return; }
  const step=wmAgCustom({k:wmAgKey(),l,mins:mm.value,on:true}), at=WM.formAg.findIndex(x=>x.k==='oo');
  if(at<0) WM.formAg.push(step); else WM.formAg.splice(at,0,step);
  wmFormAgenda(); const n2=$('wmAgNewName'); if(n2){ n2.value=''; n2.focus(); }
};
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
      <div class="wm-recur-hint" id="wmRecurHint"></div>`
    // Started now: today, at the current time - only how often it repeats is asked.
    :`<label>Repeats</label><select id="wmRecur" onchange="wmFormRecur()"><option value="none">Once</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select>
      <div class="wm-recur-hint" id="wmRecurHint"></div>`}
    <label>People in this meeting <span style="font-weight:400;color:var(--slate)">— it goes into their JainE calendar and yours</span></label>
    <div class="wm-fp" id="wmFormPpl"></div>
    <div class="wm-fp-help">Everyone picked can see this meeting. Click <b>View only</b> on a person to make them an <b>Editor</b>: an editor has the same rights as you - change the meeting, run the agenda, end it, give tasks (to themselves too), and edit the to-dos.</div>
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
  wmFormAgenda();   // the agenda's end time follows the time picked
  const r=$('wmRecur'), h=$('wmRecurHint'); if(!r||!h) return;
  const date=$('wmDate')?$('wmDate').value:wmToday(), rep=r.value!=='none';
  if($('wmDateLbl')) $('wmDateLbl').textContent=rep?'First meeting':'Date';
  h.innerHTML=rep&&date?`<i class="fa-solid fa-repeat"></i> ${esc(wmRecurWords(r.value,date,$('wmTime')?$('wmTime').value:wmNowTime()))}, starting ${esc(wmFmt(date))} — ${/quarterly|yearly/.test(r.value)?"each date goes into everyone's calendar, with an invite, two weeks before":"in everyone's calendar on each date"}`:'';
};
window.wmStartMeeting=function(){ wmMeetingForm('start'); };
window.wmScheduleMeeting=function(){ wmMeetingForm('schedule'); };
window.wmMeetingSave=async function(mode){
  const later=mode==='schedule', sel=$('wmKind').value, kind=sel==='__new'?($('wmKindNew').value||'').trim():sel;
  const date=later?($('wmDate').value||''):wmToday(), time=later?($('wmTime').value||null):(wmNowTime()||null);
  const emails=[...(WM.formPpl||[])], ag=(WM.formAg||[]).some(x=>x.on)?{items:wmAgSer(WM.formAg)}:null;
  const on=k=>!!ag&&ag.items.some(x=>x.k===k&&x.on), kpi=on('kpi'), oo=on('oo');
  // Started now: the timer starts with it, on the first step.
  const run=ag&&!later?{k:ag.items.find(x=>x.on).k,at:Date.now(),paused:false}:null;
  const recur=$('wmRecur')?$('wmRecur').value:'none';
  if(!kind){ toast('Choose which meeting this is','err'); return; }
  if(!date){ toast('Choose a date','err'); return; }
  if(later&&date<wmToday()){ toast('Choose today or a later day','err'); return; }
  if(!emails.length){ toast('Add at least one person to this meeting','err'); return; }
  const b=$('wmStartBtn'); b.disabled=true;
  try{
    const {data,error}=await sb.rpc('ops_meeting_create',{p_kind:kind,p_date:date,p_time:time,p_people:emails,p_names:emails.map(wmName),p_kpi:kpi,p_oo:oo,p_agenda:ag,p_run:run,p_recur:recur}); if(error) throw error;
    if(!later){ try{ localStorage.setItem('wm_start_'+data,String(Date.now())); }catch(e){} }
    // The people marked Can edit may change this meeting as well as its starter.
    const eds=[...(WM.formEd||[])].filter(e=>WM.formPpl.has(e));
    if(eds.length){ const r=await sb.rpc('ops_meeting_set_editors',{p_meeting:data,p_editors:eds}); if(r.error) toast('Meeting saved, but the editors were not: '+r.error.message,'warn'); }
    try{ usageQueue('tasks.meetings.schedule_a_meeting_one_time_or_recurring','create',{title:kind,attendees:emails.length+(emails.length===1?' person':' people')}); }catch(_e){}
    await wmReloadMeetings(); closeModal();
    toast((recur!=='none'?'Scheduled: '+wmRecurWords(recur,date,time):later?'Scheduled for '+wmFmt(date)+(time?', '+wmTime(time):''):'Meeting started')+' · in '+(emails.length+1)+' calendars','ok');
    wmOpenMeeting(Number(data));
  }catch(e){ b.disabled=false; wmErr('Could not '+(later?'schedule':'start')+' the meeting',e); }
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
    }catch(e){ wmErr('Could not stop it',e); }
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
  catch(e){ if(st) st.textContent=''; wmErr('Could not save the KPI notes',e); }
};
/* Obstacles & Opportunities: two notes boxes, each saved on its own as you pause and when you leave it. */
window.wmNoteInput=function(f,el){ WM.noteT=WM.noteT||{}; clearTimeout(WM.noteT[f]); WM.noteT[f]=setTimeout(()=>wmNoteSave(f,el),900); };
window.wmNoteSave=async function(f,el){
  if(WM.noteT) clearTimeout(WM.noteT[f]);
  const m=wmMeeting(WM.cur); if(!m||!el) return;
  const v=el.value; if((m[f]||'')===v) return;
  const st=$('wmSt_'+f); if(st) st.textContent='Saving…';
  try{ const {error}=await sb.rpc('ops_meeting_set_note',{p_meeting:m.id,p_field:f,p_value:v}); if(error) throw error; m[f]=v; if(st) st.textContent='Saved'; }
  catch(e){ if(st) st.textContent=''; wmErr('Could not save the '+f,e); }
};
window.wmOoAdd=async function(){
  const m=wmMeeting(WM.cur); if(!m) return;
  try{ const {error}=await sb.rpc('ops_meeting_set_oo',{p_meeting:m.id,p_on:true}); if(error) throw error; m.has_oo=true; wmPaintMeeting(); const t=$('wmNote_obstacles'); if(t) t.focus(); }
  catch(e){ wmErr('Could not add the section',e); }
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
  {k:'todos', l:'To-dos',                       mins:5, i:'fa-list-check', n:'td'},
  {k:'oo',    l:'Opportunities & obstacles',    mins:30,i:'fa-scale-balanced', n:'oo'}];
// The agenda as saved: its steps in their saved order (they can be moved), each standard step with its
// minutes, plus the meeting's own steps (key c_<id>, their own name, notes like Upcoming events). A
// standard step missing from an older agenda is added at the end, switched off.
function wmAgCustom(s){ return {k:s.k,l:String(s.l||'Step').slice(0,60),mins:Math.max(1,Math.min(180,Number(s.mins)||5)),on:s.on!==false,i:'fa-circle-dot',n:'notes',ph:'Notes for this step…',custom:true}; }
function wmAgMerge(agenda){
  const saved=(agenda&&agenda.items)||[];
  if(!saved.length) return WM_AGENDA.map(d=>Object.assign({},d,{on:!agenda}));
  const out=[];
  saved.forEach(s=>{ if(!s) return; const d=WM_AGENDA.find(x=>x.k===s.k);
    if(d) out.push(Object.assign({},d,{mins:Number(s.mins)||d.mins,on:s.on!==false}));
    else if(s.l&&/^c_[a-z0-9]{1,20}$/.test(String(s.k))) out.push(wmAgCustom(s)); });
  WM_AGENDA.forEach(d=>{ if(!out.some(x=>x.k===d.k)) out.push(Object.assign({},d,{on:false})); });
  return out;
}
// What is saved: key, minutes, on - and the name of an own step.
const wmAgSer=list=>list.map(x=>x.custom?{k:x.k,l:x.l,mins:x.mins,on:x.on}:{k:x.k,mins:x.mins,on:x.on});
const wmAgKey=()=>'c_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
const wmHHMM=mn=>{ mn=((Math.round(mn)%1440)+1440)%1440; return String(Math.floor(mn/60)).padStart(2,'0')+':'+String(mn%60).padStart(2,'0'); };
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
  if(!wmCanEdit(m.id)) return;   // someone reading the meeting follows the timer; only an editor moves it
  if(WM.ro) return;
  try{ const {error}=await sb.rpc('ops_meeting_set_run',{p_meeting:m.id,p_run:run}); if(error) throw error; }
  catch(e){ wmErr('Could not save the timer',e); }
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
  if(WM.view==='board'){ wmPaintAgChips(host,s,curK,ctl,tot); wmPaintAgPanel(s); if(s.moved||s.finished) wmAgAdvanced(m,s); if(s.run&&!s.run.paused&&!s.done&&!s.finished) WM.agTimer=setInterval(wmAgTick,1000); return; }
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
  if(!s.finished) wmWTabFor(run.k);
}
function wmPaintAgPanel(s){
  const p=$('wmAgPanel'), m=wmMeeting(WM.cur); if(!p||!m) return;
  const x=s.items.find(i=>i.k===WM.agView); if(!x){ p.innerHTML=''; return; }
  // Meeting page: only a step that keeps notes opens a box under the chips; the countdown is in the chip row.
  if(WM.view==='board'){
    p.innerHTML=x.n==='notes'?`<div class="wm-bd-note"><div class="wm-sec"><span>${esc(x.l)} · notes</span><span class="r wm-mute wm-nst" id="wmSt_${x.k}"></span></div><textarea class="wm-ag-ta" id="wmAgNote_${x.k}" placeholder="${esc(x.ph||'')}" oninput="wmAgNoteInput('${x.k}',this)" onblur="wmAgNoteSave('${x.k}',this)">${esc((m.agenda_notes||{})[x.k]||'')}</textarea></div>`:'';
    return;
  }
  const running=s.run&&!s.done&&!s.finished&&s.items[s.i].k===x.k;
  const head=`<div class="wm-ag-ph"><div><div class="wm-eyebrow">${running?'<span class="wm-live">Now</span>':s.run&&!s.done&&!s.finished&&s.items.findIndex(i=>i.k===x.k)<s.i||s.done||s.finished?'Done':'Coming up'} · ${x.mins} min</div><h3><i class="fa-solid ${x.i}"></i> ${esc(x.l)}</h3></div>
</div>
    ${running?`<div class="wm-ag-bigw ${s.run.paused?'paused':''}"><div class="wm-ag-big" id="wmAgBig">${wmMMSS(s.left)}</div>
      <div class="wm-ag-bigr"><span>${s.run.paused?'Paused':'left'} of ${x.mins} min</span><div class="wm-ag-bigbar"><span id="wmAgBigBar" style="width:${Math.min(100,100-(s.left/(x.mins*60))*100)}%"></span></div></div></div>`:''}
    ${!running&&s.run&&!s.done&&!s.finished?`<button class="wm-quiet" style="margin:-4px 0 10px" onclick="wmAgView('${esc(s.items[s.i].k)}')"><i class="fa-solid fa-arrow-left"></i> Back to the step the timer is on</button>`:''}`;
  let body='';
  // On the meeting page KPIs and Opportunities & Obstacles have their own panels; their steps point there.
  if(x.n==='kpi'&&WM.view==='board') body=`<div class="wm-ag-go"><span>The KPI table, last meeting's figures and the KPI notes are in the <b>KPI</b> panel.</span><button class="wm-btn wm-sm wm-light" onclick="wmGoPanel('wmKpiCard')"><i class="fa-solid fa-chart-line"></i> Go to KPI</button></div>`;
  else if(x.n==='kpi') body=wmKpiTableHtml(m)+wmKpiReviewHtml(m)+`<div class="wm-sec" style="margin-top:16px"><span>KPI notes</span><span class="r wm-mute wm-nst" id="wmKpiSt"></span></div>
      <textarea class="wm-ag-ta" id="wmKpiTxt" placeholder="Anything behind the numbers…" oninput="wmKpiInput(this)" onblur="wmKpiSave(this)">${esc(m.kpi_notes||'')}</textarea>`;
  else if(x.n==='notes') body=`<div class="wm-sec"><span>Notes</span><span class="r wm-mute wm-nst" id="wmSt_${x.k}"></span></div>
      <textarea class="wm-ag-ta" id="wmAgNote_${x.k}" placeholder="${esc(x.ph||'')}" oninput="wmAgNoteInput('${x.k}',this)" onblur="wmAgNoteSave('${x.k}',this)">${esc((m.agenda_notes||{})[x.k]||'')}</textarea>`;
  else if(x.n==='oo'&&WM.view==='board') body=`<div class="wm-ag-go"><span>Opportunities and obstacles are in their own panel - each solved or unsolved, each can become a task.</span><button class="wm-btn wm-sm wm-light" onclick="wmGoPanel('wmOoCard')"><i class="fa-solid fa-scale-balanced"></i> Go to the panel</button></div>`;
  else if(x.n==='oo') body=`<div id="wmOoHost">${wmOoHtml(m)}</div>`;
  else body=`<div class="wm-mute" style="font-size:13.5px;padding:8px 0 4px">Go round the room. No notes are kept for this step.</div>`;
  p.innerHTML=head+body;
}
window.wmAgView=function(k){
  if(WM.view==='board'&&(k==='kpi'||k==='oo'||k==='todos')){ WM.agView=k; wmPaintAgenda(false); wmGoPanel(k==='kpi'?'wmKpiCard':k==='todos'?'wmTdCard':'wmOoCard'); return; } const m=wmMeeting(WM.cur); WM.agView=k; const s=wmAgState(m); WM.agFollow=!!(s.run&&!s.done&&!s.finished&&s.items[s.i].k===k); wmPaintAgenda(false); };
window.wmAgStart=async function(){
  const m=wmMeeting(WM.cur); if(!m) return; const items=wmAgOn(m); if(!items.length) return;
  try{ if(!localStorage.getItem('wm_start_'+m.id)) localStorage.setItem('wm_start_'+m.id,String(Date.now())); }catch(e){}
  await wmAgSaveRun(m,{k:items[0].k,at:Date.now(),paused:false}); WM.agView=items[0].k; WM.agFollow=true; WM.wtab=wmTabOf(items[0].k); wmPaintMeeting();
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
  await wmAgSaveRun(m,run); WM.agView=run.k; WM.agFollow=true; wmPaintAgenda(false); if(!run.done) wmWTabFor(run.k);
};
// Changing a step's minutes. On the running step the time already spent still counts.
window.wmAgMins=async function(k,v){
  const m=wmMeeting(WM.cur); if(!m) return;
  const items=wmAgSer(wmAgMerge(m.agenda).map(x=>Object.assign(x,{mins:x.k===k?Math.max(1,Math.min(180,Number(v)||1)):x.mins})));
  try{ const {error}=await sb.rpc('ops_meeting_set_agenda',{p_meeting:m.id,p_agenda:{items}}); if(error) throw error; m.agenda={items}; }
  catch(e){ wmErr('Could not change the minutes',e); }
  wmPaintAgenda(false);
};
// A meeting set up without the agenda can take it on later: the standard steps, keeping any KPI or
// O&O section it already had.
window.wmAgAdd=async function(){
  const m=wmMeeting(WM.cur); if(!m) return;
  const items=WM_AGENDA.map(d=>({k:d.k,mins:d.mins,on:true}));
  try{ const {error}=await sb.rpc('ops_meeting_set_agenda',{p_meeting:m.id,p_agenda:{items}}); if(error) throw error; m.agenda={items}; m.has_kpi=true; m.has_oo=true; wmPaintMeeting(); }
  catch(e){ wmErr('Could not add the agenda',e); }
};
/* A step of your own, added during the meeting by the starter or an editor. While the timer runs it goes
   right after the step the timer is on; before the timer starts, before Opportunities & obstacles; once
   the agenda has finished, at the end - and the timer moves on to it. Removing a step keeps its notes. */
window.wmAgStepAdd=function(){
  const m=wmMeeting(WM.cur); if(!m||!wmCanEdit(m.id)) return;
  const s=wmAgState(m), where=s.run&&!s.done&&!s.finished?'right after the step the timer is on':s.done||s.finished?'at the end, and the timer moves on to it':'before Opportunities & obstacles';
  openModal(`<div class="modal-head"><h3>Add a step to the agenda</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm"><label>Step</label><input type="text" id="wmAsName" maxlength="60" placeholder="e.g. Site safety review" onkeydown="if(event.key==='Enter'){event.preventDefault();wmAgStepAddSave()}">
    <label>Minutes</label><input type="number" id="wmAsMins" min="1" max="180" value="5" onkeydown="if(event.key==='Enter'){event.preventDefault();wmAgStepAddSave()}">
    <div class="wm-fp-help" style="margin-top:8px">It goes ${where}. It has its own notes box, and only this meeting gets it.</div></div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="wmAsGo" onclick="wmAgStepAddSave()"><i class="fa-solid fa-plus"></i> Add step</button></div>`);
  setTimeout(()=>{ const i=$('wmAsName'); if(i) i.focus(); },50);
};
window.wmAgStepAddSave=async function(){
  const m=wmMeeting(WM.cur); if(!m) return;
  const l=String(($('wmAsName')||{}).value||'').trim(); if(!l){ toast('Give the step a name','err'); return; }
  const list=wmAgMerge(m.agenda), s=wmAgState(m), step=wmAgCustom({k:wmAgKey(),l,mins:($('wmAsMins')||{}).value,on:true});
  let at;
  if(s.run&&!s.done&&!s.finished) at=list.findIndex(x=>x.k===s.items[s.i].k)+1;
  else if(s.done||s.finished) at=list.length;
  else { at=list.findIndex(x=>x.k==='oo'&&x.on); if(at<0) at=list.length; }
  list.splice(at,0,step);
  const b=$('wmAsGo'); if(b) b.disabled=true;
  try{
    const items=wmAgSer(list); const {error}=await sb.rpc('ops_meeting_set_agenda',{p_meeting:m.id,p_agenda:{items}}); if(error) throw error;
    m.agenda={items}; closeModal(); toast('Added: '+step.l+' · '+step.mins+' min','ok');
    if((s.done||s.finished)&&!m.ended_at) await wmAgSaveRun(m,{k:step.k,at:Date.now(),paused:false});
    WM.agView=step.k; wmPaintAgenda(false);
  }catch(e){ if(b) b.disabled=false; wmErr('Could not add the step',e); }
};
window.wmAgStepDel=async function(k){
  const m=wmMeeting(WM.cur); if(!m) return;
  const list=wmAgMerge(m.agenda), x=list.find(i=>i.k===k); if(!x||!x.custom) return;
  const s=wmAgState(m); if(s.run&&!s.done&&!s.finished&&s.items[s.i].k===k){ toast('The timer is on this step - move it on first','warn'); return; }
  if(!confirm('Remove the step "'+x.l+'" from this meeting\'s agenda?'+(String((m.agenda_notes||{})[k]||'').trim()?' Its notes are kept in the meeting summary.':''))) return;
  try{
    const items=wmAgSer(list.filter(i=>i.k!==k)); const {error}=await sb.rpc('ops_meeting_set_agenda',{p_meeting:m.id,p_agenda:{items}}); if(error) throw error;
    m.agenda={items}; if(WM.agView===k) WM.agView=null; toast('Removed: '+x.l,'ok'); wmPaintAgenda(false);
  }catch(e){ wmErr('Could not remove it',e); }
};
/* Edit agenda: the same editor as the Start / Schedule form, for this meeting - tick steps on or off,
   change minutes, move steps, rename / remove / add steps of your own. The step the timer is on must stay. */
window.wmAgEdit=function(){
  const m=wmMeeting(WM.cur); if(!m||!wmCanEdit(m.id)) return;
  WM.formAg=wmAgMerge(m.agenda).map(x=>Object.assign({},x)); WM.agEditing=true;
  openModal(`<div class="modal-head"><h3>Edit the agenda</h3><span class="x" onclick="WM.agEditing=false;closeModal()">&times;</span></div>
  <div class="modal-body frm"><div class="wm-fp-help" style="margin:0 0 10px">Untick what this meeting skips, change the minutes, move steps with the arrows, or add a step of your own. Only this meeting changes.</div><div class="wm-agf" id="wmAgForm"></div></div>
  <div class="modal-foot"><button class="btn" onclick="WM.agEditing=false;closeModal()">Cancel</button><button class="btn btn-primary" id="wmAgEdGo" onclick="wmAgEditSave()"><i class="fa-solid fa-check"></i> Save agenda</button></div>`);
  wmFormAgenda();
};
window.wmAgEditSave=async function(){
  const m=wmMeeting(WM.cur); if(!m) return;
  const on=WM.formAg.filter(x=>x.on); if(!on.length){ toast('Keep at least one step','err'); return; }
  const s=wmAgState(m);
  if(s.run&&!s.done&&!s.finished){ const k=s.items[s.i].k; if(!on.some(x=>x.k===k)){ toast('The timer is on "'+s.items[s.i].l+'" - keep that step, or move the timer on first','warn'); return; } }
  const b=$('wmAgEdGo'); if(b) b.disabled=true;
  try{
    const items=wmAgSer(WM.formAg); const {error}=await sb.rpc('ops_meeting_set_agenda',{p_meeting:m.id,p_agenda:{items}}); if(error) throw error;
    m.agenda={items}; WM.agEditing=false; closeModal(); toast('Agenda saved','ok'); wmPaintAgenda(false);
  }catch(e){ if(b) b.disabled=false; wmErr('Could not save the agenda',e); }
};
/* The meeting's work area (24 Nov, less clutter): one card with the action line on top and four tabs -
   Actions, KPIs, To-dos, Opportunities & Obstacles - one shown at a time. When the agenda moves to the
   KPIs, To-dos or O&O step the matching tab opens (any other step opens Actions); a tab can always be
   picked by hand. The kind's task counters sit at the right of the tabs. */
function wmTabOf(k){ return k==='kpi'?'kpi':k==='todos'?'td':k==='oo'?'oo':'act'; }
function wmPaintWTabs(){
  const h=$('wmWTabs'), m=wmMeeting(WM.cur); if(!h||!m) return;
  if(!['act','kpi','td','oo'].includes(WM.wtab)) WM.wtab='act';
  const td=WM_TD_SECS.flatMap(s=>wmNotesFor(m,s)).filter(n=>!n.solved).length, oo=['opportunity','obstacle'].flatMap(s=>wmNotesFor(m,s)).filter(n=>!n.solved).length;
  const tb=(k,ic,l,n,sh)=>`<button class="wm-wtab ${WM.wtab===k?'on':''}" role="tab" aria-selected="${WM.wtab===k}" title="${l}" onclick="wmWTab('${k}')"><i class="fa-solid ${ic}"></i><span class="lg">${l}</span><span class="sh">${sh||l}</span>${n?`<em>${n}</em>`:''}</button>`;
  h.innerHTML=tb('act','fa-list-check','Actions',0)+tb('kpi','fa-chart-line','KPIs',0)+tb('td','fa-bullseye','To-dos',td)+tb('oo','fa-scale-balanced','Opportunities & Obstacles',oo,'O&amp;O')+'<span class="wm-bd-stats" id="wmBdStats"></span>';
  wmPaintBoardStats();
  document.querySelectorAll('#wmWs .wm-wpane').forEach(p=>p.classList.toggle('on',p.dataset.p===WM.wtab));
}
window.wmWTab=function(k){ WM.wtab=k; wmPaintWTabs(); };
function wmWTabFor(k){ if(!$('wmWs')) return; WM.wtab=wmTabOf(k); wmPaintWTabs(); }
// The meeting's More menu: open / close; any click outside closes it.
window.wmMoreToggle=function(e){ if(e) e.stopPropagation(); const w=$('wmMore'); if(!w) return; const p=w.querySelector('.wm-more-panel'), b=w.querySelector('button'); const open=p.style.display==='none'; p.style.display=open?'':'none'; if(b) b.setAttribute('aria-expanded',String(open)); };
document.addEventListener('click',function(e){ const w=$('wmMore'); if(!w) return; const p=w.querySelector('.wm-more-panel'); if(p&&p.style.display!=='none'&&!e.target.closest('#wmMore')) wmMoreToggle(); });
window.wmAgNoteInput=function(k,el){ WM.noteT=WM.noteT||{}; clearTimeout(WM.noteT[k]); WM.noteT[k]=setTimeout(()=>wmAgNoteSave(k,el),900); };
window.wmAgNoteSave=async function(k,el){
  if(WM.noteT) clearTimeout(WM.noteT[k]);
  const m=wmMeeting(WM.cur); if(!m||!el) return;
  const v=el.value, have=(m.agenda_notes||{})[k]||''; if(have===v) return;
  const st=$('wmSt_'+k); if(st) st.textContent='Saving…';
  try{ const {error}=await sb.rpc('ops_meeting_set_agenda_note',{p_meeting:m.id,p_key:k,p_value:v}); if(error) throw error; m.agenda_notes=Object.assign({},m.agenda_notes,{[k]:v}); if(st) st.textContent='Saved'; }
  catch(e){ if(st) st.textContent=''; wmErr('Could not save the notes',e); }
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
function wmOoTabHtml(m){
  const all=['opportunity','obstacle'].flatMap(s=>wmNotesFor(m,s)), un=all.filter(n=>!n.solved).length;
  const solvedAll=(WM.notes||[]).filter(n=>(n.section==='obstacle'||n.section==='opportunity')&&n.kind===m.kind&&n.solved&&String(n.meeting_date)<=String(m.meeting_date)).length;
  const fb=(k,l,n)=>`<button class="wm-fb ${WM.ooF===k?'on':''}" onclick="WM.ooF='${k}';wmRepaintOo()">${l} <span>${n}</span></button>`;
  return `<div class="wm-oo-top"><div class="wm-fbs">${fb('unsolved','Unsolved',un)}${fb('solved','Solved',solvedAll)}${fb('all','All',all.length)}</div>
    <span class="wm-mute" style="font-size:12px">Unsolved notes come back at every later ${esc(m.kind)} meeting until solved.</span></div>
    <div id="wmOoHost">${wmOoHtml(m)}</div>`;
}
// The notes of one section under the chosen filter. Solved: every solved note of this kind up to this
// meeting, most recently solved first - the record; Unsolved and All follow the carry-forward rule.
function wmOoList(m,sec){
  if(WM.ooF==='solved') return (WM.notes||[]).filter(n=>n.section===sec&&n.kind===m.kind&&n.solved&&String(n.meeting_date)<=String(m.meeting_date))
    .sort((a,b)=>String(a.solved_at||'')<String(b.solved_at||'')?1:-1);
  const l=wmNotesFor(m,sec); return WM.ooF==='unsolved'?l.filter(n=>!n.solved):l;
}
function wmOoHtml(m){
  const legacy=['opportunities','obstacles'].filter(f=>(m[f]||'').trim());
  return (legacy.length?`<div class="wm-oo-old">${legacy.map(f=>`<div><b>${f==='obstacles'?'Obstacles':'Opportunities'} written earlier</b><div>${esc(m[f]).replace(/\n/g,'<br>')}</div></div>`).join('')}</div>`:'')
  +`<div class="wm-oo" style="margin-top:0">${WM_OO.map(([sec,l,i,ph])=>{ const list=wmOoList(m,sec), open=wmNotesFor(m,sec).filter(n=>!n.solved).length;
    return `<div class="wm-oo-box ${sec==='obstacle'?'obstacles':'opportunities'}"><div class="wm-sec"><span><i class="fa-solid ${i}" style="margin-right:6px"></i>${l}</span><span class="r wm-mute wm-nst">${open} open</span></div>
      ${WM.ooF==='solved'?'':`<input class="wm-nt-add" id="wmNtAdd_${sec}" placeholder="${ph}" onkeydown="if(event.key==='Enter'){event.preventDefault();wmNoteAdd('${sec}',this)}">`}
      <div class="wm-nt-list">${list.map(n=>wmNoteRow(n,m)).join('')||`<div class="wm-mute" style="font-size:12.5px;padding:8px 2px">${WM.ooF==='solved'?'Nothing solved yet.':WM.ooF==='unsolved'?'Nothing open.':'Nothing yet.'}</div>`}</div></div>`; }).join('')}</div>`;
}
function wmNoteRow(n,m){
  const from=n.meeting_id!==m.id, who=(n.task_assignees||[]).map(wmName).join(', ');
  const tst=n.task_status==='Completed'?'done':n.task_status==='Awaiting Approval'?'waiting for your approval':n.task_status?'pending':'';
  return `<div class="wm-nt ${n.solved?'solved':''}">
    <button class="ck" title="${wmIsTd(n)?(n.solved?'Done - click to mark not done':'To do - click to mark done'):(n.solved?'Solved - click to mark unsolved':'Unsolved - click to mark solved')}" onclick="wmNoteSolve(${n.id},${!n.solved})"><i class="fa-solid fa-check"></i></button>
    <div class="tx"><div class="bd">${esc(n.body)}</div>
      <div class="mt"><span class="st ${n.solved?'y':'n'}">${wmIsTd(n)?(n.solved?'Done':'To do'):(n.solved?'Solved':'Unsolved')}</span>${from?`<span class="fr" onclick="wmOpenMeeting(${n.meeting_id})">From ${esc(wmFmtS(n.meeting_date))}</span>`:'<span>This meeting</span>'}
        <span class="by">${n.created_by?'by '+esc(wmName(n.created_by))+' · ':''}${n.created_at?esc(wmFmtS(n.created_at))+', '+esc(wmClock(n.created_at)):''}</span>${n.solved&&n.solved_at?`<span class="by">${wmIsTd(n)?'done':'solved'} ${esc(wmFmtS(n.solved_at))}</span>`:''}
        ${n.ptask_id?`<span class="tk"><i class="fa-solid fa-list-check"></i> Task for ${esc(who||'—')}${tst?' · '+tst:''}</span>`:n.solved?'':`<button class="wm-quiet" onclick="wmNoteTask(${n.id})"><i class="fa-solid fa-user-plus"></i> Make a task</button>`}
        <button class="wm-ed" title="Edit" onclick="wmNoteEdit(${n.id})"><i class="fa-solid fa-pen"></i></button>
        ${!from&&!n.ptask_id?`<button class="rm" title="Delete this note" onclick="wmNoteDel(${n.id})"><i class="fa-solid fa-trash-can"></i></button>`:''}</div></div></div>`;
}
async function wmReloadNotes(){ const {data,error}=await sb.rpc('ops_weekly_notes'); if(error) throw error; WM.notes=data||[]; }
function wmPaintOo(focusSec){ wmRepaintOo(WM_TD_SECS.includes(focusSec)?null:focusSec); wmRepaintTd(WM_TD_SECS.includes(focusSec)?focusSec:null); }
/* ---------- To-dos for the coming week (24 Nov 2026) ----------
   Two lists: Target (what must be done by the next meeting) and Trying (what we will try). Each to-do is
   a meeting note (section 'target' / 'trying'): ticked done, edited, deleted or made into a task by the
   starter or an editor only; one not done comes back at every later meeting of the same kind, marked
   "From <date>", until it is ticked. */
const WM_TD=[['target','Target for the coming week','fa-bullseye','New target, then Enter'],['trying','Trying for the coming week','fa-flask','Something to try, then Enter']];
const WM_TD_SECS=WM_TD.map(x=>x[0]);
const WM_SEC_L={target:'target',trying:'thing to try',obstacle:'obstacle',opportunity:'opportunity'};
const WM_SEC_H={target:'Target',trying:'Trying',obstacle:'Obstacle',opportunity:'Opportunity'};
const wmIsTd=n=>WM_TD_SECS.includes(n&&n.section);
function wmTdHtml(m){
  const old=String((m.agenda_notes||{}).todos||'').trim();
  return `${old?`<div class="wm-oo-old"><div><b>To-do notes written earlier</b><div>${esc(old).replace(/\n/g,'<br>')}</div></div></div>`:''}
  <div class="wm-oo" style="margin-top:0">${WM_TD.map(([sec,l,i,ph])=>{ const list=wmNotesFor(m,sec), open=list.filter(n=>!n.solved).length;
    return `<div class="wm-oo-box wm-td-box ${sec}"><div class="wm-sec"><span><i class="fa-solid ${i}" style="margin-right:6px"></i>${l}</span><span class="r wm-mute wm-nst">${open} to do</span></div>
      <input class="wm-nt-add" id="wmNtAdd_${sec}" placeholder="${ph}" onkeydown="if(event.key==='Enter'){event.preventDefault();wmNoteAdd('${sec}',this)}">
      <div class="wm-nt-list">${list.map(n=>wmNoteRow(n,m)).join('')||'<div class="wm-mute" style="font-size:12.5px;padding:8px 2px">Nothing yet.</div>'}</div></div>`; }).join('')}</div>`;
}
function wmRepaintTd(focusSec){
  const m=wmMeeting(WM.cur), c=$('wmTdCard'); if(!m||!c) return;
  const open=WM_TD_SECS.flatMap(s=>wmNotesFor(m,s)).filter(n=>!n.solved).length;
  c.innerHTML=wmCardHead('td','wmTdCard','fa-list-check','To-dos for the coming week',`<span class="wm-fh-n">${open} to do</span>`)+`<div class="wm-bd-in"><div class="wm-kpi-grey" style="margin:8px 0 4px">A to-do not ticked comes back at the next ${esc(m.kind||'')} meeting.</div>${wmTdHtml(m)}</div>`;
  c.classList.toggle('folded',wmFolded('td'));
  if(focusSec){ const i=$('wmNtAdd_'+focusSec); if(i) i.focus(); }
}
window.wmNoteAdd=async function(sec,el){
  const m=wmMeeting(WM.cur), v=(el.value||'').trim(); if(!m||!v) return;
  el.disabled=true;
  try{ const {error}=await sb.rpc('ops_note_add',{p_meeting:m.id,p_section:sec,p_body:v}); if(error) throw error; await wmReloadNotes(); wmPaintOo(sec); }
  catch(e){ el.disabled=false; wmErr('Could not add the note',e); }
};
window.wmNoteSolve=async function(id,v){
  try{ const {error}=await sb.rpc('ops_note_set',{p_id:id,p_body:null,p_solved:v}); if(error) throw error; await wmReloadNotes(); wmPaintOo(); { const nn=(WM.notes||[]).find(x=>x.id===id); toast(wmIsTd(nn)?(v?'Marked done':'Marked not done'):(v?'Marked solved':'Marked unsolved'),'ok'); }; }
  catch(e){ wmErr('Could not change it',e); }
};
window.wmNoteDel=async function(id){
  if(!confirm('Delete this note?')) return;
  try{ const {error}=await sb.rpc('ops_note_delete',{p_id:id}); if(error) throw error; await wmReloadNotes(); wmPaintOo(); }
  catch(e){ wmErr('Could not delete it',e); }
};
// Make a task from a note: the same rules as a typed task - a title, at least one person, never
// yourself, an optional due date that is not in the past.
window.wmNoteTask=function(id){
  const n=(WM.notes||[]).find(x=>x.id===id), m=wmMeeting(WM.cur); if(!n||!m) return;
  window._wmNtPick=new Set();
  const here=new Set(m.attendees||[]), others=WM.people.filter(wmAssignable).sort((a,b)=>wmIsMe(a.email)?-1:wmIsMe(b.email)?1:0), inRoom=others.filter(p=>here.has(p.name)), rest=others.filter(p=>!here.has(p.name));
  const row=p=>`<label class="pp"><input type="checkbox" onchange="this.checked?_wmNtPick.add('${esc(p.email)}'):_wmNtPick.delete('${esc(p.email)}')">${wmAvatar(p.name,26)} ${esc(p.name)}${wmIsMe(p.email)?' <b style="font-weight:600;color:#e0121c">(you)</b>':''}<span>${esc(p.dept||'')}</span></label>`;
  openModal(`<div class="modal-head"><h3>Make a task from this ${WM_SEC_L[n.section]||n.section}</h3><span class="x" onclick="closeModal()">&times;</span></div>
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
  }catch(e){ b.disabled=false; wmErr('Could not finish that',e); }
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
  if(WM.view==='board') return `<details class="wm-kr wm-kr-fold"><summary><i class="fa-solid fa-clock-rotate-left"></i> Earlier ${esc(m.kind)} meetings · ${past.length} with figures</summary><div class="wm-kt-wrap"><table class="wm-kt wm-kr-t"><thead><tr><th>Meeting</th><th>Person</th>${names.map(n=>`<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></details>`;
  return `<div class="wm-kr"><div class="wm-sec" style="margin-top:18px"><span><i class="fa-solid fa-clock-rotate-left" style="margin-right:6px"></i>KPI review · earlier ${esc(m.kind)} meetings</span></div>
    <div class="wm-kt-wrap"><table class="wm-kt wm-kr-t"><thead><tr><th>Meeting</th><th>Person</th>${names.map(n=>`<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

/* ---------- KPI tab: this meeting's table (with last meeting's figures), notes, then the review ---------- */
// The last earlier meeting of the same kind that has KPI values: the comparison under each cell.
function wmKpiPrev(m){
  return (WM.meetings||[]).find(x=>x.kind===m.kind&&x.id!==m.id&&(x.meeting_date<m.meeting_date||(x.meeting_date===m.meeting_date&&x.id<m.id))
    &&Object.values(x.kpi_vals||{}).some(v=>Object.values(v||{}).some(s=>String(s||'').trim())))||null;
}
function wmKpiTabHtml(m){
  const prev=wmKpiPrev(m);
  return `<div class="wm-sec"><span><i class="fa-solid fa-chart-line" style="margin-right:6px"></i>KPIs · ${esc(wmFmt(m.meeting_date))} <span class="wm-kpi-state" id="wmKpiState"></span></span><span class="r wm-mute wm-nst">${prev?'Grey = last meeting ('+esc(wmFmtS(prev.meeting_date))+')':'No earlier figures yet'}</span></div>`
    +wmKpiTableHtml(m)
    +`<div class="wm-sec" style="margin-top:18px"><span>KPI notes</span><span class="r wm-mute wm-nst" id="wmKpiSt"></span></div>
      <textarea class="wm-ag-ta" id="wmKpiTxt" placeholder="Anything behind the numbers…" oninput="wmKpiInput(this)" onblur="wmKpiSave(this)">${esc(m.kpi_notes||'')}</textarea>`
    +wmKpiReviewHtml(m);
}
/* ---------- the KPI table: one row per person in the meeting, columns you add ---------- */
function wmKpiPrevVal(x,person,name){ if(!x) return ''; const c=(x.kpi_cols||[]).find(c=>(c.name||'').trim()===(name||'').trim()); return c?String(((x.kpi_vals||{})[person]||{})[c.id]||'').trim():''; }
function wmKpiTableHtml(m){
  const ppl=m.attendees||[], cols=Array.isArray(m.kpi_cols)?m.kpi_cols:[], vals=m.kpi_vals||{}, prev=wmKpiPrev(m);
  if(!ppl.length) return `<div class="wm-mute" style="font-size:13.5px;padding:6px 0">Add the people in this meeting first; each one gets a row here.</div>`;
  return `<div class="wm-kt-wrap"><table class="wm-kt"><thead><tr><th>Person</th>${cols.map(c=>`<th><input class="h" value="${esc(c.name)}" placeholder="Column name" onchange="wmKpiColName('${esc(c.id)}',this.value)"><button class="x" title="Remove this column" onclick="wmKpiColDel('${esc(c.id)}')"><i class="fa-solid fa-xmark"></i></button></th>`).join('')}
      <th class="add"><button class="wm-quiet" title="Add a column" aria-label="Add a column" onclick="wmKpiColAdd()"><i class="fa-solid fa-plus"></i><span class="lbl"> Add column</span></button></th></tr></thead>
    <tbody>${ppl.map(n=>`<tr><td class="p">${wmAvatar(n,22)} ${esc(n)}</td>${cols.map(c=>{ const v=((vals[n]||{})[c.id])||'', pv=wmKpiPrevVal(prev,n,c.name), d=(String(v).trim()!==''&&pv!==''&&!isNaN(v)&&!isNaN(pv))?Number(v)-Number(pv):null;
      return `<td><input value="${esc(v)}" onchange="wmKpiCell(${JSON.stringify(n).replace(/"/g,'&quot;')},'${esc(c.id)}',this.value)">${pv!==''?`<span class="pv">last ${esc(pv)}${d?` <b class="${d>0?'up':'dn'}">${d>0?'▲':'▼'} ${Math.abs(d)}</b>`:''}</span>`:''}</td>`; }).join('')}<td></td></tr>`).join('')}</tbody></table></div>
    ${cols.length?'':'<div class="wm-mute" style="font-size:12.5px;margin-top:8px">Add a column for each number you track (bookings, collections, site visits…). The columns carry over to the next meeting of this kind.</div>'}`;
}
function wmKpiStatus(t,bad){ const st=$('wmKpiState'); if(!st) return; st.textContent=t; st.className='wm-kpi-state '+(bad?'bad':t==='Saved'?'ok':''); clearTimeout(WM.kpiStT); if(t==='Saved') WM.kpiStT=setTimeout(()=>{ if(st) st.textContent=''; },2500); }
async function wmKpiSaveCols(m,cols){
  wmKpiStatus('Saving…');
  try{ const {error}=await sb.rpc('ops_meeting_set_kpi_cols',{p_meeting:m.id,p_cols:cols}); if(error) throw error; m.kpi_cols=cols; wmKpiStatus('Saved'); }
  catch(e){ wmKpiStatus('Not saved',true); wmErr('Could not save the columns',e); }
}
window.wmKpiColAdd=async function(){
  const m=wmMeeting(WM.cur); if(!m) return; const id='c'+Date.now().toString(36);
  await wmKpiSaveCols(m,(m.kpi_cols||[]).concat([{id,name:''}])); wmRepaintKpi();
  const hs=document.querySelectorAll('.wm-kt th input.h'); if(hs.length) hs[hs.length-1].focus();
};
window.wmKpiColName=async function(id,v){ const m=wmMeeting(WM.cur); if(!m) return; await wmKpiSaveCols(m,(m.kpi_cols||[]).map(c=>c.id===id?{id,name:v.trim()}:c)); };
window.wmKpiColDel=async function(id){
  const m=wmMeeting(WM.cur); if(!m) return; const c=(m.kpi_cols||[]).find(x=>x.id===id);
  if(!confirm('Remove the column "'+((c&&c.name)||'untitled')+'" from this meeting\'s table?')) return;
  await wmKpiSaveCols(m,(m.kpi_cols||[]).filter(x=>x.id!==id)); wmRepaintKpi();
};
window.wmKpiCell=async function(person,col,v){
  const m=wmMeeting(WM.cur); if(!m) return;
  const el=document.activeElement&&document.activeElement.tagName==='INPUT'?document.activeElement:null; wmKpiStatus('Saving…');
  try{ const {error}=await sb.rpc('ops_meeting_set_kpi_cell',{p_meeting:m.id,p_person:person,p_col:col,p_value:v}); if(error) throw error;
    m.kpi_vals=Object.assign({},m.kpi_vals); m.kpi_vals[person]=Object.assign({},m.kpi_vals[person],{[col]:v}); wmCounts(); wmKpiStatus('Saved'); }
  catch(e){ wmKpiStatus('Not saved',true); if(el) el.classList.add('wm-bad'); wmErr('Could not save that value',e); }
};

window.wmKpiAdd=async function(){
  const m=wmMeeting(WM.cur); if(!m) return;
  try{ const {error}=await sb.rpc('ops_meeting_set_kpi',{p_meeting:m.id,p_on:true,p_notes:m.kpi_notes||''}); if(error) throw error; m.has_kpi=true; wmPaintMeeting(); const t=$('wmKpiTxt'); if(t) t.focus(); }
  catch(e){ wmErr('Could not add the KPI section',e); }
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
  }catch(e){ wmErr('Could not save attendance',e); }
};

/* ---------- Pending / All tasks / Finished: every meeting of this kind, all its dates ---------- */
function wmPaintTabs(){
  if(WM.view==='all') return wmPaintAllList();
  const host=$('wmTasks'), m=wmMeeting(WM.cur); if(!host||!m) return;
  const all=WM.items.filter(it=>it.kind===m.kind&&!it.draft);
  const match=it=>(!WM.who||wmWhoKeys(it).includes(WM.who))&&(!WM.q||it.t.toLowerCase().includes(WM.q.toLowerCase()));
  const pend=all.filter(wmOpen), fin=all.filter(it=>!wmOpen(it));
  const people=[...new Set(all.flatMap(wmWhoKeys))].sort((x,y)=>wmKeyName(x)<wmKeyName(y)?-1:1);
  const body=WM.tab==='pending'?wmPendingHtml(pend.filter(match)):WM.tab==='all'?wmAllHtml(all.filter(match),all):wmFinishedHtml(fin.filter(match));
  host.innerHTML=`<div class="ttabs">
    <button class="ttab pend ${WM.tab==='pending'?'on':''}" onclick="WM.tab='pending';wmPaintTabs()">Pending <span class="n">${pend.length}</span></button>
    <button class="ttab ${WM.tab==='all'?'on':''}" onclick="WM.tab='all';wmPaintTabs()">All Tasks <span class="n">${all.length}</span></button>
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
  bits.push(it.meeting!==WM.cur||WM.view==='all'?`<span class="from" onclick="wmOpenMeeting(${it.meeting})">${from}</span>`:`<span>${from}</span>`);
  if(showPeople) bits.push(`<span>${it.linked?it.mem.map(e=>wmAvatar(wmName(e),18)).join('')+' '+esc(it.mem.map(wmFirst).join(', ')):esc(it.owner||'No owner')}</span>`);
  else if(it.linked&&it.mem.length>1) bits.push(`<span>with ${esc(it.mem.filter(e=>'e:'+e.toLowerCase()!==forKey).map(wmFirst).join(', '))}</span>`);
  // Who assigned it (the only person who can approve it), or that it came from the minutes sheet.
  bits.push(`<span class="by">${it.linked?'by '+esc(it.delegator?wmName(it.delegator):'—'):'minutes sheet'}</span>`);
  const due=it.due?String(it.due).slice(0,10):null, done=it.doneOn?String(it.doneOn).slice(0,10):null;
  if(it.st==='done'){
    bits.push(`<span class="ok">Finished${done?' '+esc(wmFmtS(done)):''}</span>`);
    if(due&&done){ const late=wmDays(due,done); bits.push(late>0?`<span class="od">${late} day${late>1?'s':''} late</span>`:`<span>${late<0?(-late)+' day'+(late<-1?'s':'')+' early':'on the day'}</span>`); }
  } else if(it.st==='awaiting') bits.push(`<span class="aw">Marked done — ${wmIsMe(it.delegator)?'waiting for your approval':'awaiting approval'}</span>`);
  else if(it.st==='in_progress') bits.push('<span class="aw">In progress</span>');
  else if(it.st==='not_done') bits.push('<span class="od">Not done</span>');
  if(wmOpen(it)&&due){ const d=wmDays(due,today); bits.push(wmOverdue(it)?`<span class="od" title="Was due ${esc(wmFmt(due))}">${d} day${d>1?'s':''} overdue</span>`:`<span>Due ${esc(wmFmtS(due))}</span>`); }
  else if(wmOpen(it)&&!due&&it.dueRaw) bits.push(`<span>Due: ${esc(it.dueRaw)}</span>`);
  if(it.recur&&it.recur.freq&&it.recur.freq!=='none') bits.push(`<span><i class="fa-solid fa-repeat"></i> ${esc(it.recur.freq==='weekly'?'Weekly':it.recur.freq==='monthly'?'Monthly':it.recur.freq)}</span>`);
  // Imported lines keep the sheet's four states, so they get the sheet's control; tasks follow Accountability.
  const ed=wmCanEdit(it.meeting);
  const legacyCtl=!it.linked?`<select class="wm-st-sel" ${ed?'':'disabled title="Only the person who started that meeting can change this"'} onchange="wmSetLegacy(${it.id},this.value,this)">${Object.entries(WM_LEGACY).map(([k,l])=>`<option value="${k}" ${it.st===k?'selected':''}>${l}</option>`).join('')}</select>`:'';
  const pill=it.st==='done'?['f','Finished']:it.st==='awaiting'?['a','Awaiting approval']:wmOverdue(it)?['o','Overdue']:['p',it.linked?'Pending':WM_LEGACY[it.st]||'Open'];
  return `<div class="task ${it.st==='done'?'done':''} ${it.id===WM.lastNew?'new':''}">
    <div class="bx" ${ed||it.linked?`onclick="wmToggle(${it.id})"`:'style="cursor:default;opacity:.5"'} title="${it.st==='done'?'Reopen':'Mark finished'}">${it.st==='done'?'<i class="fa-solid fa-check"></i>':''}</div>
    <div style="flex:1;min-width:0"><div class="tt">${esc(it.t)}${wmItemEditable(it)?`<button class="wm-ed" title="Edit" onclick="wmEditItem(${it.id})"><i class="fa-solid fa-pen"></i></button>`:''}</div><div class="mt">${bits.join('')}</div>
      ${it.st==='awaiting'?(wmIsMe(it.delegator)?`<div style="display:flex;gap:6px;margin-top:6px"><button class="b ok sm" onclick="wmApprove(${it.id},true)"><i class="fa-solid fa-check"></i> Approve</button><button class="b sb sm" onclick="wmApprove(${it.id},false)">Send back</button></div>`:`<div class="aw-wait">Waiting for ${esc(wmName(it.delegator))} to approve</div>`):''}</div>
    ${it.linked?`<span class="st ${pill[0]}">${pill[1]}</span>`:showPeople?`<span class="st ${pill[0]}">${pill[1]}</span>`:legacyCtl}
  </div>`;
}

/* ---------- ticking, approving: the same writes Accountability makes ---------- */
const ACCX=()=>sb.schema('acc');

/* ---------- editing what was written in a meeting ----------
   A task: its text, due date and people - by the person who assigned it (Accountability's rule) in a
   meeting they may change; each change is written to the task's own history as Accountability does.
   A line from the minutes sheet: its text, due date and owner - by whoever may change that meeting.
   Unassigned lines, KPI values and the notes boxes are edited in place already. */
function wmItemEditable(it){ return !it.draft&&wmCanEdit(it.meeting)&&(!it.linked||wmIsMe(it.delegator)); }
window.wmEditItem=function(id){
  const it=wmFind(id); if(!it||!wmItemEditable(it)) return;
  const due=it.due?String(it.due).slice(0,10):'';
  let people='';
  if(it.linked){
    window._wmEdPick=new Set(it.mem.map(e=>String(e).toLowerCase()));
    const {inRoom,rest}=wmPeopleGroups(), row=p=>`<label class="pp"><input type="checkbox" ${_wmEdPick.has(p.email.toLowerCase())?'checked':''} onchange="this.checked?_wmEdPick.add('${esc(p.email.toLowerCase())}'):_wmEdPick.delete('${esc(p.email.toLowerCase())}')">${wmAvatar(p.name,26)} ${esc(p.name)}${wmIsMe(p.email)?' <b style="font-weight:600;color:#e0121c">(you)</b>':''}<span>${esc(p.dept||'')}</span></label>`;
    people=`<label>Given to</label><input type="text" placeholder="Search people" oninput="document.querySelectorAll('#wmEdPpl label').forEach(l=>l.style.display=l.textContent.toLowerCase().includes(this.value.toLowerCase())?'':'none')">
      <div id="wmEdPpl" style="max-height:220px;overflow-y:auto;margin-top:6px">${inRoom.length?`<div class="g">In this meeting</div>${inRoom.map(row).join('')}<div class="g">Everyone else</div>`:''}${rest.map(row).join('')}</div>`;
  } else people=`<label>Owner <span style="font-weight:400;color:var(--slate)">(as written in the minutes)</span></label><input type="text" id="wmEdOwner" value="${esc(it.owner||'')}">`;
  openModal(`<div class="modal-head"><h3>Edit ${it.linked?'task':'line'}</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm wm-ntm">
    <label>${it.linked?'Task':'Line'}</label><input type="text" id="wmEdText" value="${esc(it.t)}">
    <label>Due date <span style="font-weight:400;color:var(--slate)">(optional)</span></label><input type="date" id="wmEdDue" value="${esc(due)}">
    ${people}
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="wmEdGo" onclick="wmEditItemSave(${id})"><i class="fa-solid fa-check"></i> Save</button></div>`);
};
window.wmEditItemSave=async function(id){
  const it=wmFind(id); if(!it) return;
  const text=($('wmEdText').value||'').trim(), due=$('wmEdDue').value||null, oldDue=it.due?String(it.due).slice(0,10):null;
  if(!text){ toast('Type a title','err'); return; }
  if(due&&due!==oldDue&&due<wmToday()){ toast('Choose today or a later date for the due date','err'); return; }
  let mem=null;
  if(it.linked){
    mem=[..._wmEdPick];
    if(!mem.length){ toast('Pick at least one member','err'); return; }
    if(!wmSelfOK()&&mem.some(e=>wmIsMe(e))){ toast('You cannot give yourself a task in a meeting you did not start','err'); return; }
  }
  const b=$('wmEdGo'); b.disabled=true; b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
  const done=[];
  try{
    if(it.linked){
      if(text!==it.t){
        const r=await ACCX().from('ptasks').update({title:text}).eq('id',it.ptask); if(r.error) throw r.error;
        await ACCX().from('ptask_activity').insert({task_id:it.ptask,action:'edited',detail:'renamed to "'+text+'"'});
        const s=await sb.rpc('ops_item_set_text',{p_id:it.id,p_item:text}); if(s.error) throw s.error; done.push('text');
      }
      if(due!==oldDue){
        const r=await ACCX().from('ptasks').update({due_date:due,overdue_emailed:false,due_emailed:false}).eq('id',it.ptask); if(r.error) throw r.error;
        await ACCX().from('ptask_activity').insert({task_id:it.ptask,action:'edited',detail:due?'due date set to '+due:'due date removed'});
        const s=await sb.rpc('ops_item_set_due',{p_id:it.id,p_due:due}); if(s.error) throw s.error; done.push('due date');
      }
      const was=new Set(it.mem.map(e=>String(e).toLowerCase())), add=mem.filter(e=>!was.has(e)), drop=[...was].filter(e=>!mem.includes(e));
      if(add.length||drop.length){
        if(add.length){ const r=await ACCX().from('ptask_assignees').insert(add.map(e=>({task_id:it.ptask,email:e}))); if(r.error) throw r.error; }
        for(const e of drop){ const r=await ACCX().from('ptask_assignees').delete().eq('task_id',it.ptask).eq('email',e); if(r.error) throw r.error; }
        await ACCX().from('ptask_activity').insert({task_id:it.ptask,action:'edited',detail:'people: '+mem.map(wmName).join(', ')});
        const s=await sb.rpc('ops_item_set_owner',{p_id:it.id,p_owner:mem.map(wmName).join(', ')}); if(s.error) throw s.error; done.push('people');
      }
    } else {
      if(text!==it.t){ const s=await sb.rpc('ops_item_set_text',{p_id:it.id,p_item:text}); if(s.error) throw s.error; done.push('text'); }
      if(due!==oldDue){ const s=await sb.rpc('ops_item_set_due',{p_id:it.id,p_due:due}); if(s.error) throw s.error; done.push('due date'); }
      const owner=($('wmEdOwner').value||'').trim();
      if(owner!==(it.owner||'')){ const s=await sb.rpc('ops_item_set_owner',{p_id:it.id,p_owner:owner}); if(s.error) throw s.error; done.push('owner'); }
    }
    closeModal(); toast(done.length?'Saved: '+done.join(', '):'Nothing changed','ok');
    try{ usageQueue('tasks.tasks.edit_task_title','update',{title:text}); }catch(_e){}
    await wmAfterWrite();
  }catch(e){ b.disabled=false; b.innerHTML='<i class="fa-solid fa-check"></i> Save'; wmErr('Could not save'+(done.length?' everything (saved: '+done.join(', ')+')':''),e); }
};
// An obstacle or opportunity: its wording.
window.wmNoteEdit=function(id){
  const n=(WM.notes||[]).find(x=>x.id===id); if(!n) return;
  openModal(`<div class="modal-head"><h3>Edit this ${WM_SEC_L[n.section]||n.section}</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm"><textarea id="wmNoteEdTxt" rows="4">${esc(n.body)}</textarea></div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="wmNoteEdGo" onclick="wmNoteEditSave(${id})"><i class="fa-solid fa-check"></i> Save</button></div>`);
  const t=$('wmNoteEdTxt'); if(t){ t.focus(); t.setSelectionRange(t.value.length,t.value.length); }
};
window.wmNoteEditSave=async function(id){
  const v=($('wmNoteEdTxt').value||'').trim(); if(!v){ toast('A note cannot be empty','err'); return; }
  const b=$('wmNoteEdGo'); b.disabled=true;
  try{ const {error}=await sb.rpc('ops_note_set',{p_id:id,p_body:v,p_solved:null}); if(error) throw error; closeModal(); toast('Saved','ok'); await wmReloadNotes(); wmPaintOo(); }
  catch(e){ b.disabled=false; wmErr('Could not save the note',e); }
};
function wmFind(id){ return WM.items.find(it=>it.id===id); }
async function wmAfterWrite(){ await wmReload(); wmCounts(); wmPaintTabs(); wmPaintNav(); }
window.wmSetLegacy=async function(id,status,el){
  if(el) el.disabled=true;
  try{
    const {error}=await sb.rpc('ops_item_set_status',{p_id:id,p_status:status}); if(error) throw error;
    usageQueue('weekly_status.tick_an_action_item','update',{status:status});
    toast(status==='done'?'Closed — with your name on it':'Marked '+WM_LEGACY[status].toLowerCase(),'ok');
    await wmAfterWrite();
  }catch(e){ if(el) el.disabled=false; wmErr('Could not update',e); }
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
  }catch(e){ wmErr('Could not update the task',e); }
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
  }catch(e){ wmErr('Could not finish that',e); }
};

/* ---------- every pending task, across all meetings ---------- */
window.wmOpenAll=function(f){ if(WM.view!=='all'&&WM.view!=='board') WM.from=WM.view; WM.view='all'; WM.allF=f; wmRender(); window.scrollTo({top:0,behavior:'smooth'}); };
// Tasks: every task given in a meeting, across all meetings - Pending, To approve, Overdue - by meeting or
// by person, filtered by meeting kind and person.
function wmPaintAll(){
  clearInterval(WM.timer);
  const main=$('wmMain'); if(!main) return;
  const live=WM.items.filter(it=>!it.draft), n=k=>live.filter(it=>k==='pending'?wmOpen(it):k==='awaiting'?it.st==='awaiting':wmOverdue(it)).length;
  const kinds=[...new Set((WM.meetings||[]).map(m=>m.kind).filter(Boolean))];
  const keys=[...new Set(live.filter(wmOpen).flatMap(wmWhoKeys))].sort((x,y)=>wmKeyName(x)<wmKeyName(y)?-1:1);
  const L={pending:'Pending',awaiting:'To approve',overdue:'Overdue'};
  const sub={pending:'Everything not finished yet, oldest first.',awaiting:'Marked done by the person - only whoever gave the task can approve it.',overdue:'Open tasks past their due date.'};
  main.className='mt-col';
  main.innerHTML=`<div class="mt-ph"><div><h1>Tasks</h1><p>Every task given in a meeting. Tick one to finish it; click its meeting to open it.</p></div>
    <div class="mt-tabs" role="tablist">${['pending','awaiting','overdue'].map(k=>`<button class="mt-tab ${WM.allF===k?'on':''}" role="tab" aria-selected="${WM.allF===k}" onclick="WM.allF='${k}';wmRender()">${L[k]}<span class="mt-tn">${n(k)}</span></button>`).join('')}</div></div>
    <div class="mt-card"><div class="mt-htool"><div><b>${L[WM.allF]} · ${n(WM.allF)}</b><div class="mt-sub">${sub[WM.allF]}</div></div><div class="mt-hf">
      <select onchange="WM.allG=this.value;wmPaintAllList()" aria-label="Group"><option value="meeting" ${WM.allG==='meeting'?'selected':''}>By meeting</option><option value="person" ${WM.allG==='person'?'selected':''}>By person</option></select>
      <select onchange="WM.allMtg=this.value;wmPaintAllList()" aria-label="Meeting"><option value="">All meetings</option>${kinds.map(k=>`<option ${WM.allMtg===k?'selected':''}>${esc(k)}</option>`).join('')}</select>
      <select onchange="WM.allWho=this.value;wmPaintAllList()" aria-label="Person"><option value="">Everyone</option>${keys.map(k=>`<option value="${esc(k)}" ${WM.allWho===k?'selected':''}>${esc(wmKeyName(k))}</option>`).join('')}</select></div></div>
      <div class="wm-v6 mt-tasks" id="wmAllList"></div></div>`;
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
  const others=WM.people.filter(wmAssignable);
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
  // Same people, order and groups as Assign to; typing after @ narrows it by name or department.
  const q=m[1].toLowerCase(), hit=p=>!q||p.name.toLowerCase().replace(/\s+/g,'').includes(q)||(p.dept||'').toLowerCase().includes(q);
  const g=wmPeopleGroups(), inRoom=g.inRoom.filter(hit), rest=g.rest.filter(hit), list=inRoom.concat(rest);
  if(!list.length){ box.style.display='none'; return; }
  WM.sugIdx=Math.min(WM.sugIdx,list.length-1);
  const row=(p,i)=>`<div class="${i===WM.sugIdx?'on':''}" data-i="${i}" onmousedown="event.preventDefault();wmChoose('${esc(p.email)}')">${wmAvatar(p.name,26)} ${esc(p.name)}${wmIsMe(p.email)?' <b class="you">(you)</b>':''}<span>${esc(p.dept||'')}</span></div>`;
  box.innerHTML=(inRoom.length?`<p class="g">In this meeting</p>${inRoom.map((p,i)=>row(p,i)).join('')}${rest.length?'<p class="g">Everyone else</p>':''}`:'')+rest.map((p,i)=>row(p,i+inRoom.length)).join('');
  box.style.display='block'; box._list=list;
  const on=box.querySelector('div.on'); if(on) on.scrollIntoView({block:'nearest'});
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
  }catch(e){ wmErr('Could not finish that',e); }
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
      <span class="r">${ready?`<button class="wm-btn wm-sm wm-light" onclick="wmPromote(wmDrafts().filter(d=>(WM.draftMem[d.id]||[]).length).map(d=>d.id))">Create ${ready} ready</button>`:'<span class="wm-mute" style="font-size:12.5px;letter-spacing:0;text-transform:none">Give each one a person</span>'}</span></div>
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
       await wmReload(); wmPaintDrafts(); }catch(e){ wmErr('Could not set the date',e); }
};
window.wmDraftDue=async function(id,v){
  try{ const {error}=await sb.rpc('ops_item_set_due',{p_id:id,p_due:v||null}); if(error) throw error; await wmReload(); wmPaintDrafts(); }
  catch(e){ wmErr('Could not set the date',e); }
};
window.wmDraftText=async function(id,v){
  if(!String(v||'').trim()){ toast('Type a title','err'); wmPaintDrafts(); return; }
  try{ const {error}=await sb.rpc('ops_item_set_text',{p_id:id,p_item:v}); if(error) throw error; await wmReload(); }
  catch(e){ wmErr('Could not save',e); }
};
window.wmDraftDelete=async function(id){
  const d=(WM.items||[]).find(it=>it.id===id);
  if(!confirm('Remove "'+((d&&d.t)||'this line')+'"? It has no person yet, so nothing else is lost - but it cannot be brought back.')) return;
  try{ const {error}=await sb.rpc('ops_item_delete_draft',{p_id:id}); if(error) throw error; WM.sel.delete(id); delete WM.draftMem[id]; await wmReload(); wmPaintDrafts(); }
  catch(e){ wmErr('Could not remove',e); }
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
  }catch(e){ wmErr((made?made+' created, then could not create the rest':'Could not create the tasks'),e); }
  finally{ WM.busy=false; WM.tab='pending'; await wmReload(); wmCounts(); wmPaintDrafts(); wmPaintTabs(); wmPaintNav(); }
};

// One people picker for the typing line, one draft, or several drafts at once. Not yourself, unless you
// started this meeting (wmAssignable).
// The people a task in this meeting can go to, as both the @ list and Assign to show them: you first
// (only when you started the meeting), then the people in this meeting, then everyone else.
function wmPeopleGroups(){
  const m=wmMeeting(WM.cur), here=new Set(m&&m.attendees||[]);
  const all=WM.people.filter(wmAssignable).sort((a,b)=>wmIsMe(a.email)?-1:wmIsMe(b.email)?1:0);
  return {inRoom:all.filter(p=>here.has(p.name)), rest:all.filter(p=>!here.has(p.name))};
}
window.wmPickPeople=function(initial,title,onDone){
  const draft=new Set(initial||[]); window._wmPick=draft; window._wmPickDone=onDone;
  const {inRoom,rest}=wmPeopleGroups();
  const row=p=>`<label><input type="checkbox" ${draft.has(p.email)?'checked':''} onchange="this.checked?_wmPick.add('${esc(p.email)}'):_wmPick.delete('${esc(p.email)}')">${wmAvatar(p.name,26)} ${esc(p.name)}${wmIsMe(p.email)?' <b style="font-weight:600;color:#e0121c">(you)</b>':''}<span>${esc(p.dept||'')}</span></label>`;
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
  // Nothing unassigned: still ask once, so a stray click cannot end a running meeting.
  if(!force){
    let run=0; try{ const st=Number(localStorage.getItem('wm_start_'+m.id))||0; if(st) run=Math.max(1,Math.round((Date.now()-st)/60000)); }catch(e){}
    openModal(`<div class="modal-head"><h3>End ${esc(m.kind||'the meeting')}?</h3><span class="x" onclick="closeModal()">&times;</span></div>
      <div class="modal-body" style="font-size:14px;color:var(--slate);line-height:1.6">${run?'It has run '+run+' min. ':''}The timer stops and the meeting moves to History with its summary. You can reopen it later if needed.</div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">Keep going</button><button class="btn btn-primary" style="background:#e0121c;border-color:#e0121c" onclick="closeModal();wmEndMeeting(true)">End meeting</button></div>`);
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
  }catch(e){ if(btn) btn.disabled=false; wmErr('Could not end the meeting',e); return; }
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
  catch(e){ wmErr('Could not reopen it',e); }
};
// "12:40" in India time, for when a meeting ended.
function wmClock(ts){ try{ return new Date(ts).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''; } }

/* ---------- when something fails, and while something is working (UI/UX checklist, 24 Nov) ----------
   wmErr: every failure says what failed, why in plain words, and what to do next.
   wmBusy + the wrappers below: while Approve, Send back, ticking a task or ticking a note is being
   saved, that control dims, shows a busy cursor and ignores more clicks, so nothing is done twice. */
function wmErr(what,e){
  const raw=String((e&&e.message)||e||'').trim();
  let why=raw, fix='Try again. If it keeps failing, reload the page.';
  if(/failed to fetch|networkerror|network request|load failed|timeout|timed out/i.test(raw)){ why='JainE could not be reached'; fix='Check the internet connection, then try again.'; }
  else if(/jwt|expired|not authenticated|invalid claim|refresh token/i.test(raw)){ why='your sign-in has expired'; fix='Reload the page and sign in again.'; }
  else if(/only the person|or its editor|only the owner|not allowed|permission denied|cannot change/i.test(raw)){ fix='Ask whoever started the meeting, or one of its editors, to do it.'; }
  else if(/no longer exists|not found/i.test(raw)){ fix='Reload the page to see the latest.'; }
  else if(/duplicate|already/i.test(raw)){ fix='Reload the page - it may already be done.'; }
  toast(what+(why?': '+why.replace(/[.\s]+$/,''):'')+'. '+fix,'err');
}
function wmBusy(sel,on){ document.querySelectorAll(sel).forEach(function(el){ el.classList.toggle('wm-busy',on); el.setAttribute('aria-busy',on?'true':'false'); if('disabled' in el) el.disabled=on; }); }
(function(){
  const wrap=function(name,sel){ const fn=window[name]; if(typeof fn!=='function') return;
    window[name]=async function(){ const a=arguments, k=name+':'+a[0]; WM.busyK=WM.busyK||{}; if(WM.busyK[k]) return; WM.busyK[k]=1; const s=sel(a[0]); wmBusy(s,true);
      try{ return await fn.apply(this,a); } finally{ delete WM.busyK[k]; wmBusy(s,false); } }; };
  wrap('wmToggle',id=>'[onclick="wmToggle('+id+')"]');
  wrap('wmApprove',id=>'[onclick^="wmApprove('+id+',"]');
  wrap('wmNoteSolve',id=>'[onclick^="wmNoteSolve('+id+',"]');
  wrap('wmSetLegacy',id=>'[onchange^="wmSetLegacy('+id+',"]');
})();
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
  /* the meeting page (design C) */
  +'.wm-bd-top{max-width:1320px;margin:0 auto 14px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}.wm-bd-top h1{font-size:20px;font-weight:700;margin:0;color:var(--ink)}'
  +'.wm-back{border:1px solid var(--hair);background:#fff;border-radius:999px;padding:6px 12px;font:inherit;font-size:13px;font-weight:600;color:var(--ink2);cursor:pointer;display:inline-flex;align-items:center;gap:7px}.wm-back:hover{border-color:#cbd5e1;color:var(--ink)}'
  +'.wm-bd-stats{margin-left:auto;display:flex;background:#fff;border:1px solid var(--hair);border-radius:14px;overflow:hidden;box-shadow:var(--shadow)}'
  +'.wm-bd-stats div{padding:7px 16px;border-right:1px solid var(--hair2);text-align:center}.wm-bd-stats div:last-child{border-right:0}.wm-bd-stats b{display:block;font-size:17px;color:var(--ink)}.wm-bd-stats b.r{color:#e0121c}.wm-bd-stats b.a{color:#d97706}.wm-bd-stats span{font-size:11px;color:var(--mute)}'
  +'.wm-bd-strip{overflow:visible}.wm-bd-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap;padding:18px 22px 14px}'
  +'.wm-bd-head h2{font-size:26px;font-weight:700;letter-spacing:-.6px;color:var(--ink);margin:4px 0 0}.wm-bd-hl{min-width:0}'
  +'.wm-bd-ag{margin:0;border:0;border-top:1px solid var(--hair2);border-radius:0 0 20px 20px;padding:12px 22px 16px}'
  +'.wm-bd-agbar{display:flex;align-items:center;gap:10px 12px;flex-wrap:wrap}.wm-bd-agbar .wm-ag-ctl{margin-left:auto}.wm-bd-chips{display:flex;flex-wrap:wrap;gap:6px;flex:1 1 100%;min-width:0}'
  +'.wm-chip{flex:1 1 112px;position:relative;border:1px solid var(--hair);border-radius:12px;padding:7px 11px 8px;font-size:12px;color:var(--ink2);background:#fff;cursor:pointer;overflow:hidden;min-width:96px}'
  +'.wm-chip b{display:block;font-size:12.5px;color:var(--ink);white-space:nowrap}.wm-chip b i{font-size:10px;color:#16a34a}.wm-chip.d{opacity:.6}.wm-chip.v{box-shadow:0 0 0 2px #0b1220 inset}'
  +'.wm-chip.n{border-color:#e0121c;background:#fef2f2}.wm-chip.n b{color:#e0121c}.wm-chip.n em{font-style:normal;font-weight:800;color:#e0121c;font-variant-numeric:tabular-nums}'
  +'.wm-chip .bar{position:absolute;left:0;right:0;bottom:0;height:3px;background:#fde2e2}.wm-chip .bar span{display:block;height:100%;background:#e0121c;transition:width 1s linear}'
  +'.wm-chip .mn{width:40px;height:20px;border:1px solid transparent;border-radius:5px;background:transparent;font:inherit;font-size:12px;color:var(--mute);text-align:right;padding:0 3px;margin-right:2px}.wm-chip .mn:hover,.wm-chip .mn:focus{border-color:var(--hair);background:#fff;outline:none;color:var(--ink)}'
  +'.wm-bd-panel{border-left:0;padding-left:0;margin-top:12px}.wm-bd-panel .wm-ag-bigw{margin-bottom:10px}'
  +'.wm-bd-work{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px;margin-top:16px;align-items:start}.wm-bd-right{display:flex;flex-direction:column;gap:16px;min-width:0}'
  +'.wm-bd-col{overflow:hidden}.wm-bd-h{display:flex;justify-content:space-between;align-items:center;padding:13px 16px;border-bottom:1px solid var(--hair2);font-size:14px;font-weight:700;color:var(--ink)}.wm-bd-h i{color:var(--mute2);margin-right:6px}'
  +'.wm-bd-in{padding:4px 16px 16px}.wm-bd-in .wm-v6{border:0;padding:0;margin-top:8px}.wm-bd-in .wm-v6 .person{grid-template-columns:1fr;gap:6px}.wm-bd-in .wm-v6 .who{align-items:center}.wm-bd-in .wm-v6 .who br{display:none}.wm-bd-in .wm-v6 .who .cnt{margin:0 0 0 6px}.wm-bd-in .wm-dr{flex-wrap:wrap;gap:8px 14px}.wm-bd-in .wm-dr .ti{flex-basis:calc(100% - 40px)}.wm-bd-in .wm-sec{flex-wrap:wrap}.wm-bd-in .wm-cap-in input{font-size:16px}'
  +'.wm-bd-right .wm-oo{grid-template-columns:1fr}.wm-bd-right .wm-kt th input.h{width:96px}.wm-bd-right .wm-kt td input{width:84px}'
  +'.wm-bd-now{display:flex;align-items:baseline;gap:10px;margin-right:6px}.wm-bd-now span{font-size:12px;font-weight:600;color:var(--ink2)}.wm-bd-now b{font-size:30px;font-weight:800;letter-spacing:-1px;color:#e0121c;font-variant-numeric:tabular-nums;line-height:1}.wm-bd-now b.paused{color:var(--mute)}'
  +'.wm-bd-panel:empty{display:none}.wm-bd-note{margin-top:10px}.wm-bd-note .wm-ag-ta{min-height:70px}'
  +'.wm-bd-ag{padding:10px 22px 12px}.wm-bd-head{padding:14px 22px 10px}.wm-bd-head h2{font-size:24px}'
  +'.wm-bd-work{align-items:stretch}.wm-bd-act{display:flex;flex-direction:column;min-height:calc(100vh - 150px)}.wm-bd-act .wm-bd-in{flex:1 1 0;min-height:0;overflow-y:auto}.wm-bd-in .wm-v6 .person{padding:10px 0}'
  +'.wm-bd-in .wm-v6 > div[style*="margin-top:10px"]{display:none}'
  +'.wm-bd-right #wmKpiTxt{min-height:56px}.wm-kr-fold{margin-top:12px}.wm-kr-fold summary{cursor:pointer;font-size:12.5px;font-weight:600;color:var(--ink2);padding:6px 0;list-style:none}.wm-kr-fold summary::-webkit-details-marker{display:none}.wm-kr-fold summary i{color:var(--mute2);margin-right:6px}.wm-kr-fold[open] summary{margin-bottom:6px}'
  +'.wm-kpi-state{font-size:11.5px;font-weight:600;margin-left:8px;text-transform:none;letter-spacing:0;color:var(--mute)}.wm-kpi-state.ok{color:#16a34a}.wm-kpi-state.bad{color:#e0121c}.wm-kt td input.wm-bad{background:#fef2f2}'
  +'.wm-bd-in{padding:4px 14px 12px}.wm-bd-h{padding:11px 14px}.wm-bd-work{gap:14px;margin-top:14px}.wm-bd-right{gap:14px}'
  +'@media(max-width:1100px){.wm-bd-work{grid-template-columns:1fr}.wm-bd-act .wm-bd-in{max-height:none}}'
  +'@media(max-width:700px){.wm-bd-stats{margin-left:0;width:100%}.wm-bd-stats div{flex:1;padding:6px 8px}.wm-bd-head{padding:14px 16px}.wm-bd-ag{padding:12px 16px}.wm-bd-in .wm-v6 .person{grid-template-columns:1fr}}'
  /* the home page */
  +'.wm-head{max-width:1320px;margin:0 auto 14px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}'
  +'.wm-head h1{font-size:24px;font-weight:700;letter-spacing:-.4px;color:var(--ink);margin:0}'
  +'.wm-wkn{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:14px;color:var(--ink2);flex-wrap:wrap}.wm-wkn b{color:var(--ink);font-weight:600}'
  +'.wm-wkrel{font-size:11.5px;font-weight:700;color:#e0121c;background:#fef2f2;border-radius:6px;padding:1px 7px}'
  +'.wm-head-r{display:flex;gap:8px;flex-wrap:wrap}'
  +'.wm-ronote{max-width:1320px;margin:0 auto 12px;font-size:13px;color:#475569;background:#f1f4f9;border-radius:10px;padding:8px 12px}'
  +'.wm-sum{max-width:1320px;margin:0 auto 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}'
  +'.wm-sum-l{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.wm-sum-k{font-size:12px;font-weight:700;color:var(--mute);text-transform:uppercase;letter-spacing:.06em;margin-right:4px}'
  +'.wm-sc{display:inline-flex;align-items:baseline;gap:6px;border:1px solid var(--hair);background:#fff;border-radius:999px;padding:5px 12px;font:inherit;cursor:pointer;box-shadow:var(--shadow)}'
  +'.wm-sc:hover{border-color:#cbd5e1}.wm-sc b{font-size:15px;color:var(--ink)}.wm-sc span{font-size:12px;color:var(--mute)}'
  +'.wm-sc.aw b{color:#d97706}.wm-sc.od b{color:#e0121c}.wm-sc.ok b{color:#16a34a}.wm-sc.ob b{color:#d97706}'
  +'.wm-tl{max-width:1320px;margin:0 auto 16px}'
  +'.wm-tl-days{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}'
  +'.wm-tl-day{background:#fff;border:1px solid var(--hair);border-radius:16px;padding:8px;min-height:84px}.wm-tl-day.empty{background:transparent;border-style:dashed}'
  +'.wm-tl-day.today{border-color:#fca5a5}.wm-tl-dh{font-size:11.5px;color:var(--mute);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin:2px 4px 6px}.wm-tl-dh b{color:var(--ink);font-size:13px}.wm-tl-dh em{font-style:normal;color:#e0121c}'
  +'.wm-tlc{border:1px solid var(--hair);border-radius:12px;padding:8px 10px;cursor:pointer;background:#fff;margin-top:6px;transition:border-color .15s}.wm-tlc:hover{border-color:#cbd5e1}'
  +'.wm-tlc.on{border-color:#0b1220;box-shadow:0 0 0 1px #0b1220}'
  +'.wm-tlc-t{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--ink2);font-variant-numeric:tabular-nums}'
  +'.wm-tlc-k{font-size:13.5px;font-weight:700;color:var(--ink);margin-top:3px;line-height:1.25}.wm-tlc-k i{font-size:10px;color:var(--mute2)}'
  +'.wm-tlc-o{font-size:11.5px;color:var(--mute);margin-top:2px}'
  +'.wm-tlc-b{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:6px}.wm-tlc-ppl{display:flex;align-items:center}.wm-tlc-ppl .avatar-sm{margin-right:-4px;border:2px solid #fff}'
  +'.wm-tlc-ppl em{font-style:normal;font-size:11px;color:var(--mute);margin-left:8px}.wm-tlc-c{display:flex;gap:4px;font-size:11px}.wm-tlc-c b{border-radius:6px;padding:1px 6px;font-weight:700}.wm-tlc-c b.p{background:#fef2f2;color:#dc2626}.wm-tlc-c b.d{background:#f0fdf4;color:#15803d}.wm-tlc-c i{font-style:normal;color:var(--mute2)}'
  +'.wm-pill{font-size:10.5px;font-weight:700;border-radius:999px;padding:1px 8px;white-space:nowrap}.wm-pill.live{background:#fef2f2;color:#e0121c}.wm-pill.up{background:#eff4ff;color:#1d4ed8}.wm-pill.ended{background:#f0fdf4;color:#15803d}.wm-pill.held{background:#f1f4f9;color:#475569}'
  +'.wm-tl-empty{display:flex;align-items:center;gap:16px;flex-wrap:wrap;background:#fff;border:1px dashed var(--hair);border-radius:16px;padding:14px 16px;font-size:13.5px;color:var(--ink2)}'
  +'.wm-ws{max-width:1320px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:20px;align-items:start}'
  +'.wm-side{position:sticky;top:84px}.wm-ws.one{grid-template-columns:1fr}.wm-ws.one .wm-side{display:none}'
  +'.wm-det-h{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin-bottom:8px}.wm-det-h .wm-quiet{text-transform:none;letter-spacing:0;font-size:12px}'
  +'.wm-det-r{display:grid;grid-template-columns:96px 1fr;gap:8px;padding:6px 0;border-bottom:1px solid var(--hair2);font-size:13px}.wm-det-r>span{color:var(--mute)}.wm-det-r>div{color:var(--ink)}'
  +'.wm-ok-t{color:#15803d;font-weight:600}.wm-det-ppl{display:flex;flex-direction:column;gap:6px}.wm-det-ppl .people-chip{font-size:13px}.wm-det-ppl em{margin-left:auto;font-style:normal;font-size:11px;color:var(--mute);padding-left:10px}.wm-det-ppl em.ed{color:#fff;background:#0b1220;border-radius:6px;padding:1px 6px}'
  +'.wm-tabs-card{margin-top:18px}.wm-tabbar{display:flex;gap:4px;border-bottom:1px solid var(--hair);padding:0 16px;overflow-x:auto}'
  +'.wm-tab{border:0;background:none;font:inherit;font-size:14px;font-weight:700;color:var(--mute);padding:14px 10px 12px;cursor:pointer;position:relative;display:inline-flex;align-items:center;gap:8px;white-space:nowrap}'
  +'.wm-tab i{font-size:12px}.wm-tab .n{font-size:11px;font-weight:800;background:#f1f4f9;color:var(--mute);border-radius:9px;padding:1px 8px}.wm-tab .n.red{background:#fef2f2;color:#e0121c}.wm-tab .n.amb{background:#fffbeb;color:#b45309}'
  +'.wm-tab.on{color:var(--ink)}.wm-tab.on:after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:3px;border-radius:3px 3px 0 0;background:#e0121c}'
  +'.wm-tabbody{padding:4px 20px 20px}.wm-tabbody .wm-v6{border:0;padding:0;margin-top:0}'
  +'.wm-kt td .pv{display:block;font-size:11px;color:var(--mute2);padding:0 10px 6px;border-left:1px solid var(--hair2)}.wm-kt td .pv b{font-weight:700}.wm-kt td .pv b.up{color:#16a34a}.wm-kt td .pv b.dn{color:#e0121c}'
  +'.wm-oo-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:14px 0 12px}'
  +'.wm-fbs{display:inline-flex;border:1px solid var(--hair);border-radius:999px;padding:3px;background:#f8fafc}.wm-fb{border:0;background:none;font:inherit;font-size:12.5px;font-weight:600;color:var(--mute);padding:5px 12px;border-radius:999px;cursor:pointer}'
  +'.wm-fb span{font-size:11px;color:var(--mute2);margin-left:2px}.wm-fb.on{background:#0b1220;color:#fff}.wm-fb.on span{color:#cbd5e1}'
  +'.wm-nt .mt .by,.wm-v6 .task .mt .by{color:var(--mute)}.wm-nt .fr{cursor:pointer}.wm-v6 .aw-wait{font-size:11.5px;color:#b45309;margin-top:5px}'
  +'.wm-ag-go{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#f8fafc;border-radius:12px;padding:12px 14px;font-size:13.5px;color:var(--ink2)}'
  +'.wm-ed{border:0;background:none;color:var(--mute2);cursor:pointer;font-size:10.5px;padding:0 0 0 6px;opacity:0;transition:opacity .15s}.task:hover .wm-ed,.wm-nt:hover .wm-ed,.wm-ed:focus{opacity:1}.wm-ed:hover{color:var(--ink)}'
  +'.wm-nt .mt .wm-ed{padding:0}'
  +'.wm-addsec{display:flex;gap:22px;flex-wrap:wrap;margin-top:18px}'
  +'.wm-fp{border:1px solid var(--line);border-radius:10px;padding:8px}.wm-fp-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.wm-fp-chips .people-chip{font-size:12.5px}'
  +'.wm-fp-chip{gap:6px}.wm-fp-ed{border:1px solid var(--line);background:#fff;border-radius:6px;font:inherit;font-size:11px;font-weight:600;color:#64748b;padding:1px 6px;cursor:pointer;display:inline-flex;align-items:center;gap:4px}'
  +'.wm-fp-ed i{font-size:9px}.wm-fp-chip.ed .wm-fp-ed{background:#0b1220;border-color:#0b1220;color:#fff}.wm-fp-help{font-size:12px;color:var(--slate);margin-top:6px}'
  +'.wm-viewonly{display:inline-flex;align-items:center;gap:7px;margin-top:8px;font-size:12.5px;font-weight:600;color:#475569;background:#f1f4f9;border-radius:8px;padding:4px 10px}'
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
  +'.wm-sugg{position:absolute;left:0;top:58px;background:#fff;border:1px solid var(--hair);border-radius:14px;padding:6px;min-width:320px;max-height:340px;overflow-y:auto;z-index:6;box-shadow:var(--shadow-lg)}'
  +'.wm-sugg p.g{margin:0;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);font-weight:700;padding:10px 10px 4px}.wm-sugg b.you{font-weight:600;color:#e0121c}'
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
  +'@media(max-width:1100px){.wm-grid,.wm-grid.off,.wm-ws{grid-template-columns:1fr}.wm-rail,.wm-side{position:static}.wm-railfold{flex-direction:row}}'
  +'@media(max-width:700px){.wm{padding:6px 0 40px}.wm-top h1{font-size:30px}.wm-card-top,.wm-card-body{padding-left:18px;padding-right:18px}.wm-card-top h2{font-size:26px}'
    +'.wm-v6{padding:2px 14px 14px}.wm-v6 .person{grid-template-columns:1fr;gap:6px}.wm-v6 .sumrow{grid-template-columns:repeat(2,1fr)}.wm-v6 .tfilter{margin-left:0;width:100%}.wm-v6 .tfilter input{flex:1}.wm-dr{flex-wrap:wrap}.wm-oo{grid-template-columns:1fr}.wm-tabbody{padding:4px 12px 14px}.wm-head h1{font-size:21px}.wm-tl-days{grid-template-columns:1fr}.wm-mh-r{width:100%;justify-content:space-between}.wm-clock{align-items:flex-start}.wm-clock b{font-size:30px}.wm-ag-bigw .wm-ag-big{font-size:46px;letter-spacing:-1.5px}.wm-det-r{grid-template-columns:84px 1fr}.wm-ag-grid{grid-template-columns:1fr}.wm-ag-panel{border-left:0;padding-left:0}.wm-dr .ti{flex-basis:100%}}'
/* JainE-Meetings workspace: the handoff's colours, type and spacing (Manrope, purple #5B4BE8, borders not shadows) */
  +'.mt-shell{--p:#5B4BE8;--ph:#4A3AD6;--pt:#EDEBFE;--bg:#F5F6FA;--bd:#ECEEF3;--dv:#F1F2F6;--ib:#E3E5EC;--sf:#FAFAFD;--tx:#1C1F2E;--t2:#4A4F63;--t3:#6B7083;--t4:#7A8095;--t5:#9AA0B4;display:grid;grid-template-columns:232px minmax(0,1fr);background:var(--bg);border:0;border-radius:0;font-family:Manrope,system-ui,-apple-system,Segoe UI,sans-serif;color:var(--tx);min-height:calc(100vh - var(--topbar,64px))}'
  +'.view:has(#wmShell){padding:0!important}.wm:has(#wmShell){padding:0}'
  +'.mt-shell button,.mt-shell input,.mt-shell select,.mt-shell textarea{font-family:inherit}'
  +'@keyframes mtPulse{0%{box-shadow:0 0 0 0 rgba(229,72,77,.5)}100%{box-shadow:0 0 0 7px rgba(229,72,77,0)}}'
  +'.mt-side{background:#fff;border-right:1px solid var(--bd);border-radius:0;padding:20px 16px;display:flex;flex-direction:column;gap:2px;position:sticky;top:var(--topbar,64px);align-self:start;height:calc(100vh - var(--topbar,64px));box-sizing:border-box;overflow-y:auto}'
  +'.mt-logo{display:flex;align-items:center;gap:10px;padding:2px 4px 16px}.mt-logo .sq{width:34px;height:34px;border-radius:9px;background:var(--p);color:#fff;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none}.mt-logo b{font-size:16px;font-weight:700;letter-spacing:-.01em;white-space:nowrap}'
  +'.mt-sl{font-size:11px;font-weight:700;color:var(--t5);letter-spacing:.08em;text-transform:uppercase;padding:12px 12px 6px}'
  +'.mt-navs{display:flex;flex-direction:column;gap:4px}'
  +'.mt-nav{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:10px;border:0;background:transparent;color:var(--t2);font-size:14px;font-weight:600;cursor:pointer;text-align:left;width:100%}'
  +'.mt-nav i{width:18px;text-align:center;font-size:15px;flex:none}.mt-nav>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  +'.mt-nav:hover{background:var(--sf)}.mt-nav.on{background:var(--pt);color:var(--ph)}'
  +'.mt-nav .mt-cnt{flex:none;font-size:11.5px;font-weight:700;background:#EEF0F6;color:#5D6378;border-radius:20px;padding:1px 8px;display:inline-flex;align-items:center;gap:5px}'
  +'.mt-nav .mt-cnt.live{background:#FDECEC;color:#D63B41}.mt-nav .mt-cnt.live i{width:6px;height:6px;border-radius:50%;background:#E5484D;animation:mtPulse 1.6s infinite}'
  +'.mt-user{margin-top:auto;border:1px solid var(--bd);border-radius:12px;padding:12px;display:flex;align-items:center;gap:10px}.mt-user>div{min-width:0}.mt-user b{display:block;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mt-user span{font-size:12px;color:var(--t4)}'
  +'.mt-av{width:34px;height:34px;border-radius:50%;background:#E7E3FF;color:var(--p);font-size:12.5px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none}'
  +'.mt-main{min-width:0;display:flex;flex-direction:column}'
  +'.mt-shell{transition:grid-template-columns .2s ease}'
  +'.mt-fold{margin-left:auto;width:28px;height:28px;flex:none;border:1px solid var(--bd);border-radius:8px;background:#fff;color:var(--t4);cursor:pointer;font-size:11px;display:inline-flex;align-items:center;justify-content:center}.mt-fold:hover{border-color:var(--p);color:var(--p)}'
  +'.mt-shell.mini{grid-template-columns:72px minmax(0,1fr)}.mt-shell.mini .mt-side{padding:18px 10px;align-items:center}'
  +'.mt-shell.mini .mt-logo{flex-direction:column;gap:10px;padding:0 0 10px}.mt-shell.mini .mt-logo b,.mt-shell.mini .mt-nav>span:not(.mt-cnt),.mt-shell.mini .mt-user>div{display:none}.mt-shell.mini .mt-fold{margin:0}'
  +'.mt-shell.mini .mt-sl{font-size:0;padding:0;margin:10px 8px;height:1px;width:32px;background:var(--dv)}'
  +'.mt-shell.mini .mt-navs{align-items:center}.mt-shell.mini .mt-nav{width:48px;justify-content:center;padding:11px 0;position:relative}'
  +'.mt-shell.mini .mt-nav .mt-cnt{position:absolute;top:1px;right:-2px;padding:0 5px;font-size:10px;line-height:15px;border:2px solid #fff}.mt-shell.mini .mt-nav .mt-cnt.live i{display:none}'
  +'.mt-shell.mini .mt-user{border:0;padding:0;justify-content:center}'
  +'.mt-top{min-height:68px;background:#fff;border-bottom:1px solid var(--bd);border-radius:0;padding:0 28px;display:flex;align-items:center;justify-content:space-between;gap:16px;box-sizing:border-box}'
  +'.mt-search{position:relative;width:320px;max-width:40%;display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--bd);border-radius:10px;padding:9px 12px;color:var(--t5);font-size:13px}'
  +'.mt-search:focus-within{border-color:var(--p)}.mt-search input{border:0;background:transparent;outline:none;font-size:13px;color:var(--tx);flex:1;min-width:0;padding:0;height:auto}'
  +'.mt-res{position:absolute;left:0;top:calc(100% + 6px);width:440px;max-width:86vw;max-height:460px;overflow-y:auto;background:#fff;border:1px solid var(--bd);border-radius:12px;padding:6px;z-index:40;box-shadow:0 12px 32px rgba(28,31,46,.12)}'
  +'.mt-rg{font-size:11px;font-weight:700;color:var(--t5);letter-spacing:.08em;text-transform:uppercase;padding:10px 10px 4px}'
  +'.mt-ri{display:flex;gap:10px;align-items:flex-start;width:100%;border:0;background:none;text-align:left;padding:8px 10px;border-radius:8px;cursor:pointer;color:var(--tx)}.mt-ri:hover{background:var(--pt)}.mt-ri i{color:var(--p);margin-top:3px;width:14px;flex:none}.mt-ri>span{min-width:0}.mt-ri b{display:block;font-size:13px;font-weight:600}.mt-ri small{font-size:12px;color:var(--t4)}'
  +'.mt-rnone{padding:14px;font-size:13px;color:var(--t4)}'
  +'.mt-top-r{display:flex;align-items:center;gap:12px}.mt-date{font-size:13px;font-weight:500;color:var(--t3);white-space:nowrap}'
  +'.mt-btn{background:var(--p);color:#fff;border:0;border-radius:10px;padding:10px 16px;font-size:13px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:8px;white-space:nowrap;line-height:1.2}.mt-btn:hover{background:var(--ph)}'
  +'.mt-btn.sm{padding:8px 13px;font-size:12px;border-radius:8px}.mt-btn.ghost{background:#fff;color:#3A3F52;box-shadow:inset 0 0 0 1px var(--ib)}.mt-btn.ghost:hover{background:var(--sf)}.mt-btn.off{background:#F0F1F5;color:var(--t5)}.mt-btn.off:hover{background:#E8E9EF;color:var(--t3)}'
  +'.mt-neww{position:relative}.mt-menu{position:absolute;right:0;top:calc(100% + 6px);width:300px;background:#fff;border:1px solid var(--bd);border-radius:12px;padding:6px;z-index:40;box-shadow:0 12px 32px rgba(28,31,46,.12)}'
  +'.mt-menu button{display:flex;gap:12px;align-items:flex-start;width:100%;border:0;background:none;padding:10px;border-radius:8px;cursor:pointer;text-align:left}.mt-menu button:hover{background:var(--pt)}.mt-menu i{color:var(--p);margin-top:3px;width:14px}.mt-menu b{display:block;font-size:13.5px;color:var(--tx)}.mt-menu small{font-size:12px;color:var(--t4)}'
  +'.mt-bell{position:relative;width:40px;height:40px;flex:none;border:1px solid var(--bd);border-radius:10px;background:#fff;color:var(--t2);cursor:pointer;font-size:15px}.mt-bell:hover{border-color:var(--p);color:var(--p)}.mt-bell span.on{position:absolute;top:8px;right:9px;width:7px;height:7px;border-radius:50%;background:#E5484D}'
  +'.mt-content{padding:28px;display:flex;flex-direction:column;gap:22px;width:100%;box-sizing:border-box}'
  +'.mt-ph{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}.mt-ph h1{font-size:24px;font-weight:800;letter-spacing:-.02em;margin:0;color:var(--tx);line-height:1.2}.mt-ph p{font-size:14px;color:var(--t3);margin:6px 0 0}'
  +'.mt-ro{font-size:13px;color:var(--t2);background:#fff;border:1px solid var(--bd);border-radius:10px;padding:10px 14px}.mt-ro i{color:var(--p);margin-right:6px}'
  +'.mt-card{background:#fff;border:1px solid var(--bd);border-radius:14px;padding:20px;min-width:0}'
  +'.mt-ch{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}.mt-ch h3{font-size:16px;font-weight:700;margin:0;display:flex;align-items:center;gap:8px;color:var(--tx)}'
  +'.mt-lk{border:0;background:none;color:var(--p);font-size:13px;font-weight:700;cursor:pointer;padding:0;white-space:nowrap}.mt-lk:hover{color:var(--ph)}'
  +'.mt-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px}'
  +'.mt-stat span{display:block;font-size:13px;font-weight:600;color:var(--t3)}.mt-stat b{display:block;font-size:30px;font-weight:800;margin:6px 0 4px;letter-spacing:-.02em;line-height:1.1}.mt-stat em{font-style:normal;font-size:12px;font-weight:600}'
  +'.mt-two{display:grid;grid-template-columns:1.6fr 1fr;gap:16px;align-items:start}.mt-stack{display:flex;flex-direction:column;gap:16px;min-width:0}'
  +'.mt-sch{display:grid;grid-template-columns:74px 4px minmax(0,1fr) auto;gap:14px;align-items:center;padding:12px 0;border-top:1px solid var(--dv);cursor:pointer}.mt-ch+.mt-sch{border-top:0}'
  +'.mt-sch .t b{display:block;font-size:13px;font-weight:700}.mt-sch .t small{font-size:11px;color:var(--t5)}.mt-sch .bar{width:4px;height:36px;border-radius:4px}'
  +'.mt-sch .mid{min-width:0}.mt-sch .mid b{display:block;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mt-sch .mid small{font-size:12px;color:var(--t4)}.mt-sch:hover .mid b{color:var(--p)}'
  +'.mt-pill{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;border-radius:20px;padding:3px 10px;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box}'
  +'.mt-dot{width:7px;height:7px;border-radius:50%;background:#E5484D;animation:mtPulse 1.6s infinite;display:inline-block;flex:none}'
  +'.mt-live{background:var(--sf);border:1px solid #F0F1F6;border-radius:12px;padding:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px}.mt-live b{display:block;font-size:14px;font-weight:700}.mt-live small{font-size:12px;color:var(--t4)}'
  +'.mt-seg{display:flex;gap:2px;height:10px;border-radius:6px;overflow:hidden;margin:12px 0 14px}.mt-seg span{display:block;min-width:4px}'
  +'.mt-leg{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px}.mt-leg div{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2);min-width:0}.mt-leg i{width:8px;height:8px;border-radius:2px;flex:none}.mt-leg span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mt-leg b{color:var(--tx)}'
  +'.mt-acts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:4px}.mt-act{border:1px solid var(--bd);background:var(--sf);border-radius:12px;padding:12px;text-align:left;cursor:pointer}.mt-act:hover{border-color:var(--p)}.mt-act b{display:block;font-size:22px;font-weight:800;line-height:1.1}.mt-act span{font-size:12px;color:var(--t3);font-weight:600}'
  +'.mt-rc{display:grid;grid-template-columns:minmax(0,1fr) 150px 110px 130px;gap:12px;align-items:center;padding:12px 0;border-top:1px solid var(--dv);cursor:pointer;font-size:13px}.mt-ch+.mt-rc{border-top:0}.mt-rc small{font-size:12px;color:var(--t4)}.mt-rc:hover b{color:var(--p)}'
  +'.mt-trunc{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  +'.mt-empty{padding:18px 0;color:#8A90A4;font-size:13.5px;text-align:center}.mt-card.mt-empty{padding:28px 20px}'
  +'.mt-tabs{display:inline-flex;background:#fff;border:1px solid var(--bd);border-radius:10px;padding:4px;gap:2px;flex-wrap:wrap}.mt-tab{border:0;background:none;padding:7px 14px;border-radius:7px;font-size:13px;font-weight:600;color:var(--t2);cursor:pointer}.mt-tab:hover{color:var(--tx)}.mt-tab.on{background:var(--p);color:#fff}'
  +'.mt-upl{display:flex;flex-direction:column;gap:12px}.mt-day{font-size:12px;font-weight:700;color:#8A90A4;text-transform:uppercase;letter-spacing:.06em;margin:8px 0 -2px}.mt-day:first-child{margin-top:0}'
  +'.mt-up{display:grid;grid-template-columns:64px minmax(0,1fr) auto auto;gap:18px;align-items:center;padding:16px 18px}'
  +'.mt-up .tm{border-right:1px solid #F0F1F6;padding-right:10px}.mt-up .tm b{display:block;font-size:15px;font-weight:800}.mt-up .tm small{font-size:11px;font-weight:600;color:var(--t5)}'
  +'.mt-up .ti{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.mt-up .ti b{font-size:15px;font-weight:700;cursor:pointer}.mt-up .ti b:hover{color:var(--p)}'
  +'.mt-rep{font-size:12px;font-weight:600;color:var(--t4)}.mt-rep i{font-size:10px;margin-right:3px}'
  +'.mt-meta{font-size:12px;color:var(--t4);margin-top:5px;display:flex;gap:6px;flex-wrap:wrap}'
  +'.mt-cd{font-size:12px;font-weight:700;color:#8A90A4;white-space:nowrap}.mt-cd.soon{color:#C46E12}'
  +'.mt-btns{display:flex;gap:8px;flex-wrap:wrap}'
  +'.mt-runs{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}.mt-run{display:flex;flex-direction:column;gap:16px}'
  +'.mt-lb{display:inline-flex;align-items:center;gap:6px;background:#FDECEC;color:#D63B41;font-size:11px;font-weight:800;border-radius:20px;padding:3px 10px;letter-spacing:.04em}'
  +'.mt-run h3{font-size:17px;font-weight:700;margin:0}.mt-run .sub{font-size:13px;color:var(--t4);margin-top:4px}'
  +'.mt-tmr{display:flex;justify-content:space-between;align-items:baseline}.mt-tmr b{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums}.mt-tmr span{font-size:12px;color:var(--t4)}'
  +'.mt-prog{height:6px;border-radius:6px;background:#F0F1F6;overflow:hidden;margin-top:8px}.mt-prog span{display:block;height:100%;background:var(--p);transition:width 1s linear}.mt-prog span.hot{background:#E5484D}'
  +'.mt-now{background:var(--sf);border:1px solid #F0F1F6;border-radius:10px;padding:10px 12px;font-size:13px;color:var(--t2)}.mt-now b{color:var(--tx)}'
  +'.mt-rf{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.mt-avs{display:flex}.mt-avs span{width:30px;height:30px;border-radius:50%;border:2px solid #fff;margin-left:-6px;color:#fff;font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center}.mt-avs span:first-child{margin-left:0}.mt-rf em{font-style:normal;font-size:12px;color:var(--t4);flex:1;white-space:nowrap}'
  +'.mt-htool{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}.mt-htool>b{font-size:17px;font-weight:800}.mt-hf{display:flex;gap:8px;flex-wrap:wrap}'
  +'.mt-hf input,.mt-hf select{height:38px;border:1px solid var(--ib);border-radius:10px;padding:0 12px;font-size:13px;color:var(--tx);background:#fff;outline:none;box-sizing:border-box}.mt-hf input{width:260px}.mt-hf input:focus,.mt-hf select:focus{border-color:var(--p)}'
  +'.mt-tw{overflow-x:auto}.mt-tbl{min-width:720px}'
  +'.mt-tr{display:grid;grid-template-columns:minmax(140px,2.2fr) 104px 70px 60px minmax(90px,1fr) 120px 72px;gap:8px;align-items:center;padding:13px 14px;border-bottom:1px solid var(--dv);font-size:13px}'
  +'.mt-th{background:#F6F7FA;border-radius:10px;border-bottom:0;font-size:12px;font-weight:700;color:var(--t3);padding:10px 14px}.mt-tr:not(.mt-th):hover{background:var(--sf)}'
  +'.mt-tr .nm{display:flex;align-items:center;gap:10px;min-width:0;cursor:pointer}.mt-tr .nm i.sw{width:8px;height:8px;border-radius:50%;flex:none}.mt-tr .nm b{display:block;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mt-tr .nm small{display:block;font-size:11.5px;color:var(--t4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mt-tr .nm:hover b{color:var(--p)}'
  +'.mt-tr .dt small{display:block;color:var(--t5);font-size:12px}'
  +'.mt-ia{display:flex;gap:6px}.mt-ib{width:30px;height:30px;border-radius:8px;border:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:12.5px}.mt-ib.dl{background:var(--pt);color:var(--p)}.mt-ib.dl:hover{background:#E0DCFD}.mt-ib.sm{background:var(--p);color:#fff}.mt-ib.sm:hover{background:var(--ph)}'
  /* the meeting page inside the workspace: same panels, the workspace's colours */
  +'.mt-shell .wm-bd-top{max-width:none;margin:0}.mt-shell .wm-ronote{max-width:none;margin:0}'
  +'.mt-shell .wm-card,.mt-shell .wm-box{border-radius:14px;box-shadow:none;border-color:var(--bd)}'
  +'.mt-shell .wm-bd-stats{box-shadow:none;border-color:var(--bd);border-radius:12px}'
  +'.mt-shell .wm-back{border-radius:10px;border-color:var(--bd);color:var(--t2);font-weight:700}.mt-shell .wm-back:hover{border-color:var(--p);color:var(--p)}'
  +'.mt-shell .wm-light{background:var(--p)}.mt-shell .wm-light:hover{background:var(--ph)}'
  +'.mt-shell .wm-line:hover{box-shadow:inset 0 0 0 1px var(--p)}'
  +'.mt-shell .wm-v6 .ttab.on:after{background:var(--p)}.mt-shell .wm-v6 .ttab.on .n{background:var(--p)}'
  +'.mt-shell .wm-chip.v{box-shadow:0 0 0 2px var(--p) inset}'
  +'.mt-shell .wm-fb.on{background:var(--p)}'
  +'.mt-shell .wm-cap-in:focus-within{border-bottom-color:var(--p)}'
  +'.mt-shell .wm-v6 .task .from,.mt-shell .wm-nt .fr{color:var(--p)}'
  +'.mt-shell .wm-v6{border-color:var(--bd)}'
  +'.mt-shell .wm-bd-act{min-height:calc(100vh - 250px)}'
  +'.mt-shell .wm-bd-work{margin-top:16px}'
  +'.mt-shell .wm-rs{font-size:12.5px;color:var(--p);font-weight:700}'
  +'.wm-oo-box.wm-td-box{border-left:3px solid #5B4BE8;background:#fafaff}.wm-oo-box.wm-td-box.trying{border-left-color:#3767DB;background:#f7f9ff}'
  +'@media(max-width:1180px){.mt-two{grid-template-columns:1fr}}'
  +'@media(max-width:900px){.mt-shell,.mt-shell.mini{grid-template-columns:minmax(0,1fr)}.mt-fold{display:none}.mt-shell.mini .mt-side{padding:12px;align-items:center}.mt-shell.mini .mt-logo{flex-direction:row;padding:0 4px}.mt-shell.mini .mt-logo b,.mt-shell.mini .mt-nav>span{display:inline}.mt-shell.mini .mt-sl{display:none}.mt-shell.mini .mt-navs{align-items:stretch}.mt-shell.mini .mt-nav{width:auto;padding:8px 10px}.mt-shell.mini .mt-nav .mt-cnt{position:static;border:0}.mt-side{position:static;height:auto;border-right:0;border-bottom:1px solid var(--bd);border-radius:0;padding:12px;flex-direction:row;flex-wrap:wrap;align-items:center;gap:6px;overflow:visible}.mt-logo{padding:0 4px}.mt-sl,.mt-user{display:none}.mt-navs{flex-direction:row;overflow-x:auto;width:100%;gap:4px}.mt-nav{width:auto;flex:none;padding:8px 10px}.mt-top{padding:12px 16px;flex-wrap:wrap;border-radius:0}.mt-search{width:100%;max-width:none}.mt-content{padding:16px}.mt-up{grid-template-columns:56px minmax(0,1fr);gap:12px}.mt-up>.mt-cd,.mt-up>.mt-btns,.mt-up>span{grid-column:2}.mt-rc{grid-template-columns:minmax(0,1fr) auto}.mt-rc>span:nth-child(2),.mt-rc .hide{display:none}.mt-hf,.mt-hf input{width:100%}.mt-runs{grid-template-columns:1fr}}'
  +'@media(max-width:560px){.mt-date{display:none}.mt-top-r{width:100%;justify-content:space-between}.mt-stats{grid-template-columns:1fr 1fr;gap:10px}.mt-stat b{font-size:24px}.mt-card{padding:16px}.mt-res{width:calc(100vw - 48px)}}'
+'/* agenda on the meeting page, 24 Nov: a header line, numbered tiles in an even grid, + Add step */'
  +'.wm-agh{display:flex;align-items:center;justify-content:space-between;gap:10px 14px;flex-wrap:wrap;margin-bottom:10px}'
  +'.wm-agh-l{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.wm-agh-l b{font-size:14px;color:var(--ink)}.wm-agh-l b i{color:#5B4BE8;margin-right:4px}.wm-agh-l span{font-size:12.5px;color:var(--mute)}'
  +'.wm-agh .wm-ag-ctl{margin-left:auto}'
  +'.wm-bd-chips{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;flex:none}'
  +'.wm-chip{display:flex;align-items:flex-start;gap:9px;padding:9px 10px 10px;min-width:0;transition:border-color .15s,background .15s}.wm-chip:hover{border-color:#cfd3dc}'
  +'.wm-chip .no{width:20px;height:20px;flex:none;border-radius:50%;background:#F0F1F5;color:#6B7083;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:1px}'
  +'.wm-chip.d{opacity:.75}.wm-chip.d .no{background:#E3F6EC;color:#1E8A55}.wm-chip.d .no i{font-size:9px;color:#1E8A55}.wm-chip.n .no{background:#e0121c;color:#fff}'
  +'.wm-chip .tx{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}.wm-chip .tx b{overflow:hidden;text-overflow:ellipsis}.wm-chip .tx>span{font-size:12px;color:var(--mute)}'
  +'.wm-chip.nx{border-color:#C9C2FA}.wm-chip .nxl{font-style:normal;font-weight:700;color:#5B4BE8}'
  +'.wm-chip .x{position:absolute;top:4px;right:4px;width:20px;height:20px;border:0;border-radius:6px;background:none;color:var(--mute2);cursor:pointer;font-size:11px;opacity:0}.wm-chip:hover .x,.wm-chip .x:focus{opacity:1}.wm-chip .x:hover{color:#e0121c;background:#fef2f2}'
  +'.wm-chip-add{border:1.5px dashed #D5D8E2;background:#fff;color:#5B4BE8;font:inherit;font-weight:700;font-size:12.5px;border-radius:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;min-height:48px}.wm-chip-add:hover{border-color:#5B4BE8;background:#F7F6FF}'
  +'.wm-bd-panel{margin-top:10px}'
  +'/* the agenda in the form: move, rename and remove steps; add your own */'
  +'.wm-agf-row{grid-template-columns:20px 18px minmax(0,1fr) auto auto}'
  +'.wm-agf-row .mv{display:inline-flex;align-items:center;gap:1px}.wm-agf-row .mv button{width:24px;height:26px;border:0;background:none;color:#94a3b8;cursor:pointer;border-radius:6px;font-size:11px;padding:0}'
  +'.wm-agf-row .mv button:hover:not(:disabled){background:#f1f4f9;color:#0b1220}.wm-agf-row .mv button:disabled{opacity:.25;cursor:default}.wm-agf-row .mv button.del:hover{color:#e0121c;background:#fef2f2}.wm-agf-row .mv .sp{width:24px}'
  +'.frm .wm-agf-row input.wm-agf-nm{width:100%;max-width:260px;height:28px;margin:0;border:1px solid transparent;border-radius:6px;padding:0 6px;font-size:13.5px;font-weight:600;color:#0b1220;background:#F7F6FF;box-shadow:none}.frm .wm-agf-row input.wm-agf-nm:focus{border-color:#5B4BE8;background:#fff;outline:none}'
  +'.wm-agf-row.own .ic{color:#5B4BE8}.wm-agf-row.on.own .ck{background:#5B4BE8;border-color:#5B4BE8}'
  +'.wm-agf-add{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--line-2);background:#fcfcff}.wm-agf-add>i{color:#5B4BE8;font-size:12px;width:20px;text-align:center;flex:none}'
  +'.frm .wm-agf-add input{margin:0;height:32px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font-size:13px;box-shadow:none}.frm .wm-agf-add #wmAgNewName{flex:1;min-width:0;width:auto}.frm .wm-agf-add #wmAgNewMins{width:58px;flex:none;text-align:center;padding:0 4px}'
  +'.wm-agf-add small{font-size:11.5px;color:#94a3b8}.wm-agf-addbtn{height:32px;flex:none;border:0;border-radius:8px;background:#5B4BE8;color:#fff;font:inherit;font-size:12.5px;font-weight:700;padding:0 12px;cursor:pointer}.wm-agf-addbtn:hover{background:#4A3AD6}'
  +'@media(max-width:560px){.wm-agf-row{grid-template-columns:20px minmax(0,1fr) auto auto;gap:8px;padding:8px}.wm-agf-row .ic{display:none}.wm-agf-row .mv button{width:22px}.wm-bd-chips{grid-template-columns:repeat(2,minmax(0,1fr))}.wm-agf-add{flex-wrap:wrap}}'
+'/* UI and UX pass, 24 Nov */'
  +'.mt-shell button:focus-visible,.mt-shell input:focus-visible,.mt-shell select:focus-visible,.mt-shell textarea:focus-visible,.mt-shell [tabindex]:focus-visible{outline:2px solid #5B4BE8;outline-offset:2px}'
  +'button.mt-stat{text-align:left;font:inherit;color:inherit;cursor:pointer;transition:border-color .15s}button.mt-stat:hover{border-color:#C9C2FA}'
  +'.mt-col{display:flex;flex-direction:column;gap:22px}'
  +'.mt-tab .mt-tn{font-size:11px;font-weight:800;background:#EEF0F6;color:#5D6378;border-radius:20px;padding:1px 7px;margin-left:6px}.mt-tab.on .mt-tn{background:rgba(255,255,255,.25);color:#fff}'
  +'.mt-htool b{font-size:17px;font-weight:800}.mt-sub{font-size:12.5px;color:var(--t3);margin-top:2px}'
  +'.mt-tasks.wm-v6{border:0;border-radius:0;padding:0;margin:0}.mt-tasks.wm-v6 .grp:first-child{margin-top:4px}'
  +'.mt-shell .wm-v6 .ttab.on.pend .n{background:var(--p)}.mt-shell .wm-v6 .task .bx:hover{border-color:var(--p)}'
  +'.mt-shell .wm-bd-head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:14px 24px}'
  +'.mt-shell .wm-bd-head .wm-mh-r{flex-wrap:nowrap;gap:14px;padding-top:4px}'
  +'.mt-shell .wm-clock b{font-size:30px;letter-spacing:-1px;margin:3px 0}.mt-shell .wm-clock span{font-size:10.5px}'
  +'.mt-shell .wm-bd-head h2{display:flex;align-items:center;gap:4px}'
  +'.mt-shell .wm-mh2{gap:8px 18px}'
  +'.wm-fh{cursor:pointer;user-select:none}.wm-fh:hover{background:#FAFAFD}.wm-fh-r{display:inline-flex;align-items:center;gap:10px}'
  +'.wm-fh-n{font-size:11.5px;font-weight:700;color:#5D6378;background:#EEF0F6;border-radius:20px;padding:1px 8px}'
  +'.wm-fold{width:26px;height:26px;border:0;border-radius:8px;background:none;color:var(--mute2);cursor:pointer;font-size:11px}.wm-fold:hover{background:#EEF0F6;color:var(--ink)}'
  +'.wm-bd-col.folded .wm-bd-in{display:none}.wm-bd-col.folded .wm-bd-h{border-bottom:0}'
  +'.wm-kpi-grey{font-size:12px;color:var(--mute);margin-top:8px}'
  +'.wm-bd-right .wm-kt th.add{padding:0 8px}.wm-bd-right .wm-kt th.add .lbl{display:none}.wm-bd-right .wm-kt th.add .wm-quiet{width:26px;height:26px;justify-content:center;border-radius:7px;background:#EDEBFE;color:#5B4BE8}.wm-bd-right .wm-kt td.p{max-width:116px;overflow:hidden;white-space:nowrap}.wm-bd-right .wm-kt th:first-child{max-width:116px}'
  +'.wm-bd-h .wm-kpi-state{margin-left:0}'
  +'.wm-bd-right .wm-kt th input.h{width:100%;min-width:72px;padding:8px 18px 8px 8px;font-size:12px;box-sizing:border-box}.wm-bd-right .wm-kt td input{width:100%;min-width:60px;box-sizing:border-box}.wm-bd-right .wm-kt th.add .wm-quiet{font-size:12px;white-space:nowrap}'
  +'/* the meetings forms and pop-ups, while JainE-Meetings is open: its font and purple */'
  +'body:has(#wmShell) #modalHost .modal{font-family:Manrope,system-ui,-apple-system,Segoe UI,sans-serif;border-radius:16px}'
  +'body:has(#wmShell) #modalHost .btn-primary{background:#5B4BE8;border-color:#5B4BE8}body:has(#wmShell) #modalHost .btn-primary:hover{background:#4A3AD6;border-color:#4A3AD6}'
  +'body:has(#wmShell) #modalHost .frm input:focus,body:has(#wmShell) #modalHost .frm select:focus,body:has(#wmShell) #modalHost .frm textarea:focus{border-color:#5B4BE8;box-shadow:0 0 0 3px #EDEBFE;outline:none}'
  +'body:has(#wmShell) #modalHost .wm-agf-row.on .ck{background:#5B4BE8;border-color:#5B4BE8}body:has(#wmShell) #modalHost .wm-fp-chip.ed .wm-fp-ed{background:#5B4BE8;border-color:#5B4BE8}'
  +'body:has(#wmShell) #modalHost .frm.wm-ntm label.pp input,body:has(#wmShell) #modalHost .wm-pk input{accent-color:#5B4BE8}'
  +'body:has(#wmShell) #modalHost .modal-body.frm>label{font-size:13px;font-weight:700;color:#1C1F2E;margin-top:16px}'
  +'@media(max-width:700px){.mt-shell .wm-bd-head{grid-template-columns:1fr}.mt-shell .wm-bd-head .wm-mh-r{justify-content:space-between}}'
+'/* less clutter on the meeting page, 24 Nov */'
  +'.wm-crumb{border:0;background:none;padding:0;margin:0 0 6px;font:inherit;font-size:12.5px;font-weight:700;color:#7A8095;cursor:pointer;display:inline-flex;align-items:center;gap:6px}.wm-crumb:hover{color:#5B4BE8}.wm-crumb i{font-size:11px}'
  +'.mt-shell .wm-clock{flex-direction:row;align-items:baseline;gap:8px}.mt-shell .wm-clock small{display:none}.mt-shell .wm-clock span{font-size:11px}.mt-shell .wm-clock b{font-size:22px;margin:0;color:var(--t2)}'
  +'.mt-shell .wm-bd-head{padding:16px 22px 12px}.mt-shell .wm-bd-head h2{font-size:22px}'
  +'.mt-shell .wm-mh2{margin-top:6px!important;font-size:12.5px}.mt-shell .wm-mh2 .wm-quiet,.mt-shell .wm-mh2 .wm-hsel,.mt-shell .wm-mh2 .wm-rep{font-size:12.5px}'
  +'.wm-bd-h .wm-bd-stats{display:inline-flex;gap:6px;margin:0;border:0;background:none;box-shadow:none;border-radius:0;overflow:visible;flex-wrap:wrap}'
  +'.wm-bd-h .wm-bd-stats div{display:inline-flex;align-items:baseline;gap:4px;padding:2px 9px;border:0;border-radius:20px;background:#F0F1F5;text-align:left}'
  +'.wm-bd-h .wm-bd-stats b{display:inline;font-size:12px;color:#4A4F63}.wm-bd-h .wm-bd-stats b.a{color:#C46E12}.wm-bd-h .wm-bd-stats b.r{color:#D63B41}.wm-bd-h .wm-bd-stats span{font-size:11.5px;color:#7A8095;font-weight:600}'
  +'.mt-shell .wm-bd-ag{padding:12px 22px 14px}'
  +'.wm-agnow{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:6px 18px;background:#FAFAFD;border:1px solid #ECEEF3;border-radius:12px;padding:12px 16px 14px;overflow:hidden}'
  +'.wm-agnow .l{min-width:0;display:flex;flex-direction:column;gap:2px}.wm-agnow .k{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#D63B41;display:inline-flex;align-items:center;gap:6px}'
  +'.wm-agnow .k .dot{width:7px;height:7px;border-radius:50%;background:#E5484D;animation:mtPulse 1.6s infinite;display:inline-block}'
  +'.wm-agnow .l b{font-size:17px;font-weight:800;color:#1C1F2E;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wm-agnow .sub{font-size:12.5px;color:#7A8095;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  +'.wm-agnow .cd{font-size:40px;font-weight:800;letter-spacing:-1.5px;color:#D63B41;font-variant-numeric:tabular-nums;line-height:1}'
  +'.wm-agnow .bar{position:absolute;left:0;right:0;bottom:0;height:4px;background:#F0E3E4}.wm-agnow .bar span{display:block;height:100%;background:#E5484D;transition:width 1s linear}'
  +'.wm-agnow.paused .k{color:#7A8095}.wm-agnow.paused .cd{color:#9AA0B4}.wm-agnow.paused .bar span{background:#C9CCD6}'
  +'.wm-agnow.idle{grid-template-columns:minmax(0,1fr) auto}.wm-agnow.idle .k{color:#5B4BE8}.wm-agnow.idle .l b{font-size:15px}'
  +'.wm-agnow .wm-ag-ctl{display:flex;align-items:center;gap:6px;margin:0}'
  +'.mt-shell .wm-agnow .wm-red{background:#5B4BE8}.mt-shell .wm-agnow .wm-red:hover{background:#4A3AD6}'
  +'.wm-agedit{height:32px;border:1px solid #E3E5EC;border-radius:10px;background:#fff;color:#4A4F63;font:inherit;font-size:12.5px;font-weight:700;padding:0 11px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;margin-left:4px;white-space:nowrap}.wm-agedit:hover{border-color:#5B4BE8;color:#5B4BE8}'
  +'.wm-agpills{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}'
  +'.wm-agp{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 10px 0 5px;border:1px solid #ECEEF3;border-radius:20px;background:#fff;font:inherit;font-size:12.5px;font-weight:600;color:#4A4F63;cursor:pointer;max-width:220px}'
  +'.wm-agp:hover{border-color:#C9C2FA}.wm-agp .no{width:22px;height:22px;flex:none;border-radius:50%;background:#F0F1F5;color:#6B7083;font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center}'
  +'.wm-agp .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wm-agp em{font-style:normal;font-size:11.5px;color:#9AA0B4;font-weight:600;font-variant-numeric:tabular-nums}'
  +'.wm-agp.d{color:#9AA0B4}.wm-agp.d .no{background:#E3F6EC;color:#1E8A55}.wm-agp.d .no i{font-size:9px}'
  +'.wm-agp.n{border-color:#F3B9BC;background:#FDECEC;color:#1C1F2E}.wm-agp.n .no{background:#E5484D;color:#fff}.wm-agp.n em{color:#D63B41;font-weight:800}'
  +'.wm-agp.v{border-color:#5B4BE8;box-shadow:0 0 0 1px #5B4BE8 inset}'
  +'.mt-shell .wm-clock b{white-space:nowrap}.wm-bd-h:has(.wm-bd-stats){flex-wrap:wrap;gap:6px 10px}'
  +'@media(max-width:700px){.mt-shell .wm-clock span{display:none}.wm-bd-h .wm-bd-stats{width:auto;margin:0}.wm-bd-h .wm-bd-stats div{flex:none;padding:2px 8px}}'
  +'@media(max-width:900px){.wm-agnow{grid-template-columns:minmax(0,1fr) auto}.wm-agnow .wm-ag-ctl{grid-column:1/-1;flex-wrap:wrap}.wm-agnow .cd{font-size:32px}}'
+'/* one work area with tabs, 24 Nov */'
  +'.wm-bd-ws{margin-top:16px;overflow:visible}'
  +'.wm-ws-cap{margin:0;padding:14px 20px 4px}.wm-ws-cap .wm-cap-in{padding-bottom:10px;gap:10px}.wm-ws-cap .wm-cap-in input{font-size:16px;height:34px}.wm-cap-ic{color:#5B4BE8;font-size:13px}'
  +'.wm-ws-cap .wm-parsed{margin-top:6px}.wm-ws-cap .wm-parsed:empty{display:none}'
  +'.wm-wtabs{display:flex;align-items:center;gap:2px;padding:0 14px;border-bottom:1px solid #ECEEF3;flex-wrap:wrap}'
  +'.wm-wtab{border:0;background:none;font:inherit;font-size:13.5px;font-weight:700;color:#6B7083;padding:12px 10px 11px;cursor:pointer;position:relative;display:inline-flex;align-items:center;gap:7px;white-space:nowrap}'
  +'.wm-wtab i{font-size:12px;color:#9AA0B4}.wm-wtab em{font-style:normal;font-size:11px;font-weight:800;background:#EEF0F6;color:#5D6378;border-radius:20px;padding:1px 7px}'
  +'.wm-wtab:hover{color:#1C1F2E}.wm-wtab.on{color:#1C1F2E}.wm-wtab.on i{color:#5B4BE8}.wm-wtab.on em{background:#EDEBFE;color:#4A3AD6}'
  +'.wm-wtab.on:after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:3px;border-radius:3px 3px 0 0;background:#5B4BE8}'
  +'.wm-wtabs .wm-bd-stats{margin-left:auto;padding:6px 0}'
  +'.wm-wpane{display:none}.wm-wpane.on{display:block}'
  +'.wm-wtabs .wm-bd-stats{display:inline-flex;gap:6px;border:0;background:none;box-shadow:none;border-radius:0;overflow:visible;flex-wrap:wrap}.wm-wtabs .wm-bd-stats div{display:inline-flex;align-items:baseline;gap:4px;padding:2px 9px;border:0;border-radius:20px;background:#F0F1F5;text-align:left;flex:none}'
  +'.wm-wtabs .wm-bd-stats b{display:inline;font-size:12px;color:#4A4F63}.wm-wtabs .wm-bd-stats b.a{color:#C46E12}.wm-wtabs .wm-bd-stats b.r{color:#D63B41}.wm-wtabs .wm-bd-stats span{font-size:11.5px;color:#7A8095;font-weight:600}'
  +'.wm-bd-ws .wm-bd-in{padding:6px 20px 18px}'
  +'.wm-bd-ws .wm-fh{padding:0;border:0;min-height:0;background:none;cursor:default;justify-content:flex-end}.wm-bd-ws .wm-fh>span:first-child,.wm-bd-ws .wm-fh .wm-fh-n,.wm-bd-ws .wm-fold{display:none}'
  +'.wm-bd-ws .wm-fh .wm-kpi-state:not(:empty){position:absolute;right:20px;margin-top:10px}'
  +'.wm-bd-ws .wm-bd-col{position:relative}.wm-bd-ws .wm-bd-col.folded .wm-bd-in{display:block}'
  +'.wm-bd-ws .wm-wpane .wm-bd-in .wm-v6 .person{grid-template-columns:190px minmax(0,1fr);gap:14px;padding:12px 0}'
  +'.wm-bd-ws .wm-wpane .wm-bd-in .wm-v6 .who{align-items:flex-start}.wm-bd-ws .wm-wpane .wm-bd-in .wm-v6 .who br{display:block}.wm-bd-ws .wm-wpane .wm-bd-in .wm-v6 .who .cnt{margin:4px 6px 0 0}'
  +'.wm-bd-ws .wm-v6 .ttabs{border-bottom:0;gap:4px;margin:8px 0 6px;align-items:center}'
  +'.wm-bd-ws .wm-v6 .ttab{padding:5px 12px;margin:0;border-radius:20px;font-size:12.5px;background:#F5F6FA;color:#6B7083}.wm-bd-ws .wm-v6 .ttab:after{display:none}'
  +'.wm-bd-ws .wm-v6 .ttab.on{background:#EDEBFE;color:#4A3AD6}.wm-bd-ws .wm-v6 .ttab .n{background:#fff}.wm-bd-ws .wm-v6 .ttab.on .n,.wm-bd-ws .wm-v6 .ttab.on.pend .n,.wm-bd-ws .wm-v6 .ttab.on.fin .n{background:#5B4BE8;color:#fff}'
  +'.wm-bd-ws .wm-v6 .tfilter select,.wm-bd-ws .wm-v6 .tfilter input{height:30px;border-color:#ECEEF3;border-radius:8px;background:#FAFAFD}'
  +'.mt-shell .wm-v6 .task .mt .by{display:none}.mt-shell .wm-v6 .task .mt{gap:8px}'
  +'.mt-shell .wm-v6 .wm-st-sel{border:0;background:#F0F1F5;border-radius:20px;height:24px;font-weight:700;color:#5D6378;padding:0 6px}'
  +'.wm-bd-ws .wm-oo{gap:12px}.wm-bd-ws .wm-kt-wrap{margin-top:12px}'
  +'.wm-wtab .sh{display:none}'
  +'@media(max-width:900px){.wm-wtab .lg{display:none}.wm-wtab .sh{display:inline}.wm-wtab{padding:12px 6px 11px;gap:4px;font-size:13px}.wm-wtab.on:after{left:4px;right:4px}.wm-ws-cap .kbd{display:none}.wm-wtabs{flex-wrap:wrap}.wm-bd-ws .wm-wpane .wm-bd-in .wm-v6 .person{grid-template-columns:1fr}.wm-bd-ws .wm-bd-in{padding:6px 14px 14px}.wm-ws-cap{padding:12px 14px 4px}.wm-wtabs{padding:0 6px}.wm-wtabs .wm-bd-stats{width:100%;margin:0;padding:6px 6px 8px}}'
+'/* the top of the meeting, cleaned up: two lines, a More menu, a flat Now area, one bar of steps */'
  +'.wm-hd2 .wm-t1{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}'
  +'.wm-hd2 h2{margin:0!important;font-size:22px!important;line-height:1.2}'
  +'.wm-backb{width:30px;height:30px;flex:none;border:1px solid #ECEEF3;border-radius:9px;background:#fff;color:#6B7083;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;justify-content:center}.wm-backb:hover{border-color:#5B4BE8;color:#5B4BE8}'
  +'.wm-stag{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;border-radius:20px;padding:3px 10px;background:#F0F1F5;color:#5D6378;white-space:nowrap}'
  +'.wm-stag.live{background:#FDECEC;color:#D63B41}.wm-stag.live .dot{width:7px;height:7px;border-radius:50%;background:#E5484D;animation:mtPulse 1.6s infinite;display:inline-block}'
  +'.wm-stag.ok{background:#E3F6EC;color:#1E8A55}.wm-stag.up{background:#EDEBFE;color:#4A3AD6}.wm-reopen{font-size:12.5px;text-decoration:underline}'
  +'.wm-reptag{color:#9AA0B4;font-size:12px}'
  +'.mt-shell .wm-hd2 .wm-t2{margin:6px 0 0 40px!important}.wm-hd2 .wm-viewonly{margin-top:6px}'
  +'.wm-hd2 .wm-mh2{gap:6px 16px}'
  +'.wm-more{position:relative}.wm-more-panel{position:absolute;left:0;top:calc(100% + 8px);z-index:30;width:300px;max-width:80vw;background:#fff;border:1px solid #ECEEF3;border-radius:12px;padding:6px;box-shadow:0 12px 32px rgba(28,31,46,.12)}'
  +'.wm-more-info{font-size:12.5px;color:#6B7083;line-height:1.6;padding:6px 8px 8px;border-bottom:1px solid #F1F2F6;margin-bottom:4px}.wm-more-info b{color:#1C1F2E;font-weight:700}.wm-more-info i{font-size:10px;margin-right:2px}'
  +'.wm-more-h{font-size:11px;font-weight:700;color:#9AA0B4;text-transform:uppercase;letter-spacing:.06em;padding:8px 8px 2px}'
  +'.wm-more-panel .it{display:flex;align-items:center;gap:9px;width:100%;border:0;background:none;padding:8px;border-radius:8px;font:inherit;font-size:13px;color:#1C1F2E;cursor:pointer;text-align:left}.wm-more-panel .it:hover{background:#EDEBFE}.wm-more-panel .it i{color:#5B4BE8;width:14px;font-size:12px}.wm-more-panel .it.danger i{color:#D63B41}'
  +'.mt-shell .wm-hd2 .wm-clock{display:inline-flex;flex-direction:row;align-items:center;gap:6px;color:#6B7083}.mt-shell .wm-hd2 .wm-clock b{font-size:18px;color:#4A4F63;letter-spacing:-.3px}.mt-shell .wm-hd2 .wm-clock i{font-size:13px}'
  +'.mt-shell .wm-hd2 .wm-mh-r .wm-btn{height:36px;padding:0 16px}'
  +'.wm-agnow{background:none;border:0;border-radius:0;padding:2px 0 0;overflow:visible}.wm-agnow .bar{display:none}'
  +'.wm-agseg{display:flex;gap:3px;margin-top:12px}'
  +'.wm-agseg .seg{position:relative;height:10px;min-width:12px;padding:0;border:0;border-radius:5px;background:#E6E8EF;cursor:pointer;overflow:hidden}'
  +'.wm-agseg .seg:hover{background:#C9C2FA}.wm-agseg .seg.d{background:#9CD9B8}.wm-agseg .seg.d:hover{background:#7CCB9F}'
  +'.wm-agseg .seg.n{background:#FBD5D7}.wm-agseg .seg.n i{position:absolute;left:0;top:0;bottom:0;display:block;background:#E5484D;transition:width 1s linear}'
  +'.wm-agseg.paused .seg.n i{background:#B8BCC8}.wm-agseg .seg.v{box-shadow:0 0 0 2px #5B4BE8}'
  +'.wm-agseg .seg:focus-visible{outline:2px solid #5B4BE8;outline-offset:2px}'
  +'@media(max-width:700px){.mt-shell .wm-hd2 .wm-t2{margin-left:0!important}.wm-hd2 h2{font-size:20px!important}.wm-more-panel{position:fixed;left:16px;right:16px;top:auto;width:auto;max-width:none;margin-top:8px}}'
  +'.wm-busy{opacity:.45;pointer-events:none;cursor:progress}.wm-busy.bx{border-style:dashed!important}'
+'</style>';
