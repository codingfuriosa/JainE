/* ============================ TASK & DELEGATION ============================ */
let PEOPLE=null;
async function getPeople(){
  if(PEOPLE)return PEOPLE;
  const map={};
  try{const {data}=await sb.schema('acc').rpc('people');(data||[]).forEach(e=>{if(e.email)map[e.email]={email:e.email,name:e.full_name||e.email,depts:Array.isArray(e.department)?e.department:[]};});}catch(e){}
  try{const {data}=await sb.schema('hr').from('employees').select('full_name,email');(data||[]).forEach(e=>{if(e.email&&!map[e.email])map[e.email]={email:e.email,name:e.full_name};});}catch(e){}
  if(!map[state.email])map[state.email]={email:state.email,name:(state.profile&&state.profile.full_name)||state.email};
  PEOPLE=Object.values(map);return PEOPLE;
}
function nameOf(email){if(!email)return '—';const p=(PEOPLE||[]).find(x=>x.email===email);return p?p.name:email.split('@')[0];}
function taskTabs(active){
  // No Scoreboard tab here any more — it's its own module (Overview > Scoreboard).
  const t=[['','Home','fa-house'],['list','Projects','fa-diagram-project']];
  return '<div class="tabs">'+t.map(x=>`<div class="tab ${active===x[0]?'active':''}" onclick="location.hash='#/tasks${x[0]?'/'+x[0]:''}'"><i class="fa-solid ${x[2]}"></i> ${x[1]}</div>`).join('')+'</div>';
}

VIEWS.tasks=async function legacyTasksView(v,seg){
  /* The Accountability people actually use lives in accountability.js, which loads after this file
     on accountability.html and replaces this function outright. Everything below is the RETIRED
     Accountability — "Home" / "Projects" / "Scoreboard" — kept only because other modules still call
     into its task, project and goal helpers.
     It must never paint on the Accountability page. boot() calls renderPage() immediately after
     awaiting the auth check, and with a warm session that await can resolve through microtasks
     before accountability.js has finished downloading — so this legacy view starts rendering. The
     damage is done by WHEN it paints: it writes to the view only after its own `await getPeople()`,
     which lands a moment AFTER accountability.js's defensive re-render has already put the real UI
     up. The stale three tabs end up on top, and nothing repaints them until a hard refresh.
     Painting a loader and returning removes the race at its source — nothing is left in flight to
     overwrite the real UI, and accountability.js repaints as soon as it is in place. */
  if(PAGE==='tasks'){
    loader(v);
    /* If accountability.js never arrives at all (a failed or blocked download), say so plainly
       rather than spinning forever — and only if the real view is still not installed by then. */
    clearTimeout(window.__accWaitTimer);
    window.__accWaitTimer=setTimeout(function(){
      if(VIEWS.tasks===legacyTasksView&&v.querySelector('.loader')){
        v.innerHTML='<div class="card card-pad empty" style="padding:40px">'
          +'<i class="fa-solid fa-triangle-exclamation"></i>'
          +'<div>Accountability could not finish loading.</div>'
          +'<div style="margin-top:12px"><button class="btn btn-sm" onclick="location.reload()">'
          +'<i class="fa-solid fa-rotate-right"></i> Reload</button></div></div>';
      }
    },8000);
    return;
  }
  await getPeople();
  // reset list filters on every fresh navigation into Accountability (not on in-page filter changes)
  PFILTER.prio='All';PFILTER.status='All';
  GFILTER.prio='All';GFILTER.status='All';
  PJTFILTER.status='All';PJTFILTER.person='All';PJTFILTER.stage='All';GLTFILTER.status='All';
  GSCOPE='personal';
  // first-login onboarding gate
  if((!state.profile||!state.profile.onboarded)&&seg[0]!=='profile'){return taskOnboard(v);}
  if(seg[0]==='profile')return taskProfile(v);
  if(seg[0]==='view')return taskDetail(v,seg[1],seg[2]);
  if(seg[0]==='project'&&seg[1]==='none')return noProjectDetail(v);
  if(seg[0]==='project')return projectDetail(v,seg[1]);
  if(seg[0]==='goal')return goalDetail(v,seg[1]);
  if(seg[0]==='goals')return taskGoals(v);
  if(seg[0]==='scoreboard')return taskScoreboard(v);
  if(seg[0]==='list'||seg[0]==='projects')return taskProjects(v);
  return taskHome(v);
};

/* ---------- onboarding ---------- */
/* ---------- Reporting-manager picker — single-select, but shares the exact same
   .ms-field/.ms-panel/.ms-list/.ms-dept/.ms-opt styling + open/close/positioning
   behaviour as the "person picker" used elsewhere (msHtml/msOpen/msFieldClick) ---------- */
const RM_STATE={people:[],sel:''};
function rmOptRow(p,on){ return '<div class="ms-opt'+(on?' on':'')+'" onclick="rmPick(\''+esc(p.email)+'\')">'+avatar(p.name)+' <span style="flex:1">'+esc(p.name)+'</span>'+(on?' <i class="fa-solid fa-check" style="color:var(--brand)"></i>':'')+'</div>'; }
function rmListHtml(q){
  q=(q||'').toLowerCase();
  const people=RM_STATE.people.filter(p=>!q||(p.name||'').toLowerCase().includes(q)||(p.email||'').toLowerCase().includes(q));
  const noneOn=!RM_STATE.sel;
  const noneRow='<div class="ms-opt'+(noneOn?' on':'')+'" onclick="rmPick(\'\')"><span style="width:22px;height:22px;border-radius:50%;background:#e2e8f0;display:inline-flex;align-items:center;justify-content:center;color:#64748b;font-size:10px;flex:none">—</span> <span style="flex:1">None</span>'+(noneOn?' <i class="fa-solid fa-check" style="color:var(--brand)"></i>':'')+'</div>';
  if(!people.length) return noneRow+'<div style="padding:10px;color:#94a3b8;font-size:13px">No matches</div>';
  return noneRow+groupByDept(people).map(g=>'<div class="ms-dept">'+esc(g.dept)+'</div>'+g.people.map(p=>rmOptRow(p,p.email===RM_STATE.sel)).join('')).join('');
}
function rmChipsHtml(){
  const p=RM_STATE.people.find(x=>x.email===RM_STATE.sel);
  return p?('<span class="ms-chip">'+avatar(p.name)+' '+esc(p.name)+' <i class="fa-solid fa-xmark" onclick="event.stopPropagation();rmPick(\'\')"></i></span>'):'<span style="color:#94a3b8;font-size:13px">None</span>';
}
function rmPickerHtml(people,currentEmail){
  RM_STATE.people=(people||[]).filter(p=>p.email!==state.email);
  RM_STATE.sel=currentEmail||'';
  return '<label>Reporting manager <span style="color:var(--slate);font-weight:400">(optional — can add later)</span></label>'+
    '<input type="hidden" id="obMgr" value="'+esc(currentEmail||'')+'">'+
    '<div class="ms" id="ms_rm">'+
      '<div class="ms-field" onclick="msFieldClick(\'rm\',event)">'+
        '<span class="ms-chips" id="ms_rm_chips">'+rmChipsHtml()+'</span>'+
        '<input class="ms-typein" id="ms_rm_in" placeholder="Search people…" autocomplete="off" oninput="msOpen(\'rm\');rmRenderList()" onfocus="msOpen(\'rm\')" onclick="event.stopPropagation()">'+
        '<i class="fa-solid fa-chevron-down" style="color:#94a3b8;font-size:12px"></i>'+
      '</div>'+
      '<div class="ms-panel" id="ms_rm_panel"><div class="ms-list" id="ms_rm_list">'+rmListHtml('')+'</div></div>'+
    '</div>';
}
function rmRenderList(){ const list=$('ms_rm_list'); if(!list)return; const q=($('ms_rm_in')||{}).value||''; list.innerHTML=rmListHtml(q); }
window.rmPick=function(email){
  RM_STATE.sel=email||'';
  if($('obMgr'))$('obMgr').value=email||'';
  const chips=$('ms_rm_chips'); if(chips)chips.innerHTML=rmChipsHtml();
  const inp=$('ms_rm_in'); if(inp)inp.value='';
  rmRenderList();
  const panel=$('ms_rm_panel'); if(panel)panel.classList.remove('show');
};

async function taskOnboard(v){
  setCrumb(['Accountability','Set up profile']);
  const people=await getPeople();
  const fetchedName=(state.profile&&state.profile.full_name)||(state.roles&&state.roles.full_name)||(state.user&&state.user.user_metadata&&state.user.user_metadata.full_name)||'';
  const deptVal=(state.profile&&state.profile.department)||'';
  v.innerHTML=`<div style="max-width:680px;margin:10px auto">
    <div class="card card-pad" style="text-align:center;padding:32px">
      <div class="ic" style="width:60px;height:60px;border-radius:14px;background:var(--brand-50);color:var(--brand);display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 14px"><i class="fa-solid fa-list-check"></i></div>
      <h1 style="font-size:22px">Welcome to Accountability</h1>
      <p style="color:var(--slate);margin-top:6px">Let's set up your profile. This is account-specific and powers your tasks, delegation and scoreboard.</p>
    </div>
    <div class="card card-pad frm" style="margin-top:16px">
      <div class="two"><div><label>Full name</label><input id="obName" value="${esc(fetchedName)}"></div>
      <div><label>Designation <span style="color:var(--slate);font-weight:400">(optional)</span></label><input id="obDesig" placeholder="e.g. Project Manager" value="${esc((state.profile&&state.profile.designation)||'')}"></div></div>
      <div class="two"><div><label>Department</label><input id="obDept" disabled value="${esc(deptVal)}" placeholder="Not assigned yet" style="background:#f1f5f9;color:var(--slate);cursor:not-allowed"></div>
      <div>${rmPickerHtml(people,(state.profile&&state.profile.reporting_manager)||'')}</div></div>
      <div style="margin-top:20px;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="taskOnboardSave()"><i class="fa-solid fa-check"></i> Complete setup</button></div>
      <p style="color:var(--slate);font-size:12px;margin-top:12px;text-align:center">Department is assigned by your administrator. Anyone can delegate work to anyone — no extra permission needed.</p>
    </div></div>`;
}

window.taskOnboardSave=async function(){
  const name=$('obName').value.trim();if(!name){toast('Enter your name','err');return;}
  const row={email:state.email,full_name:name,designation:$('obDesig').value,reporting_manager:$('obMgr').value||null,onboarded:true,avatar_color:colorFor(state.email)};
  const {error}=await sb.schema('acc').from('user_profile').upsert(row,{onConflict:'email'});
  if(error){toast(error.message,'err');return;}
  state.profile=Object.assign(state.profile||{},row);refreshBootCache();PEOPLE=null;toast('Profile saved','ok');location.hash='#/tasks';route();
};
async function taskProfile(v){
  await taskOnboard(v);
  setCrumb(['Accountability','My Profile']);
  // preselect existing values
  if(state.profile){
    if(state.profile.designation)$('obDesig').value=state.profile.designation;
  }
}

/* ---------- task data ---------- */
async function fetchTasks(filter){
  let qb=sb.schema('acc').from('tasks').select('*').order('due_date',{ascending:true});
  if(filter==='delegation')qb=qb.eq('kind','delegation');
  const {data,error}=await qb;if(error){toast(error.message,'err');return [];}return data||[];
}
async function fetchTaskMemberships(me){
  // myTaskIds = tasks where I am listed as a member
  const {data:myRows}=await sb.schema('acc').from('task_members').select('task_id').eq('email',me);
  const myTaskIds=new Set((myRows||[]).map(r=>r.task_id));
  // sharedTaskIds = all task_ids that have ANY member entry (= "shared" tasks)
  const {data:allRows}=await sb.schema('acc').from('task_members').select('task_id');
  const sharedTaskIds=new Set((allRows||[]).map(r=>r.task_id));
  return {myTaskIds,sharedTaskIds};
}
async function fetchGoalMemberships(me){
  const {data:myRows}=await sb.schema('acc').from('goal_members').select('goal_id').eq('email',me);
  const myGoalIds=new Set((myRows||[]).map(r=>r.goal_id));
  return {myGoalIds};
}
/* anyone assigned to a task inside a Project/Goal automatically becomes a member of that Project/Goal, so they can actually see it */
async function syncParentMembership(projectId,goalId,emails){
  const list=[...new Set((emails||[]).filter(Boolean))];
  if(!list.length)return;
  if(projectId){
    const {data:cur}=await sb.schema('acc').from('project_members').select('email').eq('project_id',projectId);
    const have=new Set((cur||[]).map(m=>m.email));
    const toAdd=list.filter(e=>!have.has(e));
    if(toAdd.length)await sb.schema('acc').from('project_members').insert(toAdd.map(e=>({project_id:projectId,email:e})));
  }
  if(goalId){
    const {data:cur}=await sb.schema('acc').from('goal_members').select('email').eq('goal_id',goalId);
    const have=new Set((cur||[]).map(m=>m.email));
    const toAdd=list.filter(e=>!have.has(e));
    if(toAdd.length)await sb.schema('acc').from('goal_members').insert(toAdd.map(e=>({goal_id:goalId,email:e})));
  }
}
/* every hand-off of a project task is a delegation edge — this is what makes the task visible to both
   sides and lets approval climb back up the chain later */
async function insertDelegationEdges(taskId,delegator,delegatees){
  const list=[...new Set((delegatees||[]).filter(e=>e&&e!==delegator))];
  if(!list.length)return;
  // ignoreDuplicates — a delegatee can only ever have one edge per task (enforced by a unique constraint
  // on task_id+delegatee), so a double-click or re-adding someone already in the chain just silently
  // no-ops instead of erroring.
  await sb.schema('acc').from('task_delegations').upsert(list.map(e=>({task_id:taskId,delegator,delegatee:e})),{onConflict:'task_id,delegatee',ignoreDuplicates:true});
}
/* Removing someone from a task's Assignees has to prune their WHOLE branch, not just the one edge —
   otherwise a further sub-delegatee (e.g. Dibas removed, but Dibas already handed part of it to
   system3) is left dangling: still delegated-to on paper, just disconnected from anyone above them. */
async function cascadeDeleteDelegationBranch(taskId,rootDelegatees){
  let frontier=[...new Set((rootDelegatees||[]).filter(Boolean))];
  const toDelete=new Set();
  for(let i=0;i<20&&frontier.length;i++){
    frontier.forEach(f=>toDelete.add(f));
    const {data:children}=await sb.schema('acc').from('task_delegations').select('delegatee').eq('task_id',taskId).in('delegator',frontier);
    frontier=[...new Set((children||[]).map(c=>c.delegatee).filter(d=>!toDelete.has(d)))];
  }
  if(toDelete.size)await sb.schema('acc').from('task_delegations').delete().eq('task_id',taskId).in('delegatee',[...toDelete]);
  return toDelete;
}
async function fetchProjectMemberships(me){
  const [{data:myRows},{data:myOwnerRows}]=await Promise.all([
    sb.schema('acc').from('project_members').select('project_id').eq('email',me),
    sb.schema('acc').from('project_owners').select('project_id').eq('email',me)
  ]);
  const myProjectIds=new Set([...(myRows||[]).map(r=>r.project_id),...(myOwnerRows||[]).map(r=>r.project_id)]);
  return {myProjectIds};
}
async function fetchMyProjects(me){
  let all=[];try{const {data}=await sb.schema('acc').from('projects').select('*').eq('archived',false).order('created_at',{ascending:false});all=data||[];}catch(e){}
  const {myProjectIds}=await fetchProjectMemberships(me);
  return all.filter(p=>p.owner===me||p.created_by===me||myProjectIds.has(p.id));
}
function bucketOf(t){
  if(t.archived)return 'Archived';
  if(t.status==='Completed')return 'Completed';
  const today=new Date();today.setHours(0,0,0,0);
  const due=t.due_date?new Date(t.due_date):null;
  if(due&&due<=today)return 'Due';
  if(due&&due>today)return 'Upcoming';
  return 'Current';
}

async function taskHome(v){
  setCrumb(['Accountability','Home']);
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-list-check" style="color:#1d4ed8"></i> Accountability</h1><p>Your personal command centre — Asana-style, account-specific</p></div>
    </div>`+taskTabs('')+`<div id="thBody"><div class="loader"><div class="spin"></div></div></div>`;
  const allRaw=await fetchTasks();
  const me=state.email;
  const {myTaskIds,sharedTaskIds}=await fetchTaskMemberships(me);
  let goals=[];try{const {data}=await sb.schema('acc').from('goals').select('*');goals=data||[];}catch(e){}
  const {myGoalIds}=await fetchGoalMemberships(me);
  const myProjects=await fetchMyProjects(me);
  // Team Tasks: shared tasks I'm involved in
  const teamTasks=allRaw.filter(t=>t.kind!=='delegation'&&sharedTaskIds.has(t.id)&&(myTaskIds.has(t.id)||t.owner===me||t.created_by===me||t.assigned_to===me));
  // Delegation widgets — standalone delegation-kind tasks + project-linked delegation-chain tasks
  let delOutIds=new Set(),delInIds=new Set();
  try{
    const [{data:outEdges},{data:inEdges}]=await Promise.all([
      sb.schema('acc').from('task_delegations').select('task_id').eq('delegator',me),
      sb.schema('acc').from('task_delegations').select('task_id').eq('delegatee',me)
    ]);
    (outEdges||[]).forEach(e=>delOutIds.add(e.task_id));
    (inEdges||[]).forEach(e=>delInIds.add(e.task_id));
  }catch(e){}
  const assignedToMe=allRaw.filter(t=>(t.kind==='delegation'&&t.assigned_to===me&&t.created_by!==me)||(t.project_id&&delInIds.has(t.id)));
  const assignedByMe=allRaw.filter(t=>(t.kind==='delegation'&&t.created_by===me&&t.assigned_to&&t.assigned_to!==me)||(t.project_id&&delOutIds.has(t.id)));
  const widget=(title,icon,col,items,empty,render)=>`<div class="card card-pad"><div class="sec-title"><i class="fa-solid ${icon}" style="color:${col}"></i> ${title} <span class="tag t-gray" style="margin-left:6px">${items.length}</span></div><div style="margin-top:10px">${items.length?items.slice(0,5).map(render||taskMini).join(''):'<div class="empty" style="padding:22px"><i class="fa-regular fa-circle-check"></i><div>'+empty+'</div></div>'}</div></div>`;
  // Completed this week (based on updated_at, which is touched whenever a task's status/progress changes)
  const weekAgo=new Date();weekAgo.setDate(weekAgo.getDate()-7);
  const completedThisWeek=allRaw.filter(t=>t.status==='Completed'&&t.updated_at&&new Date(t.updated_at)>=weekAgo).sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
  const openTasks=allRaw.filter(t=>t.status!=='Completed'&&!t.archived);
  $('thBody').innerHTML=`<div class="grid grid-2 widget-grid">
    ${widget('Projects','fa-diagram-project','#1d4ed8',myProjects,'No projects yet',projectMini)}
    <div class="card card-pad"><div class="sec-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><span><i class="fa-solid fa-scale-balanced" style="color:#1d4ed8"></i> Workload</span><div class="seg" id="wlSeg"><button type="button" class="seg-btn on" onclick="wlSetMode('priority',this)">Priority</button><button type="button" class="seg-btn" onclick="wlSetMode('due',this)">Due Date</button></div></div><div id="wlBody" style="margin-top:8px"></div></div>
  </div>
  <div class="grid grid-2" style="margin-top:16px">
    ${widget('Assigned By Me','fa-share-nodes','#d97706',assignedByMe,'You have not delegated anything')}
    ${widget('Assigned To Me','fa-inbox','#7c3aed',assignedToMe,'Nothing delegated to you')}
  </div>
  <div class="card card-pad" style="margin-top:16px"><div class="sec-title"><i class="fa-solid fa-circle-check" style="color:#16a34a"></i> Completed This Week <span class="tag t-green" style="margin-left:6px">${completedThisWeek.length}</span></div><div style="margin-top:8px">${completedThisWeek.length?completedThisWeek.slice(0,6).map(completedMini).join(''):'<div class="empty" style="padding:22px"><i class="fa-regular fa-circle-check"></i><div>Nothing completed yet this week</div></div>'}</div></div>`;
  window.__openTasks=openTasks;
  window.__wlMode='priority';
  renderWorkload();
}
function completedMini(t){return `<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--line-2);cursor:pointer" onclick="location.hash='#/tasks/view/${t.id}'"><div style="width:30px;height:30px;border-radius:50%;background:#f0fdf4;color:#16a34a;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0"><i class="fa-solid fa-check"></i></div><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155">${esc(t.title)}</div><div style="color:var(--slate);font-size:11.5px">${t.kind==='delegation'?'Delegation':'Task'} · completed ${relTime(t.updated_at)}</div></div><i class="fa-solid fa-chevron-right" style="color:#cbd5e1;font-size:11px"></i></div>`;}
function workloadMini(t){
  const overdue=!!(t.due_date&&new Date(t.due_date)<new Date(new Date().toDateString()));
  const urgent=t.priority==='Urgent';
  return `<div class="${(urgent||overdue)?'row-urgent':''}" style="display:flex;align-items:center;gap:11px;padding:9px 0 9px 6px;border-bottom:1px solid var(--line-2);cursor:pointer" onclick="location.hash='#/tasks/view/${t.id}'"><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}</div><div class="${overdue?'due-overdue':''}" style="color:var(--slate);font-size:11.5px">${prioTag(t.priority)} · ${t.due_date?(overdue?'Overdue · ':'Due ')+fmtDateShort(t.due_date):'No due date'}</div></div></div>`;
}
window.wlSetMode=function(mode,btn){
  document.querySelectorAll('#wlSeg .seg-btn').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  window.__wlMode=mode;
  renderWorkload();
};
window.renderWorkload=function(){
  const mode=window.__wlMode||'priority';
  const items=window.__openTasks||[];
  let list;
  if(mode==='priority'){list=items.filter(t=>t.priority==='Urgent');}
  else{
    const ts=todayStr();const tmrw=new Date();tmrw.setDate(tmrw.getDate()+1);const tms=tmrw.toISOString().slice(0,10);
    list=items.filter(t=>t.due_date&&t.due_date>=ts&&t.due_date<=tms).slice().sort((a,b)=>new Date(a.due_date)-new Date(b.due_date));
  }
  $('wlBody').innerHTML=list.length?list.slice(0,6).map(workloadMini).join(''):`<div class="empty" style="padding:22px"><i class="fa-regular fa-circle-check"></i><div>${mode==='priority'?'No urgent tasks':'No tasks due today or tomorrow'}</div></div>`;
};
function taskMini(t){return `<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--line-2);cursor:pointer" onclick="location.hash='#/tasks/view/${t.id}'"><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}</div><div style="color:var(--slate);font-size:11.5px"><span class="tag ${t.kind==='delegation'?'t-purple':'t-blue'}" style="padding:1px 7px;font-size:10px">${t.kind==='delegation'?'Delegation':'Task'}</span> · Due ${fmtDateShort(t.due_date)}</div></div><div style="width:42px;text-align:right;font-size:12px;font-weight:600;color:var(--brand)">${t.progress}%</div></div>`;}
function goalMini(g){return `<div style="padding:10px 0;border-bottom:1px solid var(--line-2);cursor:pointer" onclick="location.hash='#/tasks/goal/${g.id}'"><div style="display:flex;justify-content:space-between"><div style="font-weight:600;font-size:13px">${esc(g.name)}</div><span class="tag ${g.scope==='company'?'t-purple':g.scope==='team'?'t-blue':'t-gray'}">${esc(g.scope)}</span></div><div style="margin-top:4px">${prioTag(g.priority)} ${statusTag(g.status)}</div><div class="progress" style="margin-top:7px"><span style="width:${g.progress||0}%"></span></div></div>`;}
function projectMini(p){return `<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--line-2);cursor:pointer" onclick="location.hash='#/tasks/project/${p.id}'"><div class="ic" style="width:32px;height:32px;border-radius:9px;background:#eff4ff;color:#1d4ed8;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0"><i class="fa-solid fa-diagram-project"></i></div><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</div><div style="color:var(--slate);font-size:11.5px">Owner ${esc(nameOf(p.owner||p.created_by))}</div></div><i class="fa-solid fa-chevron-right" style="color:#cbd5e1;font-size:12px"></i></div>`;}


/* ---------- create / edit task ---------- */
function peopleCheckboxes(cls,selected){selected=selected||[];return (PEOPLE||[]).map(p=>`<label style="display:inline-flex;align-items:center;gap:7px;padding:5px 9px;border:1px solid var(--line);border-radius:8px;margin:3px;cursor:pointer;font-size:12.5px;font-weight:500"><input type="checkbox" class="checkbox ${cls}" value="${esc(p.email)}" ${selected.includes(p.email)?'checked':''}> ${esc(p.name)}</label>`).join('');}
/* group a people array by department; people without one fall into "Unassigned" — depts with nobody in them simply never appear.
   Each person appears exactly ONCE, under a heading naming every department they belong
   to (comma-joined) — no duplicate rows for people in multiple departments. */
function groupByDept(list){
  const groups={};
  (list||[]).forEach(p=>{
    const raw=Array.isArray(p.depts)?p.depts:(Array.isArray(p.department)?p.department:(p.dept?[p.dept]:[]));
    const ds=raw.map(x=>String(x||'').trim()).filter(Boolean);
    const key=ds.length?ds.slice().sort().join(', '):'Unassigned';
    (groups[key]=groups[key]||[]).push(p);
  });
  return Object.keys(groups).sort((a,b)=>a==='Unassigned'?1:b==='Unassigned'?-1:a.localeCompare(b)).map(d=>({dept:d,people:groups[d]}));
}
function peopleOptions(sel,list){return groupByDept(list||PEOPLE).map(g=>`<optgroup label="${esc(g.dept)}">${g.people.map(p=>`<option value="${esc(p.email)}" ${p.email===sel?'selected':''}>${esc(p.name)}</option>`).join('')}</optgroup>`).join('');}

/* ---- reusable multi-select dropdown (everyone in the company) ---- */
const MS={};
function msHtml(key){return `<div class="ms" id="ms_${key}">
  <div class="ms-field" onclick="msFieldClick('${key}',event)">
    <span class="ms-chips" id="ms_${key}_chips"></span>
    <input class="ms-typein" id="ms_${key}_in" placeholder="Type to search…" autocomplete="off" oninput="msOpen('${key}');msRenderList('${key}')" onfocus="msOpen('${key}')" onclick="event.stopPropagation()">
    <i class="fa-solid fa-chevron-down" style="color:#94a3b8;font-size:12px"></i>
  </div>
  <div class="ms-panel" id="ms_${key}_panel">
    <div class="ms-list" id="ms_${key}_list"></div>
  </div></div>`;}
function msInit(key,selected,peopleList,ranked,locked){MS[key]={sel:new Set(selected||[]),people:peopleList||null,ranked:!!ranked,locked:new Set(locked||[])};(locked||[]).forEach(e=>MS[key].sel.add(e));msRenderChips(key);msRenderList(key);}
function ownerRankLabel(i){if(i<=0)return 'Owner';return 'Sub-'.repeat(i-1)+'Sub Owner';}
function msRenderChips(key){
  const c=document.getElementById('ms_'+key+'_chips');if(!c)return;
  const sel=[...MS[key].sel];
  const ranked=MS[key].ranked;
  const locked=MS[key].locked||new Set();
  c.innerHTML=sel.length?sel.map((e,i)=>`<span class="ms-chip">${ranked?`<b class="ms-rank">${ownerRankLabel(i)}</b>`:''}${avatar(nameOf(e))} ${esc(nameOf(e))} ${locked.has(e)?'<i class="fa-solid fa-lock" title="Always included"></i>':'<i class="fa-solid fa-xmark" onclick="event.stopPropagation();msPick(\''+key+'\',\''+esc(e)+'\')"></i>'}</span>`).join(''):'<span style="color:#94a3b8;font-size:13px">Select people…</span>';
}
function msRenderList(key){
  const list=document.getElementById('ms_'+key+'_list');if(!list)return;
  const q=(document.getElementById('ms_'+key+'_in')||{}).value||'';
  const ql=q.toLowerCase();
  const pool=(MS[key]&&MS[key].people)||PEOPLE||[];
  const people=pool.filter(p=>!ql||(p.name||'').toLowerCase().includes(ql)||(p.email||'').toLowerCase().includes(ql));
  if(!people.length){list.innerHTML='<div style="padding:10px;color:#94a3b8;font-size:13px">No matches</div>';return;}
  const locked=MS[key].locked||new Set();
  const optHtml=(p)=>{const on=MS[key].sel.has(p.email);const lk=locked.has(p.email);return `<div class="ms-opt ${on?'on':''}" ${lk?'':`onclick="msPick('${key}','${esc(p.email)}')"`}>${avatar(p.name)} <span style="flex:1">${esc(p.name)}</span> ${lk?'<i class="fa-solid fa-lock" style="color:#94a3b8;font-size:11px"></i>':on?'<i class="fa-solid fa-check" style="color:var(--brand)"></i>':''}</div>`;};
  list.innerHTML=groupByDept(people).map(g=>`<div class="ms-dept">${esc(g.dept)}</div>${g.people.map(optHtml).join('')}`).join('');
}
function msPositionPanel(key){
  const p=document.getElementById('ms_'+key+'_panel');
  const field=document.querySelector('#ms_'+key+' .ms-field');
  if(!p||!field)return;
  const r=field.getBoundingClientRect();
  p.style.position='fixed';p.style.top=(r.bottom+5)+'px';p.style.left=r.left+'px';p.style.width=r.width+'px';p.style.right='auto';
}
window.msOpen=function(key){
  const p=document.getElementById('ms_'+key+'_panel');if(!p)return;
  if(!p.classList.contains('show')){
    document.querySelectorAll('.ms-panel.show').forEach(x=>x.classList.remove('show'));
    msPositionPanel(key);
    p.classList.add('show');
  }
};
window.msFieldClick=function(key,e){if(e)e.stopPropagation();msOpen(key);const inp=document.getElementById('ms_'+key+'_in');if(inp)inp.focus();};
window.msToggle=function(key,e){if(e)e.stopPropagation();const p=document.getElementById('ms_'+key+'_panel');if(p&&p.classList.contains('show')){p.classList.remove('show');}else{msOpen(key);}};
window.msPick=function(key,email){const m=MS[key];if(m.locked&&m.locked.has(email))return;const s=m.sel;s.has(email)?s.delete(email):s.add(email);msRenderChips(key);const inp=document.getElementById('ms_'+key+'_in');if(inp){inp.value='';inp.focus();}msRenderList(key);msPositionPanel(key);if(typeof m.onChange==='function')m.onChange(email,s.has(email));};
function getMS(key){return MS[key]?[...MS[key].sel]:[];}
document.addEventListener('click',function(e){if(!e.target.closest('.ms'))document.querySelectorAll('.ms-panel.show').forEach(x=>x.classList.remove('show'));});
window.addEventListener('scroll',function(){document.querySelectorAll('.ms-panel.show').forEach(p=>{const key=p.id.replace(/^ms_/,'').replace(/_panel$/,'');msPositionPanel(key);});},true);
window.addEventListener('resize',function(){document.querySelectorAll('.ms-panel.show').forEach(p=>{const key=p.id.replace(/^ms_/,'').replace(/_panel$/,'');msPositionPanel(key);});});

/* ---- reusable single-select filter dropdown (styled like .ms) ---- */
function fsHtml(key,label,options,current,cb){
  current=current||'All';
  return `<div class="fs" id="fs_${key}">
    <div class="fs-field" onclick="fsToggle('${key}',event)"><i class="fa-solid fa-filter" style="font-size:10px;color:#94a3b8"></i><span class="fs-label">${esc(label)}</span><span class="fs-val">${esc(current)}</span><i class="fa-solid fa-chevron-down fs-chev"></i></div>
    <div class="fs-panel" id="fs_${key}_panel">
      <div class="fs-opt ${current==='All'?'on':''}" onclick="fsPick('${key}','All','${cb}')">All</div>
      ${options.map(o=>`<div class="fs-opt ${current===o?'on':''}" onclick="fsPick('${key}','${esc(o)}','${cb}')">${esc(o)}</div>`).join('')}
    </div>
  </div>`;
}
window.fsToggle=function(key,e){if(e)e.stopPropagation();const p=document.getElementById('fs_'+key+'_panel');const wrap=document.getElementById('fs_'+key);const open=p.classList.contains('show');document.querySelectorAll('.fs-panel.show').forEach(x=>x.classList.remove('show'));document.querySelectorAll('.fs.open').forEach(x=>x.classList.remove('open'));if(!open){p.classList.add('show');wrap.classList.add('open');}};
/* On phones, several fsHtml() pills sitting side by side wrap badly and eat vertical space.
   fsGroupHtml collapses any set of them into a single "Filters" dropdown containing one
   single-select group per original filter (still one pick per category, never multi-select) —
   desktop keeps showing the separate pills unchanged; only <=760px swaps to the combined one. */
function fsGroupHtml(groupKey,filters){
  filters=(filters||[]).filter(Boolean);
  if(!filters.length)return '';
  const activeCount=filters.filter(f=>f.current&&f.current!=='All').length;
  const desktopHtml=filters.map(f=>fsHtml(f.key,f.label,f.options,f.current,f.cb)).join('');
  const mobileBody=filters.map(f=>`<div class="fsg-group">
      <div class="fsg-group-label">${esc(f.label)}</div>
      <div class="fs-opt ${(!f.current||f.current==='All')?'on':''}" onclick="fsPick('${f.key}','All','${f.cb}')">All</div>
      ${f.options.map(o=>`<div class="fs-opt ${f.current===o?'on':''}" onclick="fsPick('${f.key}','${esc(o)}','${f.cb}')">${esc(o)}</div>`).join('')}
    </div>`).join('');
  return `<span class="fs-desktop-only">${desktopHtml}</span>
    <div class="fs fsg-combined" id="fs_${groupKey}">
      <div class="fs-field" onclick="fsToggle('${groupKey}',event)"><i class="fa-solid fa-filter" style="font-size:10px;color:#94a3b8"></i><span class="fs-label">Filters</span>${activeCount?`<span class="fs-val">${activeCount} active</span>`:''}<i class="fa-solid fa-chevron-down fs-chev"></i></div>
      <div class="fs-panel fsg-panel" id="fs_${groupKey}_panel">${mobileBody}</div>
    </div>`;
}
window.fsPick=function(key,val,cb){const p=document.getElementById('fs_'+key+'_panel');if(p)p.classList.remove('show');window[cb](val);};
document.addEventListener('click',function(e){if(!e.target.closest('.fs')){document.querySelectorAll('.fs-panel.show').forEach(x=>x.classList.remove('show'));document.querySelectorAll('.fs.open').forEach(x=>x.classList.remove('open'));}});
window.taskCreateModal=async function(kind,projectId,projectName,goalId,goalName){
  kind=kind||'task';const isDel=kind==='delegation';
  if(isDel && !(state.profile && state.profile.can_delegate)){toast('You are not permitted to delegate tasks. Enable it in your profile.','err');return;}
  const delList=(state.profile&&state.profile.delegate_to)||[];
  const assignPeople=isDel?(PEOPLE||[]).filter(p=>delList.includes(p.email)||state.super):(PEOPLE||[]);
  const dateOptional=!!((projectId||goalId)&&!isDel);
  let scopedPeople=null;
  if(!isDel&&projectId){
    const [{data:pmem},{data:proj},{data:powners}]=await Promise.all([
      sb.schema('acc').from('project_members').select('email').eq('project_id',projectId),
      sb.schema('acc').from('projects').select('owner,created_by').eq('id',projectId).single(),
      sb.schema('acc').from('project_owners').select('email').eq('project_id',projectId)
    ]);
    const emails=new Set((pmem||[]).map(m=>m.email));
    (powners||[]).forEach(o=>emails.add(o.email));
    if(proj){if(proj.owner)emails.add(proj.owner);if(proj.created_by)emails.add(proj.created_by);}
    scopedPeople=(PEOPLE||[]).filter(p=>emails.has(p.email));
  } else if(!isDel&&goalId){
    const [{data:gmem},{data:g}]=await Promise.all([
      sb.schema('acc').from('goal_members').select('email').eq('goal_id',goalId),
      sb.schema('acc').from('goals').select('owner,created_by').eq('id',goalId).single()
    ]);
    const emails=new Set((gmem||[]).map(m=>m.email));
    if(g){if(g.owner)emails.add(g.owner);if(g.created_by)emails.add(g.created_by);}
    scopedPeople=(PEOPLE||[]).filter(p=>emails.has(p.email));
  }
  const parentName=projectName||goalName;
  const ownerOpts=projectId?(scopedPeople||[]).filter(p=>p.email!==state.email):null;
  openModal(`<div class="modal-head"><h3><i class="fa-solid ${isDel?'fa-share-nodes':'fa-list-check'}"></i> ${isDel?'Delegate work':(parentName?'New task in '+esc(parentName):'New task')}</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Title</label><input id="tkTitle" placeholder="What needs to be done?">
    <label>Description</label>
    <div style="border:1px solid var(--line);border-radius:8px;overflow:hidden">
      <div style="display:flex;gap:2px;padding:6px;border-bottom:1px solid var(--line);background:#fafbfd">
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertUnorderedList')"><i class="fa-solid fa-list-ul"></i></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertOrderedList')"><i class="fa-solid fa-list-ol"></i></button>
      </div>
      <div id="tkDesc" contenteditable="true" style="min-height:80px;padding:10px 12px;font-size:13.5px;outline:none"></div>
    </div>
    ${isDel?`<label>Assign to</label><select id="tkAssignee">${assignPeople.length?peopleOptions('',assignPeople):'<option value="">No one available</option>'}</select>`:projectId?`<label>Assign to <span style="font-weight:400;color:var(--slate);text-transform:none;font-size:11.5px">— project members, excluding you</span></label>${msHtml('tkAssignTo')}`:`<label>Owner</label><select id="tkOwner">${peopleOptions(state.email)}</select>`}
    <label style="margin-top:14px">Due date${dateOptional?' (optional)':''}</label><input type="date" id="tkDue">
    ${(isDel||projectId)?'':`<label style="display:flex;align-items:center;gap:8px;margin-top:13px;cursor:pointer;text-transform:none;font-weight:500;font-size:13px"><input type="checkbox" class="checkbox" id="tkMultiToggle" onchange="tkToggleMembers(this.checked)"> Assign to more than one person</label>
    <div id="tkMembersWrap" style="display:none"><label>Members ${goalId?'<span style="font-weight:400;color:var(--slate);text-transform:none;font-size:11.5px">— only people in this goal</span>':''}</label>${msHtml('tkMembers')}</div>`}
    <label style="margin-top:14px">Attachment (optional)</label>
    <div class="dropzone" onclick="document.getElementById('tkFile').click()"><i class="fa-solid fa-paperclip"></i><div id="tkFName">Click to choose a file</div></div>
    <input type="file" id="tkFile" class="hidden" onchange="document.getElementById('tkFName').textContent=this.files[0]?this.files[0].name:'Click to choose a file'">
    <input type="hidden" id="tkProjectId" value="${projectId||''}">
    <input type="hidden" id="tkGoalId" value="${goalId||''}">
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="tkSave" onclick="taskSave('${kind}')"><i class="fa-solid fa-check"></i> ${isDel?'Delegate':'Create'}</button></div>`,'lg');
  if(projectId&&!isDel)setTimeout(()=>msInit('tkAssignTo',[],ownerOpts),30);
  else if(!isDel)setTimeout(()=>msInit('tkMembers',[],scopedPeople),30);
};
window.tkToggleMembers=function(on){const w=$('tkMembersWrap');if(w)w.style.display=on?'':'none';};
window.taskSave=async function(kind){
  const isDel=kind==='delegation';
  if(isDel && !(state.profile && state.profile.can_delegate)){toast('You are not permitted to delegate tasks.','err');return;}
  const title=$('tkTitle').value.trim();if(!title){toast('Enter a title','err');return;}
  const projIdRaw=$('tkProjectId')?$('tkProjectId').value:'';
  const projectId=projIdRaw?parseInt(projIdRaw):null;
  const goalIdRaw=$('tkGoalId')?$('tkGoalId').value:'';
  const goalId=goalIdRaw?parseInt(goalIdRaw):null;
  if(!isDel&&!projectId&&!goalId&&!$('tkDue').value){toast('Select a due date','err');return;}
  const desc=$('tkDesc').innerHTML;
  // Every task always starts life Pending — status from here on is driven entirely by the
  // Ask Approval / approval flow, never picked manually.
  const row={kind,title,description:desc,due_date:$('tkDue').value||null,progress:0,status:'Pending',created_by:state.email};
  if(projectId)row.project_id=projectId;
  if(goalId)row.goal_id=goalId;
  let mem=[];
  if(isDel){row.assigned_to=$('tkAssignee').value;row.owner=$('tkAssignee').value;}
  else if(projectId){
    const assignTo=getMS('tkAssignTo');
    if(!assignTo.length){toast('Select at least one person to assign this task to','err');return;}
    row.owner=assignTo[0];mem=assignTo.slice(1);
  }
  else{row.owner=$('tkOwner').value;mem=getMS('tkMembers');}
  if(projectId){
    const delegatees=[row.owner,...mem].filter(e=>e&&e!==state.email);
    if(delegatees.length&&!(state.profile&&state.profile.can_delegate)){toast('You are not permitted to delegate tasks. Enable it in your profile.','err');return;}
  }
  const btn=$('tkSave');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';
  const {data,error}=await sb.schema('acc').from('tasks').insert(row).select().single();
  if(error){toast(error.message,'err');btn.disabled=false;return;}
  // Logged directly, after the row actually exists, rather than through USAGE_MAP - these values
  // only exist as read off the form here, which a generic wrapper around this function could never
  // see. On success only, so a failed save (bad due date, no permission) is never counted as a task
  // that was created. Deliberately the FULL picture of what was created, not just the title - who
  // it's for, when it's due, and a plain-text (HTML stripped) excerpt of the description - so the
  // Usability report's Details column reads as a real record of the task, not just a name.
  try{
    const descText=String(desc||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
    const assignees=isDel ? (nameOf(row.assigned_to)||row.assigned_to)
                           : [row.owner].concat(mem).filter(Boolean).map(function(e){return nameOf(e)||e;}).join(', ');
    usageQueue(isDel?'tasks.tasks.delegate_task_to_someone':'tasks.tasks.create_task', 'create', {
      title:title,
      assignee:assignees||undefined,
      due_date:row.due_date||undefined,
      description:descText?(descText.length>140?descText.slice(0,140)+'…':descText):undefined
    });
  }catch(_e){}
  if(!isDel&&mem.length)await sb.schema('acc').from('task_members').insert(mem.map(e=>({task_id:data.id,email:e})));
  if(projectId||goalId)await syncParentMembership(projectId,goalId,[row.owner,...mem]);
  if(projectId)await insertDelegationEdges(data.id,state.email,[row.owner,...mem]);
  // attachment
  const f=$('tkFile').files[0];
  if(f){const key=s3KeyForTask(data.id,isDel,f.name);const {data:upData,error:ue}=await uploadFileToS3(key,f);if(ue)toast('Task created, but attachment upload failed: '+ue.message,'err');else await sb.schema('acc').from('task_files').insert({task_id:data.id,file_name:f.name,storage_path:upData.path,file_size:f.size,uploaded_by:state.email});}
  await sb.schema('acc').from('task_activity').insert({task_id:data.id,actor:state.email,action:isDel?'delegated this task to '+nameOf(row.assigned_to):'created this task'});
  closeModal();toast(isDel?'Task delegated':'Task created','ok');
  if(goalId)await recalcGoalProgress(goalId);
  if(projectId)await recalcProjectProgress(projectId);
  location.hash='#/tasks/view/'+data.id;route();
};

/* ---------- task detail ---------- */
async function taskDetail(v,id,dgCtx){
  loader(v);
  const {data:t,error}=await sb.schema('acc').from('tasks').select('*').eq('id',id).single();
  if(error||!t){v.innerHTML='<div class="empty"><i class="fa-solid fa-ban"></i><div>Task not found or no access</div></div>';return;}
  let proj=null,goalP=null;
  if(t.project_id){try{const {data}=await sb.schema('acc').from('projects').select('id,name').eq('id',t.project_id).single();proj=data||null;}catch(e){}}
  if(t.goal_id){try{const {data}=await sb.schema('acc').from('goals').select('id,name').eq('id',t.goal_id).single();goalP=data||null;}catch(e){}}
  setCrumb(['Accountability',t.kind==='delegation'?'Delegation':[goalP?'Goals':'Projects',goalP?'#/tasks/goals':'#/tasks/list'],...(proj?[[proj.name,'#/tasks/project/'+proj.id]]:goalP?[[goalP.name,'#/tasks/goal/'+goalP.id]]:[]),t.title]);
  const [{data:members},{data:comments},{data:checklist},{data:files},{data:taskDgs},{data:apprRows}]=await Promise.all([
    sb.schema('acc').from('task_members').select('*').eq('task_id',id),
    sb.schema('acc').from('task_comments').select('*').eq('task_id',id).order('created_at'),
    sb.schema('acc').from('task_checklist').select('*').eq('task_id',id).order('sort'),
    sb.schema('acc').from('task_files').select('*').eq('task_id',id),
    sb.schema('acc').from('task_delegations').select('delegator,delegatee').eq('task_id',id),
    sb.schema('acc').from('task_approvals').select('*').eq('task_id',id)
  ]);
  const mem=members||[];const canEdit=true;
  // Anyone anywhere in this task's delegation chain (not just whoever currently holds it) can mark it
  // complete directly — e.g. the original delegator closing it out themselves. Approval still climbs
  // normally from whoever actually clicked it: a root delegator with no one above them auto-approves,
  // an intermediate delegator still needs their own delegator's sign-off.
  const inDelegationChain=(taskDgs||[]).some(d=>d.delegator===state.email||d.delegatee===state.email);
  // Members/Owner are scoped to WHICH TAB the viewer navigated in from, computed LOCALLY relative to
  // whoever's asking — not against the absolute graph root. My "received" group is whoever MY OWN direct
  // delegator handed this to (their full delegatee set, siblings + me) — that stays correct at any depth:
  // Prerna's received group is Administrator's delegatees {Dibas, Prerna}, but Akashnil's received group
  // is Prerna's delegatees {Akashnil} only, even though Administrator's group further up is {Dibas, Prerna}.
  // Viewing via "Assigned to me" (or no context) always shows my received group, no matter how much I've
  // since sub-delegated. Viewing via my OWN "Assigned by me" tab narrows to just whoever I personally
  // handed it to — not myself too, since I'm already shown separately as Owner right above. A root
  // delegator (nobody delegated it to them) always sees their own outgoing group the same way.
  const dgEdges=taskDgs||[];
  const myOutgoing=[...new Set(dgEdges.filter(d=>d.delegator===state.email).map(d=>d.delegatee))];
  const myIncoming=[...new Set(dgEdges.filter(d=>d.delegatee===state.email).map(d=>d.delegator))];
  const myDirectDelegator=myIncoming[0]||null;
  const receivedGroup=myDirectDelegator?[...new Set(dgEdges.filter(d=>d.delegator===myDirectDelegator).map(d=>d.delegatee))]:[];
  const fallbackTeam=[t.owner,...mem.map(m=>m.email)].filter(Boolean);
  let ownerEmail,originalTeam;
  if(!dgEdges.length){
    ownerEmail=t.owner||t.assigned_to||t.created_by;
    originalTeam=fallbackTeam;
  }else if(!myDirectDelegator){
    ownerEmail=state.email;
    originalTeam=myOutgoing.length?myOutgoing:fallbackTeam;
  }else if(dgCtx==='delegated'){
    ownerEmail=state.email;
    originalTeam=myOutgoing;
  }else{
    ownerEmail=myDirectDelegator;
    originalTeam=receivedGroup.length?receivedGroup:fallbackTeam;
  }
  const cl=checklist||[];const clTotal=cl.length;const clDone=cl.filter(c=>c.done).length;const clPct=clTotal?Math.round(clDone/clTotal*100):0;
  window.__TS_ITEMS=window.__TS_ITEMS||{};cl.forEach(c=>window.__TS_ITEMS[c.id]=c);
  window.__TS_ORDER=cl.map(c=>c.id);
  const dueHist=t.due_date_history||[];
  // Per-branch approval: each "Ask Approval" click created its own acc.task_approvals row that
  // climbs hop-by-hop (current_approver moves up the delegation chain). To find MY role in whichever
  // pending row is relevant to me, walk from that row's submitter up through task_delegations edges —
  // if I'm the current_approver, it's my turn; if I'm the submitter or anyone strictly between the
  // submitter and current_approver, my part is already signed off (shown as "Done") even though the
  // task overall is still climbing toward the true root Assignor. Anyone further up who hasn't been
  // reached yet (or who isn't in this branch at all) gets no row and sees a plain, name-free tag —
  // this is what keeps one branch's approval chatter from leaking into an unrelated branch/viewer.
  const allApprRows=apprRows||[];
  const pendingRows=allApprRows.filter(a=>a.decision==='pending');
  const roleResult=resolveApprovalRole(dgEdges,pendingRows,state.email);
  const myApprRow=roleResult?roleResult.row:null;
  const myApprRole=roleResult?roleResult.role:null;
  const latestApproved=allApprRows.filter(a=>a.decision==='approved').sort((a,b)=>new Date(b.decided_at)-new Date(a.decided_at))[0];
  const isPendingApproval=t.status==='Awaiting Approval';
  const approvalOld=myApprRole==='current_approver'&&myApprRow.requested_at&&(Date.now()-new Date(myApprRow.requested_at).getTime())>2*24*60*60*1000;
  const stageText=myApprRole==='current_approver'?` from ${esc(nameOf(myApprRow.submitter))}`:'';
  const awaitingLabel=myApprRole==='current_approver'?`Awaiting Approval${stageText}${approvalOld?' (2+ days)':''}`:myApprRole==='done'?'Done':'Awaiting Approval';
  const statusTagHtml=t.status==='Completed'?statusTag('Completed'):isPendingApproval?`<span class="tag ${myApprRole==='done'?'t-blue':approvalOld?'t-red':'t-amber'}">${esc(awaitingLabel)}</span>`:statusTag(t.status);
  const apprText=(t.status==='Completed'&&latestApproved)?` · Approved by ${esc(nameOf(latestApproved.decided_by))}`:'';
  const showApprovalButtons=isPendingApproval&&myApprRole==='current_approver';
  window.__TS_OPEN=window.__TS_OPEN||{};
  const tsOpen=!!window.__TS_OPEN[id];
  // The can_delegate profile toggle only gates handing out brand-new work (creating a task and
  // assigning it to someone else). Once a task has actually reached you through delegation, you can
  // always pass it on further — the chain has to be able to keep going indefinitely. This must check
  // the delegation chain (task_delegations), NOT t.owner/task_members directly — taskDelegateSave
  // reassigns owner and deletes task_members rows on every re-delegation, so someone still legitimately
  // in the chain (e.g. a co-assignee who hasn't delegated yet) would otherwise lose the button the
  // moment anyone else in the chain delegates further.
  const canDelegateThis=!!(t.project_id&&(inDelegationChain||t.owner===state.email||mem.some(m=>m.email===state.email))&&t.status!=='Completed');
  const isCurrentHolder=!t.project_id||t.owner===state.email||mem.some(m=>m.email===state.email);
  const canComplete=isCurrentHolder||inDelegationChain;
  const completeBtnHtml=t.status==='Completed'
    ?(!canComplete?`<button class="btn" disabled title="Only ${esc(nameOf(t.owner))} or someone in this task's delegation chain can reopen it"><i class="fa-solid fa-lock"></i> Completed</button>`
      :`<button class="btn btn-primary" onclick="taskMarkComplete(${id},false)"><i class="fa-solid fa-circle-check"></i> Completed</button>`)
    :isPendingApproval
    ?`<button class="btn" disabled><i class="fa-solid ${myApprRole==='done'?'fa-check':'fa-hourglass-half'}"></i> ${myApprRole==='done'?'Done':'Awaiting Approval'}</button>`
    :!canComplete
    ?`<button class="btn" disabled title="Only ${esc(nameOf(t.owner))} or someone in this task's delegation chain can ask for approval"><i class="fa-solid fa-lock"></i> Ask Approval</button>`
    :`<button class="btn" onclick="taskMarkComplete(${id},true)"><i class="fa-solid fa-paper-plane"></i> Ask Approval</button>`;
  // Same "Assigned/Delegated to {avatars} by {name}" treatment as the project row label, but computed
  // from this specific viewer's local hop (ownerEmail/originalTeam above) so it matches what's actually
  // shown in Details → Members just below it.
  const dgWord=!dgEdges.length?'':(!myDirectDelegator?'Assigned':dgCtx==='delegated'?(t.created_by===state.email?'Assigned':'Delegated'):(myDirectDelegator===t.created_by?'Assigned':'Delegated'));
  const subLabel=t.kind==='delegation'?'Delegated to <b>'+esc(nameOf(t.assigned_to))+'</b> by '+esc(nameOf(t.created_by)):t.project_id?(dgEdges.length?dgRowLabelHtml(dgWord,originalTeam,ownerEmail):'Delegated to <b>'+esc(nameOf(t.owner))+'</b> by '+esc(nameOf(t.created_by))):'Owned by <b>'+esc(nameOf(t.owner))+'</b>';
  v.innerHTML=`<div class="page-head"><div><button class="btn btn-sm" onclick="goBack('documents')"><i class="fa-solid fa-arrow-left"></i> Back</button>
    ${proj?`<div style="margin-top:10px"><span class="tag t-blue" style="cursor:pointer" onclick="location.hash='#/tasks/project/${proj.id}'"><i class="fa-solid fa-diagram-project"></i> ${esc(proj.name)}</span></div>`:goalP?`<div style="margin-top:10px"><span class="tag t-amber" style="cursor:pointer" onclick="location.hash='#/tasks/goal/${goalP.id}'"><i class="fa-solid fa-bullseye"></i> ${esc(goalP.name)}</span></div>`:''}
    <h1 style="margin-top:10px">${t.kind==='delegation'?'<i class="fa-solid fa-share-nodes" style="color:#0f766e"></i> ':''}${esc(t.title)}</h1>
    <p>${subLabel} · ${statusTagHtml}${apprText}</p></div>
    <div class="th-actions">
      ${completeBtnHtml}
      <button class="btn" onclick="tkToggleTS(${id})"><i class="fa-solid fa-list-check"></i> Time Sheet${clTotal?` (${clDone}/${clTotal})`:''}</button>
      ${canDelegateThis?`<button class="btn" onclick="taskDelegateModal(${id},${t.project_id})"><i class="fa-solid fa-share-nodes"></i> Delegate</button>`:''}
      ${showApprovalButtons?`<div class="th-appr-grp">
        <button class="btn btn-ok" onclick="taskApprove(${myApprRow.id},${id})"><i class="fa-solid fa-check"></i> Approve</button>
        <button class="btn btn-danger-solid" onclick="taskDecline(${myApprRow.id},${id})"><i class="fa-solid fa-xmark"></i> Decline</button>
      </div>`:''}
    </div>
  </div>
  <div class="card card-pad"><div class="sec-title">Description</div><div style="margin-top:6px;font-size:14px;color:#334155;line-height:1.6">${t.description||'<span style="color:#94a3b8">No description</span>'}</div></div>
  <div class="${tsOpen?'grid grid-2':''}" style="margin-top:12px;align-items:start">
  ${tsOpen?`<div class="card card-pad"><div class="sec-title" style="display:flex;justify-content:space-between;align-items:center">Time sheet <span style="font-weight:400;color:var(--slate);text-transform:none;font-size:11.5px">optional</span> ${clTotal?`<span style="font-size:12px;font-weight:500;color:var(--slate)">${clDone}/${clTotal} · ${clPct}%</span>`:''}</div>
    ${clTotal?`<div class="progress" style="margin-top:8px"><span style="width:${clPct}%"></span></div>`:''}
    <div id="clList" style="margin-top:8px">${cl.map(c=>clItem(c,id)).join('')||'<div style="color:var(--slate);font-size:13px">No items yet — add one to start tracking progress.</div>'}</div>
    <button class="btn btn-sm btn-primary" style="margin-top:10px" onclick="subTaskModal(${id})"><i class="fa-solid fa-plus"></i> Add item</button>
  </div>`:''}
  <div class="card card-pad" style="text-align:center;padding-top:14px;padding-bottom:16px"><div class="sec-title" style="text-align:left">Progress</div>
    <div style="position:relative;width:${tsOpen?110:150}px;height:${tsOpen?110:150}px;margin:10px auto"><canvas id="chTask"></canvas><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:${tsOpen?20:26}px;font-weight:700">${t.progress}%</div></div>
    <div style="color:var(--slate);font-size:12.5px">${clTotal?`Auto-tracked from ${clDone}/${clTotal} Time Sheet items`:'No Time Sheet items yet — tracked manually until you add some'}</div>
    <div class="info-divider" style="margin:14px 0"></div>
    <div style="display:flex;justify-content:space-around;gap:10px;text-align:center">
      <div><div style="font-size:10.5px;color:var(--slate);text-transform:uppercase;letter-spacing:.4px;font-weight:700;margin-bottom:5px">Status</div>${statusTag(t.status)}</div>
      <div><div style="font-size:10.5px;color:var(--slate);text-transform:uppercase;letter-spacing:.4px;font-weight:700;margin-bottom:5px">Due</div><div style="font-size:13px;font-weight:600;${t.due_date&&t.due_date<todayStr()&&t.status!=='Completed'?'color:var(--err)':''}">${t.due_date?fmtDateShort(t.due_date):'Not set'}</div></div>
      <div><div style="font-size:10.5px;color:var(--slate);text-transform:uppercase;letter-spacing:.4px;font-weight:700;margin-bottom:5px">Updated</div><div style="font-size:13px;font-weight:600">${relTime(t.updated_at)}</div></div>
    </div>
  </div>
  </div>
  <div class="card card-pad" style="margin-top:12px"><div class="sec-title"><i class="fa-solid fa-bullhorn"></i> Updates & Feedback</div>
    <div id="cmList" class="chat-wrap" style="margin-top:8px">${(comments||[]).map(c=>cmItem(c,id)).join('')||'<div style="color:var(--slate);font-size:13px">No updates yet — post the first one.</div>'}</div>
    <div id="cmFileChip" style="display:none;align-items:center;gap:8px;margin-top:8px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;font-size:12.5px;color:var(--slate);width:fit-content"><i class="fa-solid fa-paperclip"></i><span id="cmFileName"></span><i class="fa-solid fa-xmark" style="cursor:pointer;color:var(--err)" onclick="cmClearFile()"></i></div>
    <input type="file" id="cmFile" style="display:none" onchange="cmFilePicked(this)">
    <div class="chat-composer"><button class="btn" title="Attach a file" onclick="document.getElementById('cmFile').click()"><i class="fa-solid fa-paperclip"></i></button><input id="cmNew" placeholder="Post an update or feedback…" onkeydown="if(event.key==='Enter')cmAdd(${id})"><button class="btn btn-primary" onclick="cmAdd(${id})"><i class="fa-solid fa-paper-plane"></i></button></div>
  </div>
  <div class="card card-pad" style="margin-top:12px">
    <div class="sec-title" style="display:flex;justify-content:space-between;align-items:center">Details ${canEdit?`<button class="btn btn-sm" onclick='taskEditModal(${id},${JSON.stringify(originalTeam)})'><i class="fa-solid fa-pen"></i> Edit</button>`:''}</div>
    <div class="info-grid">
      <div class="fld"><div class="k"><i class="fa-solid fa-calendar-day"></i> Due date</div><div class="v date-field"><input type="date" id="tkDueEdit" value="${t.due_date||''}" style="border:1px solid var(--line);border-radius:6px;padding:4px 7px;font-size:13px;font-family:inherit;font-weight:600;color:var(--ink)"><button class="file-act-btn" title="Save" onclick="taskUpdateDue(${id})"><i class="fa-solid fa-check"></i></button>${dueHist.length?`<button class="file-act-btn" title="History" onclick="toggleHist('tkDueHist',event)"><i class="fa-solid fa-clock-rotate-left"></i></button>`:''}</div></div>
      <div class="fld"><div class="k"><i class="fa-regular fa-calendar"></i> Created</div><div class="v">${fmtDate(t.created_at)}</div></div>
      <div class="fld"><div class="k"><i class="fa-regular fa-user"></i> Owner</div><div class="v">${avatar(nameOf(ownerEmail))} ${esc(nameOf(ownerEmail))}</div></div>
      <div class="fld"><div class="k"><i class="fa-solid fa-circle-dot"></i> Status</div><div class="v">${statusTag(t.status)}</div></div>
    </div>
    ${dueHist.length?`<div id="tkDueHist" class="hist-section">
      <div class="h-title"><i class="fa-solid fa-clock-rotate-left"></i> Due date history</div>
      ${dueHist.slice().reverse().map(h=>`<div class="h-row">${h.old?fmtDateShort(h.old):'Not set'} <i class="fa-solid fa-arrow-right"></i> <b>${h.new?fmtDateShort(h.new):'Not set'}</b> <span class="h-meta">· ${esc(nameOf(h.by))}, ${relTime(h.at)}</span></div>`).join('')}
    </div>`:''}
    <div class="info-divider"></div>
    <div class="info-sub" style="display:flex;justify-content:space-between;align-items:center">Attachments <span class="attach-actions" style="display:flex;gap:6px">
      <button class="btn btn-sm" onclick="filesDownloadSel('tkAttachList')"><i class="fa-solid fa-download"></i> Download</button>
      <button class="btn btn-sm btn-danger" onclick="taskAttachDeleteSel(${id})"><i class="fa-solid fa-trash"></i> Delete</button>
      <button class="btn btn-sm" onclick="document.getElementById('tkAttachAdd').click()"><i class="fa-solid fa-paperclip"></i> Add</button>
    </span></div>
    <input type="file" id="tkAttachAdd" style="display:none" onchange="taskAttachUpload(${id},this)">
    <div id="tkAttachList" class="attach-grid">${(files||[]).map(f=>`<label class="attach-card"><input type="checkbox" class="checkbox attach-chk" data-id="${f.id}" data-path="${esc(f.storage_path)}" data-name="${esc(f.file_name)}"><i class="fa-solid fa-paperclip"></i><span class="name" title="${esc(f.file_name)}">${esc(f.file_name)}</span></label>`).join('')||'<span style="color:var(--slate);font-size:12px">None</span>'}</div>
    <div class="info-divider"></div>
    <div class="info-sub">Members</div>
    <div class="people-grid">${originalTeam.filter((x,i,a)=>a.indexOf(x)===i).map(e=>`<span class="people-chip">${avatar(nameOf(e))} ${esc(nameOf(e))}</span>`).join('')||'<span style="color:var(--slate);font-size:12px">None</span>'}</div>
    <div class="info-divider"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px">
      <button class="btn btn-sm" onclick="taskArchive(${id},${t.archived})"><i class="fa-solid fa-box-archive"></i> ${t.archived?'Unarchive':'Archive'}</button>
      ${(t.owner===state.email||state.super)?`<button class="btn btn-sm btn-danger" onclick="taskDelete(${id})"><i class="fa-solid fa-trash"></i> Delete</button>`:''}
    </div>
  </div>`;
  const pct=t.progress;
  new Chart($('chTask'),{type:'doughnut',data:{datasets:[{data:[pct,100-pct],backgroundColor:[pct===100?'#16a34a':'#1d4ed8','#eef1f6'],borderWidth:0}]},options:{cutout:'78%',plugins:{legend:{display:false},tooltip:{enabled:false}}}});
  const cmW=$('cmList');if(cmW)cmW.scrollTop=cmW.scrollHeight;
}
function clItem(c,taskId){
  const assignees=c.assignees||[];
  return `<div class="ts-item drag-row" draggable="true" data-id="${c.id}"
      ondragstart="event.dataTransfer.setData('text/plain','${c.id}');this.classList.add('dragging')"
      ondragend="this.classList.remove('dragging')"
      ondragover="event.preventDefault();taskDragOver(event,this)"
      ondragleave="this.classList.remove('drop-above','drop-below')"
      ondrop="clReorderDrop(event,this,${taskId})">
    <i class="fa-solid fa-grip-vertical drag-handle"></i>
    <input type="checkbox" class="checkbox" ${c.done?'checked':''} onchange="event.stopPropagation();clToggle(${c.id},this.checked,${taskId})">
    <div class="ts-body" onclick="tsViewPopup(${c.id})">
      <span class="ts-name" style="${c.done?'text-decoration:line-through;color:#94a3b8':''}">${esc(c.label)}</span>
      <span class="ts-mem avatar-stack">${assignees.slice(0,3).map(e=>avatar(nameOf(e))).join('')}</span>
    </div>
    <i class="fa-solid fa-xmark" title="Remove" style="cursor:pointer;color:var(--err);font-size:13px;padding:4px" onclick="event.stopPropagation();clDelete(${c.id},${taskId})"></i>
  </div>`;
}
window.clReorderDrop=async function(e,row,taskId){
  e.preventDefault();
  const above=row.classList.contains('drop-above');
  row.classList.remove('drop-above','drop-below');
  const draggedId=parseInt(e.dataTransfer.getData('text/plain'));
  const targetId=parseInt(row.dataset.id);
  if(!draggedId||draggedId===targetId)return;
  let order=(window.__TS_ORDER||[]).slice();
  order=order.filter(cid=>cid!==draggedId);
  let idx=order.indexOf(targetId);
  if(idx===-1)idx=order.length;
  order.splice(above?idx:idx+1,0,draggedId);
  window.__TS_ORDER=order;
  await Promise.all(order.map((cid,i)=>sb.schema('acc').from('task_checklist').update({sort:i}).eq('id',cid)));
  taskDetail($('view'),taskId);
};
window.tsViewPopup=function(cid){
  const c=(window.__TS_ITEMS||{})[cid];if(!c)return;
  const assignees=c.assignees||[];
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-list-check"></i> Sub task</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body">
      <div style="font-size:11px;color:var(--slate);text-transform:uppercase;font-weight:700;letter-spacing:.4px;margin-bottom:7px">Name</div>
      <div style="font-size:15.5px;font-weight:600;margin-bottom:20px;${c.done?'text-decoration:line-through;color:#94a3b8':''}">${esc(c.label)}</div>
      <div style="font-size:11px;color:var(--slate);text-transform:uppercase;font-weight:700;letter-spacing:.4px;margin-bottom:10px">Members</div>
      <div style="display:flex;flex-direction:column;gap:12px">${assignees.length?assignees.map(e=>`<div style="display:flex;align-items:center;gap:10px">${avatar(nameOf(e))}<span style="font-size:13.5px">${esc(nameOf(e))}</span></div>`).join(''):'<span style="color:var(--slate);font-size:13px">No members assigned</span>'}</div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>`);
};
window.subTaskModal=async function(taskId){
  const [{data:t},{data:mem}]=await Promise.all([
    sb.schema('acc').from('tasks').select('owner,assigned_to').eq('id',taskId).single(),
    sb.schema('acc').from('task_members').select('email').eq('task_id',taskId)
  ]);
  const people=new Set([t&&(t.owner||t.assigned_to),...(mem||[]).map(m=>m.email)].filter(Boolean));
  const singlePerson=people.size<=1;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-list-check"></i> Add sub task</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm">
      <label>Name</label><input id="stName" placeholder="e.g. Collect site photos">
      ${singlePerson?'':`<label>Members</label>${msHtml('stMembers')}`}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="subTaskSave(${taskId})"><i class="fa-solid fa-check"></i> Add</button></div>`,'xl');
  if(!singlePerson)setTimeout(()=>msInit('stMembers',[]),30);
};
window.subTaskSave=async function(taskId){
  const name=$('stName').value.trim();if(!name){toast('Enter a name','err');return;}
  const assignees=getMS('stMembers');
  await sb.schema('acc').from('task_checklist').insert({task_id:taskId,label:name,assignees});
  await recalcTaskProgress(taskId);
  closeModal();
  taskDetail($('view'),taskId);
};
function cmItem(c,taskId){
  const mine=c.author===state.email;
  return `<div class="chat-msg ${mine?'mine':''}">
    ${mine?'':avatar(nameOf(c.author))}
    <div style="min-width:0">
      <div class="chat-meta"><b>${esc(mine?'You':nameOf(c.author))}</b><span>${relTime(c.created_at)}${c.edited?' · edited':''}</span></div>
      <div class="chat-bubble">
        <div id="cm_body_${c.id}">${esc(c.body)}</div>
      </div>
    </div>
  </div>`;
}
window.tkToggleTS=function(id){window.__TS_OPEN=window.__TS_OPEN||{};window.__TS_OPEN[id]=!window.__TS_OPEN[id];taskDetail($('view'),id);};
window.taskUpdateDue=async function(id){
  const val=$('tkDueEdit').value||null;
  const {data:cur}=await sb.schema('acc').from('tasks').select('due_date,due_date_history').eq('id',id).single();
  const hist=(cur&&cur.due_date_history)||[];
  const oldVal=cur?cur.due_date:null;
  if(oldVal===val){toast('No change','ok');return;}
  hist.push({old:oldVal,new:val,by:state.email,at:new Date().toISOString()});
  const {error}=await sb.schema('acc').from('tasks').update({due_date:val,due_date_history:hist}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  await sb.schema('acc').from('task_activity').insert({task_id:id,actor:state.email,action:'changed the due date'});
  toast('Due date updated','ok');taskDetail($('view'),id);
};
window.taskUpdateProgress=async function(id){
  const p=Math.min(100,Math.max(0,parseInt($('tkProgManual').value)||0));
  const {data:cur}=await sb.schema('acc').from('tasks').select('status').eq('id',id).single();
  let status=cur?cur.status:null;
  if(p===100)status='Completed';else if(status==='Completed')status='Pending';
  const {error}=await sb.schema('acc').from('tasks').update({progress:p,status}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  await sb.schema('acc').from('task_activity').insert({task_id:id,actor:state.email,action:'updated progress to '+p+'%'});
  toast('Progress updated','ok');taskDetail($('view'),id);
};
async function recalcTaskProgress(id){
  const {data:cl}=await sb.schema('acc').from('task_checklist').select('done').eq('task_id',id);
  const items=cl||[];
  const {data:cur}=await sb.schema('acc').from('tasks').select('status').eq('id',id).single();
  let status=cur?cur.status:null;
  if(!items.length){
    // no Time sheet items — progress must show 0%, and it can't stay Completed without one
    if(status==='Completed')status='Pending';
    await sb.schema('acc').from('tasks').update({progress:0,status}).eq('id',id);
    return;
  }
  const p=Math.round(items.filter(c=>c.done).length/items.length*100);
  if(p===100)status='Completed';else if(status==='Completed')status='Pending';
  await sb.schema('acc').from('tasks').update({progress:p,status}).eq('id',id);
}
const NEEDS_TASK_PAGE_MSG='Open the task and click Ask Approval — this task needs sign-off before it can be marked complete.';
/* when a task is marked Completed, its Time sheet sub-items should all be ticked off too */
async function completeTaskChecklist(taskId){
  await sb.schema('acc').from('task_checklist').update({done:true}).eq('task_id',taskId).eq('done',false);
}
async function completeTaskChecklists(taskIds){
  if(!taskIds||!taskIds.length)return;
  await sb.schema('acc').from('task_checklist').update({done:true}).in('task_id',taskIds).eq('done',false);
}
window.clAdd=async function(id){const t=$('clNew').value.trim();if(!t)return;await sb.schema('acc').from('task_checklist').insert({task_id:id,label:t});await recalcTaskProgress(id);taskDetail($('view'),id);};
window.clToggle=async function(cid,done,taskId){await sb.schema('acc').from('task_checklist').update({done}).eq('id',cid);await recalcTaskProgress(taskId);taskDetail($('view'),taskId);};
window.clDelete=async function(cid,taskId){await sb.schema('acc').from('task_checklist').delete().eq('id',cid);await recalcTaskProgress(taskId);taskDetail($('view'),taskId);};
window.toggleHist=function(id,e){if(e)e.stopPropagation();const el=$(id);if(!el)return;const willShow=!el.classList.contains('show');document.querySelectorAll('.hist-section.show').forEach(x=>x.classList.remove('show'));if(willShow){el.classList.add('show');el.scrollIntoView({behavior:'smooth',block:'nearest'});}};
window.cmFilePicked=function(inputEl){
  const f=inputEl.files[0];const chip=$('cmFileChip'),nm=$('cmFileName');
  if(!f){if(chip)chip.style.display='none';return;}
  if(nm)nm.textContent=f.name;if(chip)chip.style.display='flex';
};
window.cmClearFile=function(){const inp=$('cmFile');if(inp)inp.value='';const chip=$('cmFileChip');if(chip)chip.style.display='none';};
window.cmAdd=async function(id){
  const bEl=$('cmNew');const b=(bEl.value||'').trim();
  const fEl=$('cmFile');const f=fEl&&fEl.files&&fEl.files[0];
  if(!b&&!f)return;
  let body=b;
  if(f){
    const {data:t2}=await sb.schema('acc').from('tasks').select('kind').eq('id',id).single();
    const key=s3KeyForTask(id,t2&&t2.kind==='delegation',f.name);
    toast('Uploading '+f.name+'\u2026','ok');
    const {data:upData,error:ue}=await uploadFileToS3(key,f);
    if(ue){toast('Attachment upload failed: '+ue.message,'err');return;}
    await sb.schema('acc').from('task_files').insert({task_id:id,file_name:f.name,storage_path:upData.path,file_size:f.size,uploaded_by:state.email});
    body=(b?b+' ':'')+'\ud83d\udcce '+f.name;
  }
  await sb.schema('acc').from('task_comments').insert({task_id:id,author:state.email,body});
  await sb.schema('acc').from('task_activity').insert({task_id:id,actor:state.email,action:'commented'});
  taskDetail($('view'),id);
};
window.cmEdit=function(cid,taskId){
  const el=$('cm_body_'+cid);if(!el)return;const cur=el.textContent;
  el.innerHTML=`<div style="display:flex;gap:8px"><input id="cmEditIn_${cid}" class="sel" style="flex:1;height:32px" value="${esc(cur)}"><button class="btn btn-sm btn-primary" onclick="cmEditSave(${cid},${taskId})"><i class="fa-solid fa-check"></i></button></div>`;
  $('cmEditIn_'+cid).focus();
};
window.cmEditSave=async function(cid,taskId){
  const v=$('cmEditIn_'+cid).value.trim();if(!v)return;
  const {error}=await sb.schema('acc').from('task_comments').update({body:v,edited:true}).eq('id',cid);
  if(error){toast(error.message,'err');return;}
  toast('Comment updated','ok');taskDetail($('view'),taskId);
};
window.cmDelete=async function(cid,taskId){
  if(!await confirmDialog('Delete this comment?'))return;
  const {error}=await sb.schema('acc').from('task_comments').delete().eq('id',cid);
  if(error){toast(error.message,'err');return;}
  toast('Comment deleted','ok');taskDetail($('view'),taskId);
};
window.taskArchive=async function(id,cur){await sb.schema('acc').from('tasks').update({archived:!cur}).eq('id',id);toast(cur?'Unarchived':'Archived','ok');taskDetail($('view'),id);};
/* Ask Approval / reopen. makeComplete=true is the "Ask Approval" click while Pending — the server
   RPC (acc.task_ask_approval) decides for itself whether this viewer has anyone to ask (climbs the
   delegation chain one hop) or is root for this branch and can complete outright. makeComplete=false
   is a plain reopen (Completed -> Pending), no approval involved either way. */
window.taskMarkComplete=async function(id,makeComplete){
  if(makeComplete){
    const {data:resultStatus,error}=await sb.schema('acc').rpc('task_ask_approval',{tid:id});
    if(error){toast(error.message,'err');return;}
    await sb.schema('acc').from('task_activity').insert({task_id:id,actor:state.email,action:resultStatus==='Completed'?'marked this task complete':'asked for approval on this task'});
    const {data:t2}=await sb.schema('acc').from('tasks').select('project_id,goal_id').eq('id',id).single();
    if(t2&&t2.project_id)await recalcProjectProgress(t2.project_id);
    if(t2&&t2.goal_id)await recalcGoalProgress(t2.goal_id);
    toast(resultStatus==='Awaiting Approval'?'Sent for approval':'Marked complete','ok');
  }else{
    await sb.schema('acc').from('tasks').update({status:'Pending'}).eq('id',id);
    await recalcTaskProgress(id);
    await sb.schema('acc').from('task_activity').insert({task_id:id,actor:state.email,action:'reopened this task'});
    const {data:t2}=await sb.schema('acc').from('tasks').select('project_id,goal_id').eq('id',id).single();
    if(t2&&t2.project_id)await recalcProjectProgress(t2.project_id);
    if(t2&&t2.goal_id)await recalcGoalProgress(t2.goal_id);
    toast('Reopened','ok');
  }
  taskDetail($('view'),id);
};
async function advanceApprovalCore(approvalId,taskId,decision){
  const {data,error}=await sb.schema('acc').rpc('task_approval_decide',{aid:approvalId,decision});
  if(!error)await sb.schema('acc').from('task_activity').insert({task_id:taskId,actor:state.email,action:decision==='approve'?'approved this task':'declined this task'});
  return {data,error};
}
window.taskApprove=async function(approvalId,taskId){
  const {data:result,error}=await advanceApprovalCore(approvalId,taskId,'approve');
  if(error){toast(error.message,'err');return;}
  toast(result==='approved'?'Approved — task completed':'Approved — sent up for further approval','ok');
  taskDetail($('view'),taskId);
  refreshNotifState();
};
window.taskDecline=async function(approvalId,taskId){
  if(!await confirmDialog('Decline this task? It will be sent back and marked as needing rework.'))return;
  const {error}=await advanceApprovalCore(approvalId,taskId,'decline');
  if(error){toast(error.message,'err');return;}
  toast('Task declined — add feedback below','ok');
  await taskDetail($('view'),taskId);
  refreshNotifState();
  const wrap=document.querySelector('.chat-wrap');if(wrap)wrap.scrollIntoView({behavior:'smooth',block:'center'});
  const cm=$('cmNew');if(cm)cm.focus();
};
window.notifApprove=async function(e,approvalId,taskId){
  e.stopPropagation();
  const {error}=await advanceApprovalCore(approvalId,taskId,'approve');
  if(error){toast(error.message,'err');return;}
  toast('Approved','ok');
  renderNotifDropdown();
  refreshNotifState();
  if(location.hash.includes('/tasks/view/'+taskId))taskDetail($('view'),taskId);
};
window.taskDelete=async function(id){
  if(!await confirmDialog('Delete this task permanently?'))return;
  const {data:files}=await sb.schema('acc').from('task_files').select('storage_path').eq('task_id',id);
  for(const f of (files||[])){ if(f.storage_path){ if(isS3Path(f.storage_path)) await s3Delete(f.storage_path); else await sb.storage.from('documents').remove([f.storage_path]); } }
  // Only the current owner can delete (enforced by RLS too) — .select() so a permission mismatch
  // shows up as "0 rows" instead of a false "Deleted" toast over a task that's actually still there.
  const {data:del,error}=await sb.schema('acc').from('tasks').delete().eq('id',id).select('id');
  if(error){toast(error.message,'err');return;}
  if(!del||!del.length){toast('Only the current owner can delete this task','err');return;}
  toast('Deleted','ok');location.hash='#/tasks/list';
};
window.taskEditModal=async function(id,currentTeam){
  const {data:t,error}=await sb.schema('acc').from('tasks').select('*').eq('id',id).single();
  if(error||!t){toast('Could not load task','err');return;}
  let scopedPeople=null;
  const {data:curMem}=await sb.schema('acc').from('task_members').select('email').eq('task_id',id);
  const current=(curMem||[]).map(m=>m.email);
  if(t.project_id){
    const [{data:pmem},{data:proj},{data:powners}]=await Promise.all([
      sb.schema('acc').from('project_members').select('email').eq('project_id',t.project_id),
      sb.schema('acc').from('projects').select('owner,created_by').eq('id',t.project_id).single(),
      sb.schema('acc').from('project_owners').select('email').eq('project_id',t.project_id)
    ]);
    const emails=new Set((pmem||[]).map(m=>m.email));
    (powners||[]).forEach(o=>emails.add(o.email));
    if(proj){if(proj.owner)emails.add(proj.owner);if(proj.created_by)emails.add(proj.created_by);}
    scopedPeople=(PEOPLE||[]).filter(p=>emails.has(p.email));
  } else if(t.goal_id){
    const [{data:gmem},{data:g}]=await Promise.all([
      sb.schema('acc').from('goal_members').select('email').eq('goal_id',t.goal_id),
      sb.schema('acc').from('goals').select('owner,created_by').eq('id',t.goal_id).single()
    ]);
    const emails=new Set((gmem||[]).map(m=>m.email));
    if(g){if(g.owner)emails.add(g.owner);if(g.created_by)emails.add(g.created_by);}
    scopedPeople=(PEOPLE||[]).filter(p=>emails.has(p.email));
  }
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Edit task</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm">
      <label>Title</label><input id="teTitle" value="${esc(t.title)}">
      <label>Description</label>
      <div style="border:1px solid var(--line);border-radius:8px;overflow:hidden">
        <div style="display:flex;gap:2px;padding:6px;border-bottom:1px solid var(--line);background:#fafbfd">
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button>
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button>
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertUnorderedList')"><i class="fa-solid fa-list-ul"></i></button>
        </div>
        <div id="teDesc" contenteditable="true" style="min-height:70px;padding:10px 12px;font-size:13.5px;outline:none">${t.description||''}</div>
      </div>
      ${t.project_id?`<label>Assignees <span style="font-weight:400;color:var(--slate);text-transform:none;font-size:11.5px">— project members</span></label>${msHtml('teAssignTo')}`:`<label>Owner</label><select id="teOwner">${peopleOptions(t.owner)}</select>
      <label>Members</label>${msHtml('teMembers')}`}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="taskEditSave(${id})"><i class="fa-solid fa-check"></i> Save</button></div>`,'lg');
  // Pre-select whatever Details → Members is actually showing this viewer (the stable, per-viewer
  // delegation-chain group) — NOT t.owner/task_members directly, since those get rewritten to whoever
  // currently "holds" the task on every re-delegation and can drift from what Members displays.
  const preSelect=(currentTeam&&currentTeam.length)?currentTeam:[t.owner,...current];
  if(t.project_id)setTimeout(()=>msInit('teAssignTo',preSelect.filter(Boolean),scopedPeople),30);
  else setTimeout(()=>msInit('teMembers',current,scopedPeople),30);
};
window.taskEditSave=async function(id){
  const title=$('teTitle').value.trim();if(!title){toast('Enter a title','err');return;}
  const isProj=!!$('ms_teAssignTo');
  let owner;
  if(isProj){
    const assignTo=getMS('teAssignTo');
    if(!assignTo.length){toast('Select at least one assignee','err');return;}
    owner=assignTo[0];
  }else{
    owner=$('teOwner').value;
  }
  const desc=$('teDesc').innerHTML;
  const next=new Set(isProj?getMS('teAssignTo').filter(e=>e!==owner):getMS('teMembers'));
  // Members shown in Task Detail come from task_delegations (MY outgoing edges for this task), not
  // task_members — so the Assignees picker has to reconcile edges too, not just task_members, or
  // removing someone here never actually makes them disappear as a Member. Work out what that
  // reconciliation would require, and confirm with the editor BEFORE writing anything, so a "no" on
  // the sub-branch warning leaves the task completely untouched rather than half-saved.
  let removeDeleg=[],addDeleg=[];
  if(isProj){
    const wanted=new Set([owner,...next].filter(e=>e&&e!==state.email));
    const {data:myEdges}=await sb.schema('acc').from('task_delegations').select('delegatee').eq('task_id',id).eq('delegator',state.email);
    const haveOutgoing=new Set((myEdges||[]).map(e=>e.delegatee));
    const candidateAdds=[...wanted].filter(e=>!haveOutgoing.has(e));
    removeDeleg=[...haveOutgoing].filter(e=>!wanted.has(e));
    // A person can only ever be delegated to once per task (one delegator each) — if someone I'm
    // trying to add already has an edge under a DIFFERENT delegator (they're already part of another
    // branch on this same task, e.g. someone my delegatee already sub-delegated to), silently
    // inserting a second edge would just no-op against the unique constraint while task_members still
    // "added" them — the exact half-saved state that made this look broken. Block those specific
    // additions and say so instead.
    addDeleg=candidateAdds;
    if(candidateAdds.length){
      const {data:existingElsewhere}=await sb.schema('acc').from('task_delegations').select('delegatee,delegator').eq('task_id',id).in('delegatee',candidateAdds).neq('delegator',state.email);
      if(existingElsewhere&&existingElsewhere.length){
        const blocked=new Set(existingElsewhere.map(e=>e.delegatee));
        const blockedNames=existingElsewhere.map(e=>`${nameOf(e.delegatee)} (already under ${nameOf(e.delegator)})`).join(', ');
        toast(`Couldn't add ${blockedNames} — already assigned to this task under someone else.`,'err');
        addDeleg=candidateAdds.filter(e=>!blocked.has(e));
        blocked.forEach(e=>next.delete(e));
      }
    }
    if(removeDeleg.length){
      const {data:subEdges}=await sb.schema('acc').from('task_delegations').select('delegator').eq('task_id',id).in('delegator',removeDeleg);
      if(subEdges&&subEdges.length){
        const names=[...new Set(subEdges.map(e=>e.delegator))].map(nameOf).join(', ');
        if(!await confirmDialog(`${names} already delegated part of this task further. Removing them will also remove that branch. Continue?`))return;
      }
    }
  }
  const {error}=await sb.schema('acc').from('tasks').update({title,description:desc,owner}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  const {data:curMem}=await sb.schema('acc').from('task_members').select('email').eq('task_id',id);
  const current=new Set((curMem||[]).map(m=>m.email));
  const toAdd=[...next].filter(e=>!current.has(e));
  const toRemove=[...current].filter(e=>!next.has(e));
  if(toAdd.length)await sb.schema('acc').from('task_members').insert(toAdd.map(e=>({task_id:id,email:e})));
  for(const e of toRemove){await sb.schema('acc').from('task_members').delete().eq('task_id',id).eq('email',e);}
  const {data:t2}=await sb.schema('acc').from('tasks').select('project_id,goal_id').eq('id',id).single();
  if(t2&&(t2.project_id||t2.goal_id))await syncParentMembership(t2.project_id,t2.goal_id,[owner,...next]);
  if(t2&&t2.project_id){
    if(removeDeleg.length)await cascadeDeleteDelegationBranch(id,removeDeleg);
    if(addDeleg.length)await insertDelegationEdges(id,state.email,addDeleg);
  }
  closeModal();toast('Task updated','ok');taskDetail($('view'),id);
};
/* ---- sub-delegation: hand a project task off to someone else, preserving the chain ---- */
window.taskDelegateModal=async function(taskId,projectId){
  // Sub-delegation can go to anyone in the org, not just existing project members — whoever it's handed
  // to is auto-added to the project so they can see it (syncParentMembership). But each delegatee belongs
  // privately to whoever handed it to them: exclude anyone already ANYWHERE in this task's delegation
  // graph, so the same task can never fork to the same person via two separate branches.
  const {data:existingEdges}=await sb.schema('acc').from('task_delegations').select('delegatee').eq('task_id',taskId);
  const claimed=new Set([state.email,...(existingEdges||[]).map(d=>d.delegatee)]);
  const scopedPeople=(PEOPLE||[]).filter(p=>!claimed.has(p.email));
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-share-nodes"></i> Delegate this task</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm">
      <div style="color:var(--slate);font-size:12px;margin-bottom:6px">Hand this task off to one or more people. You'll keep visibility, but they become the ones working it.</div>
      <label>Delegate to</label>${msHtml('tdgTo')}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="taskDelegateSave(${taskId})"><i class="fa-solid fa-check"></i> Delegate</button></div>`,'lg');
  setTimeout(()=>msInit('tdgTo',[],scopedPeople),30);
};
window.taskDelegateSave=async function(taskId){
  const to=getMS('tdgTo');
  if(!to.length){toast('Select at least one person','err');return;}
  const {data:t}=await sb.schema('acc').from('tasks').select('project_id,owner').eq('id',taskId).single();
  if(!t){toast('Could not load task','err');return;}
  await insertDelegationEdges(taskId,state.email,to);
  const wasOwner=t.owner===state.email;
  if(wasOwner){
    await sb.schema('acc').from('tasks').update({owner:to[0]}).eq('id',taskId);
    const rest=to.slice(1);
    if(rest.length)await sb.schema('acc').from('task_members').insert(rest.map(e=>({task_id:taskId,email:e})));
  }else{
    await sb.schema('acc').from('task_members').delete().eq('task_id',taskId).eq('email',state.email);
    const {data:curMem}=await sb.schema('acc').from('task_members').select('email').eq('task_id',taskId);
    const have=new Set((curMem||[]).map(m=>m.email));
    const toAdd=to.filter(e=>!have.has(e)&&e!==t.owner);
    if(toAdd.length)await sb.schema('acc').from('task_members').insert(toAdd.map(e=>({task_id:taskId,email:e})));
  }
  if(t.project_id)await syncParentMembership(t.project_id,null,to);
  await sb.schema('acc').from('task_activity').insert({task_id:taskId,actor:state.email,action:'delegated this task to '+to.map(nameOf).join(', ')});
  closeModal();toast('Delegated','ok');taskDetail($('view'),taskId);
};
window.taskFileDl=async function(path,name){
  if(isS3Path(path)){ await s3OpenSigned(path,name||'download'); return; }
  const {data,error}=await sb.storage.from('task-attachments').createSignedUrl(path,120,{download:name});if(error){toast(error.message,'err');return;}window.open(data.signedUrl,'_blank');
};
window.taskAttachUpload=async function(id,inputEl){
  const f=inputEl.files[0];if(!f)return;
  const t2=await sb.schema('acc').from('tasks').select('kind').eq('id',id).single();
  const key=s3KeyForTask(id,t2.data&&t2.data.kind==='delegation',f.name);
  toast('Uploading '+f.name+'…','ok');
  const {data:upData,error:ue}=await uploadFileToS3(key,f);
  if(ue){toast('Attachment upload failed: '+ue.message,'err');inputEl.value='';return;}
  const {error}=await sb.schema('acc').from('task_files').insert({task_id:id,file_name:f.name,storage_path:upData.path,file_size:f.size,uploaded_by:state.email});
  if(error){toast(error.message,'err');return;}
  toast('Attachment added','ok');taskDetail($('view'),id);
};
window.taskAttachDelete=async function(id,fileId,path){
  if(!await confirmDialog('Remove this attachment?'))return;
  if(path){ if(isS3Path(path)) await s3Delete(path); else await sb.storage.from('task-attachments').remove([path]); }
  await sb.schema('acc').from('task_files').delete().eq('id',fileId);
  toast('Attachment removed','ok');taskDetail($('view'),id);
};
window.taskAttachDeleteSel=async function(id){
  const checked=[...document.querySelectorAll('#tkAttachList .attach-chk:checked')];
  if(!checked.length)return;
  if(!await confirmDialog(`Delete ${checked.length} file(s)?`))return;
  for(const cb of checked){
    const path=cb.dataset.path;
    if(path){ if(isS3Path(path)) await s3Delete(path); else await sb.storage.from('task-attachments').remove([path]); }
    await sb.schema('acc').from('task_files').delete().eq('id',cb.dataset.id);
  }
  toast('Attachments removed','ok');taskDetail($('view'),id);
};

/* ---------- projects (now the content of the Tasks tab) ---------- */
const PFILTER={prio:'All',status:'All'};
window.pfPrioChange=function(v){PFILTER.prio=v;taskProjects($('view'));};
window.pfStatusChange=function(v){PFILTER.status=v;taskProjects($('view'));};
async function taskProjects(v){
  setCrumb(['Accountability','Projects']);
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-diagram-project" style="color:#1d4ed8"></i> Projects</h1><p>Group tasks by project and share them with your team</p></div>
    <button class="btn btn-primary" onclick="projectCreateModal()"><i class="fa-solid fa-plus"></i> New Project</button></div>`+taskTabs('list')+
    `<div class="toolbar" style="justify-content:flex-end;gap:8px">
      ${fsGroupHtml('pfGroup',[
        {key:'pfPrio',label:'Priority',options:['Low','Medium','High','Urgent'],current:PFILTER.prio,cb:'pfPrioChange'},
        {key:'pfStatus',label:'Status',options:['Pending','In Progress','Completed'],current:PFILTER.status,cb:'pfStatusChange'}
      ])}
    </div><div id="projBody"><div class="loader"><div class="spin"></div></div></div>`;
  const me=state.email;
  let projects=await fetchMyProjects(me);
  if(PFILTER.prio!=='All')projects=projects.filter(p=>p.priority===PFILTER.prio);
  if(PFILTER.status!=='All')projects=projects.filter(p=>p.status===PFILTER.status);
  // Not every task lives inside a project — solo tasks and one-off delegations don't. Rather than
  // leave those scattered and hard to find, a virtual "No Project" card gathers them here too,
  // filtered the same way (respects the same Priority/Status pickers isn't meaningful for it since
  // it has no priority/status of its own — it's just a doorway to noProjectDetail's own task list).
  let noProjCount=0;
  try{const {count}=await sb.schema('acc').from('tasks').select('id',{count:'exact',head:true}).is('project_id',null).is('goal_id',null);noProjCount=count||0;}catch(e){}
  const noProjCard=`<div class="card card-pad" style="cursor:pointer" onclick="location.hash='#/tasks/project/none'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start"><div class="ic" style="width:42px;height:42px;border-radius:11px;background:#f1f5f9;color:#64748b;display:flex;align-items:center;justify-content:center;font-size:17px"><i class="fa-solid fa-folder-open"></i></div></div>
      <div style="font-weight:600;font-size:15px;margin-top:12px">No Project</div>
      <div style="color:var(--slate);font-size:12.5px;margin-top:4px;min-height:34px">Solo tasks and one-off delegations not tied to any project</div>
      <div style="font-size:12px;color:var(--slate);margin-top:10px">${noProjCount} task${noProjCount===1?'':'s'}</div></div>`;
  if(!projects.length){$('projBody').innerHTML=`<div class="grid lib-grid">${noProjCard}</div>`;return;}
  const ids=projects.map(p=>p.id);
  const taskCounts={};
  try{const {data}=await sb.schema('acc').from('tasks').select('id,project_id,status').in('project_id',ids);(data||[]).forEach(t=>{const c=taskCounts[t.project_id]||{total:0,done:0};c.total++;if(t.status==='Completed')c.done++;taskCounts[t.project_id]=c;});}catch(e){}
  const memberCounts={};
  try{const {data}=await sb.schema('acc').from('project_members').select('project_id').in('project_id',ids);(data||[]).forEach(m=>{memberCounts[m.project_id]=(memberCounts[m.project_id]||0)+1;});}catch(e){}
  $('projBody').innerHTML=`<div class="grid lib-grid">${noProjCard}${projects.map(p=>{
    const c=taskCounts[p.id]||{total:0,done:0};
    const pct=c.total?Math.round(c.done/c.total*100):0;
    const mcount=memberCounts[p.id]||0;
    return `<div class="card card-pad" style="cursor:pointer" onclick="location.hash='#/tasks/project/${p.id}'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start"><div class="ic" style="width:42px;height:42px;border-radius:11px;background:#eff4ff;color:#1d4ed8;display:flex;align-items:center;justify-content:center;font-size:17px"><i class="fa-solid fa-diagram-project"></i></div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${prioTag(p.priority)}${statusTag(p.status)}</div></div>
      <div style="font-weight:600;font-size:15px;margin-top:12px">${esc(p.name)}</div>
      <div style="color:var(--slate);font-size:12.5px;margin-top:4px;min-height:34px">${esc((p.description||'').replace(/<[^>]+>/g,'').slice(0,80))}</div>
      <div style="font-size:12px;color:var(--slate);margin-top:10px">${mcount} member${mcount===1?'':'s'} · ${c.total} task${c.total===1?'':'s'}${c.total?' · '+c.done+' completed':''}</div></div>`;
  }).join('')}</div>`;
}
/* ---- virtual "No Project" bucket: tasks/delegations with no project_id (and no goal_id), grouped
   the same way Home groups them (My Tasks / Assigned To Me / Assigned By Me), just without any of
   the owners/members/attachments machinery a real project has since there's no project row to hang
   that off of. ---- */
const NOPFILTER={status:'All'};
window.nopStatusChange=function(v){NOPFILTER.status=v;noProjectDetail($('view'));};
function noProjRowHtml(t){
  return `<div class="drag-row" style="cursor:pointer" onclick="location.hash='#/tasks/view/${t.id}'">
    <div style="flex:1;min-width:0">
      <div style="font-weight:600;font-size:13px">${esc(t.title)}</div>
      <div style="color:var(--slate);font-size:11.5px">${t.due_date?'Due '+fmtDateShort(t.due_date):'No due date'}</div>
    </div>
    ${statusTag(t.status)}
    <div style="width:42px;text-align:right;font-size:12px;font-weight:600;color:var(--brand)">${t.progress}%</div>
  </div>`;
}
function noProjListHtml(tasks){
  if(!tasks.length)return '<div class="empty" style="padding:22px"><i class="fa-regular fa-circle-check"></i><div>No tasks</div></div>';
  return `<div class="drag-list">${tasks.map(noProjRowHtml).join('')}</div>`;
}
async function noProjectDetail(v){
  loader(v);
  setCrumb(['Accountability',['Projects','#/tasks/list'],'No Project']);
  const me=state.email;
  const {data:tasks}=await sb.schema('acc').from('tasks').select('*').is('project_id',null).is('goal_id',null).order('due_date',{ascending:true});
  let list=tasks||[];
  if(NOPFILTER.status!=='All')list=list.filter(t=>t.status===NOPFILTER.status);
  const myTasks=list.filter(t=>t.kind!=='delegation'&&t.owner===me);
  const toMe=list.filter(t=>t.kind==='delegation'&&t.assigned_to===me&&t.created_by!==me);
  const byMe=list.filter(t=>t.kind==='delegation'&&t.created_by===me&&t.assigned_to!==me);
  v.innerHTML=`<div class="page-head"><div><button class="btn btn-sm" onclick="goBack('tasks/list')"><i class="fa-solid fa-arrow-left"></i> Back</button>
    <h1 style="margin-top:10px"><i class="fa-solid fa-folder-open" style="color:#64748b"></i> No Project</h1>
    <p>Solo tasks and one-off delegations not tied to any project</p></div>
    <div>${fsHtml('nopStatus','Status',['Pending','Awaiting Approval','Completed'],NOPFILTER.status,'nopStatusChange')}</div>
  </div>
  <div class="card card-pad"><div class="sec-title">My Tasks <span class="tag t-gray" style="margin-left:4px">${myTasks.length}</span></div>
    <div style="margin-top:6px">${noProjListHtml(myTasks)}</div></div>
  <div class="card card-pad" style="margin-top:12px"><div class="sec-title">Assigned To Me <span class="tag t-gray" style="margin-left:4px">${toMe.length}</span></div>
    <div style="margin-top:6px">${noProjListHtml(toMe)}</div></div>
  <div class="card card-pad" style="margin-top:12px"><div class="sec-title">Assigned By Me <span class="tag t-gray" style="margin-left:4px">${byMe.length}</span></div>
    <div style="margin-top:6px">${noProjListHtml(byMe)}</div></div>`;
}
window.projectCreateModal=function(){
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-diagram-project"></i> New project</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Project name</label><input id="pjName" placeholder="e.g. Dream Eco City Launch">
    <label>Description</label>
    <div style="border:1px solid var(--line);border-radius:8px;overflow:hidden">
      <div style="display:flex;gap:2px;padding:6px;border-bottom:1px solid var(--line);background:#fafbfd">
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertUnorderedList')"><i class="fa-solid fa-list-ul"></i></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertOrderedList')"><i class="fa-solid fa-list-ol"></i></button>
      </div>
      <div id="pjDesc" contenteditable="true" style="min-height:80px;padding:10px 12px;font-size:13.5px;outline:none"></div>
    </div>
    <label>Owners</label>
    <div style="color:var(--slate);font-size:12px;margin:-3px 0 6px">Owners can manage this project's members, owners, and settings.</div>
    ${msHtml('pjOwners')}
    <div class="two"><div><label>Priority</label><select id="pjPrio"><option>Low</option><option selected>Medium</option><option>High</option><option>Urgent</option></select></div>
    <div><label>Due date (optional)</label><input type="date" id="pjDue"></div></div>
    <label>Members</label>${msHtml('pjMembers')}
    <label>Status</label><div class="seg" id="pjStatusSeg">${['Pending','In Progress','Completed'].map((x,i)=>'<button type="button" class="seg-btn'+(i===0?' on':'')+'" onclick="pjPickStatus(this,\''+x+'\')">'+x+'</button>').join('')}</div><input type="hidden" id="pjStatus" value="Pending">
    <label>Attachment (optional)</label>
    <div class="dropzone" onclick="document.getElementById('pjFile').click()"><i class="fa-solid fa-paperclip"></i><div id="pjFName">Click to choose a file</div></div>
    <input type="file" id="pjFile" class="hidden" onchange="document.getElementById('pjFName').textContent=this.files[0]?this.files[0].name:'Click to choose a file'">
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="pjSave" onclick="projectSave()"><i class="fa-solid fa-check"></i> Create project</button></div>`,'lg');
  setTimeout(()=>{msInit('pjOwners',[state.email],null,false,[state.email]);msInit('pjMembers',[]);},30);
};
window.pjPickStatus=function(btn,val){document.querySelectorAll('#pjStatusSeg .seg-btn').forEach(b=>b.classList.remove('on'));btn.classList.add('on');$('pjStatus').value=val;};
window.projectSave=async function(){
  const name=$('pjName').value.trim();if(!name){toast('Enter a project name','err');return;}
  const owners=getMS('pjOwners');if(!owners.length){toast('Select at least one owner','err');return;}
  const status=$('pjStatus').value;
  const row={name,description:$('pjDesc').innerHTML,owner:owners[0],created_by:state.email,priority:$('pjPrio').value,due_date:$('pjDue').value||null,progress:0,status};
  const btn=$('pjSave');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';
  const {data,error}=await sb.schema('acc').from('projects').insert(row).select().single();
  if(error){toast(error.message,'err');btn.disabled=false;return;}
  await sb.schema('acc').from('project_owners').insert(owners.map((e,i)=>({project_id:data.id,email:e,rank:i})));
  const mem=getMS('pjMembers');if(mem.length)await sb.schema('acc').from('project_members').insert(mem.map(e=>({project_id:data.id,email:e})));
  const f=$('pjFile').files[0];
  if(f){const key=s3KeyForProject(data.id,f.name);const {data:upData,error:ue}=await uploadFileToS3(key,f);if(ue)toast('Project created, but attachment upload failed: '+ue.message,'err');else await sb.schema('acc').from('project_files').insert({project_id:data.id,file_name:f.name,storage_path:upData.path,file_size:f.size,uploaded_by:state.email});}
  closeModal();toast('Project created','ok');location.hash='#/tasks/project/'+data.id;route();
};
const PJTFILTER={status:'All',person:'All',stage:'All'};
window.pjtStatusChange=function(v){PJTFILTER.status=v;projectDetail($('view'),window.__PJT_ID);};
window.pjtPersonChange=function(v){PJTFILTER.person=v;projectDetail($('view'),window.__PJT_ID);};
window.pjtStageChange=function(v){PJTFILTER.stage=v;projectDetail($('view'),window.__PJT_ID);};
window.pjDelSetTab=function(tab){window.__PJ_DEL_TAB=tab;PJTFILTER.person='All';projectDetail($('view'),window.__PJT_ID);};
/* Per-task approval role resolution, shared by taskDetail (single task) and projectDetail (list —
   called once per task with that task's own slice of edges/pending rows). A pending task_approvals
   row climbs hop-by-hop (current_approver moves up the delegation chain per approval). Walking from
   the row's submitter up through the edges tells us whether "me" is the current approver, already
   signed off ("done" — passed already, even though the overall task is still climbing toward the
   root Assignor), or not involved in this particular branch at all (returns null — keeps one
   branch's approval chatter from leaking into an unrelated branch/viewer). */
function resolveApprovalRole(edgesForTask,pendingRowsForTask,me){
  const directDelegatorOf=who=>{const e=edgesForTask.find(d=>d.delegatee===who);return e?e.delegator:null;};
  let best=null;
  for(const row of (pendingRowsForTask||[])){
    let role=null;
    if(row.current_approver===me)role='current_approver';
    else if(row.submitter===me)role='done';
    else{
      let walker=row.submitter;
      for(let i=0;i<50&&walker&&walker!==row.current_approver;i++){
        walker=directDelegatorOf(walker);
        if(walker===me){role='done';break;}
      }
    }
    if(role==='current_approver')return {role,row};
    if(role==='done'&&!best)best={role,row};
  }
  return best;
}
/* Todo/Followup stage for one task, from one viewer's side of a delegation edge.
   tab: 'tome' = I'm the recipient (Assigned to me); 'mine' = I'm the delegator (Assigned by me).
   Rule of thumb: Todo = it's my move right now; Followup = I'm waiting on the other party;
   null = nothing to act on (already Completed) — drops out of both filtered views, though it still
   shows up normally when Stage isn't filtered. Relies on t._apprRole, set by the caller from a
   resolveApprovalRole() call scoped to this task. */
function pjDgTodoFollowup(t,tab){
  if(t.status==='Completed')return null;
  if(tab==='tome'){
    if(t.status==='Pending')return 'todo';
    if(t.status==='Awaiting Approval')return 'followup';
    return null;
  }
  if(t.status==='Pending')return 'followup';
  if(t.status==='Awaiting Approval')return t._apprRole==='current_approver'?'todo':'followup';
  return null;
}
async function projectDetail(v,id){
  loader(v);
  window.__PJT_ID=id;
  const {data:p,error}=await sb.schema('acc').from('projects').select('*').eq('id',id).single();
  if(error||!p){v.innerHTML='<div class="empty"><i class="fa-solid fa-ban"></i><div>Project not found or no access</div></div>';return;}
  setCrumb(['Accountability',['Projects','#/tasks/list'],p.name]);
  const [{data:members},{data:tasks},{data:files},{data:ownerRows},{data:delegations}]=await Promise.all([
    sb.schema('acc').from('project_members').select('*').eq('project_id',id),
    sb.schema('acc').from('tasks').select('*').eq('project_id',id).order('due_date',{ascending:true}),
    sb.schema('acc').from('project_files').select('*').eq('project_id',id),
    sb.schema('acc').from('project_owners').select('email,rank').eq('project_id',id).order('rank',{ascending:true}),
    sb.schema('acc').from('task_delegations').select('task_id,delegator,delegatee')
  ]);
  const mem=members||[];const list=tasks||[];const me=state.email;
  const owners=(ownerRows&&ownerRows.length)?ownerRows.map(o=>o.email):[p.owner].filter(Boolean);
  const dgs=(delegations||[]).filter(d=>list.some(t=>t.id===d.task_id));
  const awaitingIds=list.filter(t=>t.status==='Awaiting Approval').map(t=>t.id);
  const {data:apprAll}=awaitingIds.length?await sb.schema('acc').from('task_approvals').select('*').in('task_id',awaitingIds).eq('decision','pending'):{data:[]};
  const roleForTask=tid=>resolveApprovalRole(dgs.filter(d=>d.task_id===tid),(apprAll||[]).filter(a=>a.task_id===tid),me);
  const iDelegatedIds=new Set(dgs.filter(d=>d.delegator===me).map(d=>d.task_id));
  const toMeIds=new Set(dgs.filter(d=>d.delegatee===me).map(d=>d.task_id));
  // Each person's "Assigned by me"/"Assigned to me" shows ONLY their own direct edge for this task —
  // whoever they personally delegated to, or whoever personally delegated to them. Nothing further
  // down or up the chain is resolved or surfaced: sub-delegation stays fully invisible beyond one hop.
  const iGaveTo={};dgs.filter(d=>d.delegator===me).forEach(d=>{(iGaveTo[d.task_id]=iGaveTo[d.task_id]||[]).push(d.delegatee);});
  const iGotFrom={};dgs.filter(d=>d.delegatee===me).forEach(d=>{(iGotFrom[d.task_id]=iGotFrom[d.task_id]||[]).push(d.delegator);});
  let flist=list;
  if(PJTFILTER.status!=='All')flist=flist.filter(t=>t.status===PJTFILTER.status);
  // Within each tab, rows split into "Task Assigned" vs "Task Delegated" based on the task's true
  // original creator (created_by), the root of its delegation graph. On "Assigned by me": if I'm the
  // creator handing it out directly, that's a first-hop Task Assigned; if I received it from someone
  // else and passed it on, that's a Task Delegated re-hop. On "Assigned to me": getting it straight
  // from the creator is Task Assigned; getting it from anyone further down the chain is Task Delegated.
  // Row label in the project list stays plain text — the richer "Assigned/Delegated to {avatars} by
  // {name}" treatment lives on the Task Detail page under the task title instead (see taskDetail).
  let delegatedList=flist.filter(t=>iDelegatedIds.has(t.id)).map(t=>({...t,_dgLabel:'To '+(iGaveTo[t.id]||[]).map(nameOf).join(', '),_bucket:t.created_by===me?'assigned':'delegated',_needsApproval:!!(iGotFrom[t.id]||[]).length,_apprRole:(roleForTask(t.id)||{}).role||null}));
  const delegatedToMeList=flist.filter(t=>toMeIds.has(t.id)||t.owner===me).map(t=>{
    const fromCreator=(iGotFrom[t.id]||[]).includes(t.created_by);
    return {...t,_dgLabel:(iGotFrom[t.id]||[]).length?'From '+iGotFrom[t.id].map(nameOf).join(', '):'Assigned to you',_bucket:(!toMeIds.has(t.id)||fromCreator)?'assigned':'delegated',_needsApproval:!!(iGotFrom[t.id]||[]).length,_apprRole:(roleForTask(t.id)||{}).role||null};
  });
  // Someone who isn't permitted to delegate never has an "Assigned by me" side to show.
  const canDelegateAtAll=!!(state.profile&&state.profile.can_delegate);
  const pjDelTab=canDelegateAtAll?(window.__PJ_DEL_TAB||'tome'):'tome';
  // Person filter — delegator-only: everyone I've personally delegated a task to in this project
  const personOpts=[...new Set(Object.values(iGaveTo).flat())].map(nameOf).filter(Boolean);
  if(pjDelTab==='mine'&&PJTFILTER.person!=='All')delegatedList=delegatedList.filter(t=>(iGaveTo[t.id]||[]).map(nameOf).includes(PJTFILTER.person));
  let curPjList=pjDelTab==='mine'?delegatedList:delegatedToMeList;
  if(PJTFILTER.stage!=='All'){const stageWant=PJTFILTER.stage.toLowerCase();curPjList=curPjList.filter(t=>pjDgTodoFollowup(t,pjDelTab)===stageWant);}
  const pjBucketAssigned=curPjList.filter(t=>t._bucket==='assigned');
  const pjBucketDelegated=curPjList.filter(t=>t._bucket==='delegated');
  const canManage=state.super||owners.includes(me)||p.created_by===me;
  const peopleList=[...owners,...mem.map(m=>m.email)].filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i);
  const dueHist=p.due_date_history||[];
  const statusOpts=['Pending','Awaiting Approval','Completed'];
  v.innerHTML=`<div class="page-head"><div><button class="btn btn-sm" onclick="goBack('tasks/list')"><i class="fa-solid fa-arrow-left"></i> Back</button>
    <h1 style="margin-top:10px"><i class="fa-solid fa-diagram-project" style="color:#1d4ed8"></i> ${esc(p.name)}</h1>
    <p>Owned by <b>${owners.length?owners.map(e=>esc(nameOf(e))).join(', '):esc(nameOf(p.created_by))}</b> · ${prioTag(p.priority)} ${statusTag(p.status)} · ${mem.length} member${mem.length===1?'':'s'} · ${list.length} task${list.length===1?'':'s'}</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="taskCreateModal('task',${id},'${esc(p.name).replace(/'/g,"\\'")}')"><i class="fa-solid fa-share-nodes"></i> Assign Task</button>
    </div></div>
  <div class="card card-pad"><div class="sec-title">Description</div><div style="margin-top:6px;font-size:14px;color:#334155;line-height:1.6">${p.description||'<span style="color:#94a3b8">No description</span>'}</div></div>
  <div class="card card-pad" style="margin-top:12px"><div class="sec-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
    <div class="seg" id="pjDelSeg">
      <button type="button" class="seg-btn ${pjDelTab==='tome'?'on':''}" onclick="pjDelSetTab('tome')">Assigned to me <span class="tag t-gray" style="margin-left:4px">${delegatedToMeList.length}</span></button>
      ${canDelegateAtAll?`<button type="button" class="seg-btn ${pjDelTab==='mine'?'on':''}" onclick="pjDelSetTab('mine')">Assigned by me <span class="tag t-gray" style="margin-left:4px">${delegatedList.length}</span></button>`:''}
    </div>
    <span style="display:flex;gap:8px">
      ${fsGroupHtml('pjtGroup',[
        {key:'pjtStatus',label:'Status',options:statusOpts,current:PJTFILTER.status,cb:'pjtStatusChange'},
        {key:'pjtStage',label:'Stage',options:['Todo','Followup'],current:PJTFILTER.stage,cb:'pjtStageChange'},
        pjDelTab==='mine'&&personOpts.length?{key:'pjtPerson',label:'Person',options:personOpts,current:PJTFILTER.person,cb:'pjtPersonChange'}:null
      ])}
    </span></div>
    <div style="margin-top:14px"><div style="font-size:11.5px;font-weight:700;color:var(--slate);text-transform:uppercase;letter-spacing:.5px">Task Assigned <span class="tag t-gray" style="margin-left:4px">${pjBucketAssigned.length}</span></div>
      <div style="margin-top:6px">${renderTaskDragList(pjBucketAssigned,'project',id,pjDelTab==='mine'?'delegated':'received')}</div></div>
    <div style="margin-top:16px"><div style="font-size:11.5px;font-weight:700;color:var(--slate);text-transform:uppercase;letter-spacing:.5px">Task Delegated <span class="tag t-gray" style="margin-left:4px">${pjBucketDelegated.length}</span></div>
      <div style="margin-top:6px">${renderTaskDragList(pjBucketDelegated,'project',id,pjDelTab==='mine'?'delegated':'received')}</div></div>
  </div>
  <div class="card card-pad" style="margin-top:12px">
    <div class="sec-title" style="display:flex;justify-content:space-between;align-items:center">Details <button class="btn btn-sm" onclick="projectEditModal(${id})"><i class="fa-solid fa-pen"></i> Edit</button></div>
    <div class="info-grid">
      <div class="fld"><div class="k"><i class="fa-solid fa-calendar-day"></i> Due date</div><div class="v date-field"><input type="date" id="pjDueEdit" value="${p.due_date||''}" style="border:1px solid var(--line);border-radius:6px;padding:4px 7px;font-size:13px;font-family:inherit;font-weight:600;color:var(--ink)"><button class="file-act-btn" title="Save" onclick="projectUpdateDue(${id})"><i class="fa-solid fa-check"></i></button>${dueHist.length?`<button class="file-act-btn" title="History" onclick="toggleHist('pjDueHist',event)"><i class="fa-solid fa-clock-rotate-left"></i></button>`:''}</div></div>
      <div class="fld"><div class="k"><i class="fa-regular fa-calendar"></i> Created</div><div class="v">${fmtDate(p.created_at)}</div></div>
      <div class="fld"><div class="k"><i class="fa-solid fa-flag"></i> Priority</div><div class="v">${prioTag(p.priority)}</div></div>
      <div class="fld"><div class="k"><i class="fa-solid fa-circle-dot"></i> Status</div><div class="v">${statusTag(p.status)}</div></div>
    </div>
    ${dueHist.length?`<div id="pjDueHist" class="hist-section">
      <div class="h-title"><i class="fa-solid fa-clock-rotate-left"></i> Due date history</div>
      ${dueHist.slice().reverse().map(h=>`<div class="h-row">${h.old?fmtDateShort(h.old):'Not set'} <i class="fa-solid fa-arrow-right"></i> <b>${h.new?fmtDateShort(h.new):'Not set'}</b> <span class="h-meta">· ${esc(nameOf(h.by))}, ${relTime(h.at)}</span></div>`).join('')}
    </div>`:''}
    <div class="info-divider"></div>
    <div class="info-sub" style="display:flex;justify-content:space-between;align-items:center">Attachments <span class="attach-actions" style="display:flex;gap:6px">
      <button class="btn btn-sm" onclick="filesDownloadSel('pjAttachList')"><i class="fa-solid fa-download"></i> Download</button>
      <button class="btn btn-sm btn-danger" onclick="projectAttachDeleteSel(${id})"><i class="fa-solid fa-trash"></i> Delete</button>
      <button class="btn btn-sm" onclick="document.getElementById('pjAttachAdd').click()"><i class="fa-solid fa-paperclip"></i> Add</button>
    </span></div>
    <input type="file" id="pjAttachAdd" style="display:none" onchange="projectAttachUpload(${id},this)">
    <div id="pjAttachList" class="attach-grid">${(files||[]).map(f=>`<label class="attach-card"><input type="checkbox" class="checkbox attach-chk" data-id="${f.id}" data-path="${esc(f.storage_path)}" data-name="${esc(f.file_name)}"><i class="fa-solid fa-paperclip"></i><span class="name" title="${esc(f.file_name)}">${esc(f.file_name)}</span></label>`).join('')||'<span style="color:var(--slate);font-size:12px">None</span>'}</div>
    <div class="info-divider"></div>
    <div class="info-sub" style="display:flex;justify-content:space-between;align-items:center">Owners ${canManage?`<button class="btn btn-sm" onclick="projectOwnersModal(${id})"><i class="fa-solid fa-user-shield"></i> Manage</button>`:''}</div>
    <div class="people-grid">${owners.map(e=>`<span class="people-chip">${avatar(nameOf(e))} ${esc(nameOf(e))}</span>`).join('')||'<span style="color:var(--slate);font-size:13px">No owners</span>'}</div>
    <div class="info-divider"></div>
    <div class="info-sub">Members ${canManage?`<button class="btn btn-sm" onclick="projectMembersModal(${id})"><i class="fa-solid fa-user-plus"></i> Manage</button>`:''}</div>
    <div class="people-grid">${peopleList.map(e=>`<span class="people-chip">${avatar(nameOf(e))} ${esc(nameOf(e))} ${owners.includes(e)?'<i class="fa-solid fa-shield-halved" style="color:#1d4ed8;font-size:10px" title="Owner"></i>':''}</span>`).join('')||'<span style="color:var(--slate);font-size:12px">None</span>'}</div>
    ${canManage?`<div class="info-divider"></div><div style="display:flex;justify-content:flex-end"><button class="btn btn-sm btn-danger" onclick="projectDelete(${id})"><i class="fa-solid fa-trash"></i> Delete project</button></div>`:''}
  </div>`;
  wireProjTaskDrag('project',id);
}
window.projectUpdateDue=async function(id){
  const val=$('pjDueEdit').value||null;
  const {data:cur}=await sb.schema('acc').from('projects').select('due_date,due_date_history').eq('id',id).single();
  const hist=(cur&&cur.due_date_history)||[];
  const oldVal=cur?cur.due_date:null;
  if(oldVal===val){toast('No change','ok');return;}
  hist.push({old:oldVal,new:val,by:state.email,at:new Date().toISOString()});
  const {error}=await sb.schema('acc').from('projects').update({due_date:val,due_date_history:hist}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  toast('Due date updated','ok');projectDetail($('view'),id);
};
async function recalcProjectProgress(projectId){
  const {data:tasks}=await sb.schema('acc').from('tasks').select('status').eq('project_id',projectId);
  const items=tasks||[];const total=items.length;
  const done=items.filter(t=>t.status==='Completed').length;
  const p=total?Math.round(done/total*100):0;
  let status=(total&&p===100)?'Completed':p>0?'In Progress':'Pending';
  await sb.schema('acc').from('projects').update({progress:p,status}).eq('id',projectId);
}
window.pjTaskToggle=async function(taskId,projectId,done){
  if(done){
    const {data:resultStatus,error}=await sb.schema('acc').rpc('task_ask_approval',{tid:taskId});
    if(error){toast(error.message,'err');projectDetail($('view'),projectId);return;}
    if(resultStatus==='Awaiting Approval'){toast(NEEDS_TASK_PAGE_MSG,'warn');projectDetail($('view'),projectId);return;}
    await sb.schema('acc').from('task_activity').insert({task_id:taskId,actor:state.email,action:'marked this task complete'});
    toast('Marked complete','ok');
  }else{
    await sb.schema('acc').from('tasks').update({status:'Pending'}).eq('id',taskId);
    await recalcTaskProgress(taskId);
    toast('Reopened','ok');
  }
  await recalcProjectProgress(projectId);
  projectDetail($('view'),projectId);
};
/* ---- shared drag-to-reorder Task list for Projects & Goals (position = priority, doesn't touch the priority column) ---- */
function taskRowHtml(t,parentType,parentId,dgCtx){
  const toggleFn=parentType==='project'?'pjTaskToggle':'glTaskToggle';
  // dgCtx tags which tab this row was opened from ("received" = Assigned to me, "delegated" = Assigned by me)
  // so the Task Detail page knows which Members view to show — see taskDetail's originalTeam logic.
  const hashSuffix=dgCtx?'/'+dgCtx:'';
  // Whoever has nobody delegating this specific task TO them (root for their own branch, see
  // _needsApproval set by the caller) can tick the box straight from the row and it completes for
  // real. Everyone who'd actually need approval still has to open the task page.
  const canDirectCheck=t.status==='Pending'&&!t._needsApproval;
  const checkDisabled=!(t.status==='Completed'||canDirectCheck);
  return `<div class="drag-row" data-id="${t.id}">
    <i class="fa-solid fa-grip-vertical drag-handle"></i>
    <input type="checkbox" class="checkbox" ${t.status==='Completed'?'checked':''} ${checkDisabled?'disabled title="Open the task to mark it complete"':''} onchange="${toggleFn}(${t.id},${parentId},this.checked)">
    <div style="flex:1;min-width:0;cursor:pointer" onclick="location.hash='#/tasks/view/${t.id}${hashSuffix}'">
      <div style="font-weight:600;font-size:13px">${esc(t.title)}</div>
      <div style="color:var(--slate);font-size:11.5px">${t._dgLabel?'<span class="dg-label">'+t._dgLabel+' · </span>':''}${t.due_date?'Due '+fmtDateShort(t.due_date):'No due date'}</div>
    </div>
    ${statusTag(t.status)}
    <div style="width:42px;text-align:right;font-size:12px;font-weight:600;color:var(--brand)">${t.progress}%</div>
  </div>`;
}
function renderTaskDragList(tasks,parentType,parentId,dgCtx){
  const list=tasks.slice().sort((a,b)=>(a.sort_order??999999)-(b.sort_order??999999));
  if(parentType==='project')window.__PJT_ORDER=list.map(t=>t.id);
  else window.__GL_ORDER=list.map(t=>t.id);
  if(!list.length)return '<div class="empty" style="padding:22px"><i class="fa-regular fa-circle-check"></i><div>No tasks match</div></div>';
  return `<div class="drag-list">${list.map(t=>taskRowHtml(t,parentType,parentId,dgCtx)).join('')}</div>`;
}
/* ---- pointer-events drag-to-reorder (works on mouse + touch, unlike native HTML5 DnD) ---- */
function wireProjTaskDrag(parentType,parentId){
  document.querySelectorAll('.drag-list').forEach(list=>{
    list.querySelectorAll('.drag-row').forEach(row=>{
      const grip=row.querySelector('.drag-handle'); if(!grip)return;
      grip.style.touchAction='none';
      grip.onpointerdown=function(e){
        e.preventDefault(); e.stopPropagation();
        try{grip.setPointerCapture(e.pointerId);}catch(_){}
        window._dragging=true; row.classList.add('dragging');
        function move(ev){
          const el=document.elementFromPoint(ev.clientX,ev.clientY);
          const tgt=el&&el.closest('.drag-row');
          if(tgt&&tgt!==row&&list.contains(tgt)){
            const r=tgt.getBoundingClientRect();
            if(ev.clientY<r.top+r.height/2)list.insertBefore(row,tgt); else list.insertBefore(row,tgt.nextSibling);
          }
        }
        function up(){
          try{grip.releasePointerCapture(e.pointerId);}catch(_){}
          window._dragging=false; row.classList.remove('dragging');
          document.removeEventListener('pointermove',move);
          document.removeEventListener('pointerup',up);
          persistProjTaskOrder(list,parentType,parentId,Number(row.dataset.id));
        }
        document.addEventListener('pointermove',move);
        document.addEventListener('pointerup',up);
      };
    });
  });
}
async function persistProjTaskOrder(list,parentType,parentId,movedId){
  const ids=[...list.querySelectorAll('.drag-row')].map(r=>Number(r.dataset.id));
  /* The order the list was rendered in, which renderTaskDragList keeps. This runs on every
     pointerup on a grip - including a plain click, and a drag that was put back where it started -
     and both leave the order untouched. Without this comparison every one of those would have been
     counted as a reorder. */
  const was=(parentType==='project'?window.__PJT_ORDER:window.__GL_ORDER)||[];
  const moved=(was.length!==ids.length)||ids.some(function(id,i){return id!==was[i];});
  await Promise.all(ids.map((tid,i)=>sb.schema('acc').from('tasks').update({sort_order:i}).eq('id',tid)));
  // Logged directly rather than through USAGE_MAP's window[fn] wrapping: the drag reorder this
  // serves fires a pointerdown handler bound to this exact function reference at render time, and
  // usageAction() would misclassify it as 'view' anyway (nothing in "persistProjTaskOrder" matches
  // its verb regexes). See the same note on crystallizeAndSwap in accountability.js. The moved
  // task's own name is recorded, so the report's Details column has something to show.
  if(moved){
    try{
      let title=null;
      if(movedId!=null&&!isNaN(movedId)){
        const {data:mt}=await sb.schema('acc').from('tasks').select('title').eq('id',movedId).single();
        title=(mt&&mt.title)||null;
      }
      usageQueue('tasks.tasks.insert_a_task_at_a_specific_position','update',title?{title:title}:null);
    }catch(e){}
  }
  if(parentType==='project')projectDetail($('view'),parentId); else goalDetail($('view'),parentId);
}
window.taskDragOver=function(e,row){
  const r=row.getBoundingClientRect();
  const above=(e.clientY-r.top)<r.height/2;
  row.classList.toggle('drop-above',above);
  row.classList.toggle('drop-below',!above);
};
window.taskReorderDrop=async function(e,row,parentType,parentId){
  e.preventDefault();
  const above=row.classList.contains('drop-above');
  row.classList.remove('drop-above','drop-below');
  const draggedId=parseInt(e.dataTransfer.getData('text/plain'));
  const targetId=parseInt(row.dataset.id);
  if(!draggedId||draggedId===targetId)return;
  const orderKey=parentType==='project'?'__PJT_ORDER':'__GL_ORDER';
  let order=(window[orderKey]||[]).slice();
  order=order.filter(tid=>tid!==draggedId);
  let idx=order.indexOf(targetId);
  if(idx===-1)idx=order.length;
  order.splice(above?idx:idx+1,0,draggedId);
  window[orderKey]=order;
  await Promise.all(order.map((tid,i)=>sb.schema('acc').from('tasks').update({sort_order:i}).eq('id',tid)));
  if(parentType==='project')projectDetail($('view'),parentId);
  else goalDetail($('view'),parentId);
};
window.projectAttachUpload=async function(id,inputEl){
  const f=inputEl.files[0];if(!f)return;
  const key=s3KeyForProject(id,f.name);
  toast('Uploading '+f.name+'…','ok');
  const {data:upData,error:ue}=await uploadFileToS3(key,f);
  if(ue){toast('Attachment upload failed: '+ue.message,'err');inputEl.value='';return;}
  const {error}=await sb.schema('acc').from('project_files').insert({project_id:id,file_name:f.name,storage_path:upData.path,file_size:f.size,uploaded_by:state.email});
  if(error){toast(error.message,'err');return;}
  toast('Attachment added','ok');projectDetail($('view'),id);
};
window.projectAttachDelete=async function(id,fileId,path){
  if(!await confirmDialog('Remove this attachment?'))return;
  if(path){ if(isS3Path(path)) await s3Delete(path); else await sb.storage.from('documents').remove([path]); }
  await sb.schema('acc').from('project_files').delete().eq('id',fileId);
  toast('Attachment removed','ok');projectDetail($('view'),id);
};
window.filesDownloadSel=function(containerId){
  const checked=[...document.querySelectorAll('#'+containerId+' .attach-chk:checked')];
  if(!checked.length)return;
  checked.forEach((cb,i)=>setTimeout(()=>taskFileDl(cb.dataset.path,cb.dataset.name),i*300));
};
window.projectAttachDeleteSel=async function(id){
  const checked=[...document.querySelectorAll('#pjAttachList .attach-chk:checked')];
  if(!checked.length)return;
  if(!await confirmDialog(`Delete ${checked.length} file(s)?`))return;
  for(const cb of checked){
    const path=cb.dataset.path;
    if(path){ if(isS3Path(path)) await s3Delete(path); else await sb.storage.from('documents').remove([path]); }
    await sb.schema('acc').from('project_files').delete().eq('id',cb.dataset.id);
  }
  toast('Attachments removed','ok');projectDetail($('view'),id);
};
window.projectMembersModal=async function(id){
  const {data:members}=await sb.schema('acc').from('project_members').select('email').eq('project_id',id);
  const current=(members||[]).map(m=>m.email);
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-users"></i> Manage members</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm"><label>Members</label>${msHtml('pjmMembers')}</div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="projectMembersSave(${id})"><i class="fa-solid fa-check"></i> Save</button></div>`,'lg');
  setTimeout(()=>msInit('pjmMembers',current),30);
};
window.projectMembersSave=async function(id){
  const {data:members}=await sb.schema('acc').from('project_members').select('email').eq('project_id',id);
  const current=new Set((members||[]).map(m=>m.email));
  const next=new Set(getMS('pjmMembers'));
  const toAdd=[...next].filter(e=>!current.has(e));
  const toRemove=[...current].filter(e=>!next.has(e));
  if(toAdd.length)await sb.schema('acc').from('project_members').insert(toAdd.map(e=>({project_id:id,email:e})));
  for(const e of toRemove){await sb.schema('acc').from('project_members').delete().eq('project_id',id).eq('email',e);}
  closeModal();toast('Members updated','ok');projectDetail($('view'),id);
};
window.projectOwnersModal=async function(id){
  const [{data:owners},{data:proj}]=await Promise.all([
    sb.schema('acc').from('project_owners').select('email,rank').eq('project_id',id).order('rank',{ascending:true}),
    sb.schema('acc').from('projects').select('created_by').eq('id',id).single()
  ]);
  const creator=proj&&proj.created_by;
  const current=[...new Set([...(owners||[]).map(o=>o.email),...(creator?[creator]:[])])];
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-user-shield"></i> Manage owners</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm"><label>Owners</label>
  <div style="color:var(--slate);font-size:12px;margin:-3px 0 6px">Owners can manage this project's members, owners, and settings. The project creator always stays an owner.</div>
  ${msHtml('pjoOwners')}</div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="projectOwnersSave(${id})"><i class="fa-solid fa-check"></i> Save</button></div>`,'lg');
  setTimeout(()=>msInit('pjoOwners',current,null,false,creator?[creator]:[]),30);
};
window.projectOwnersSave=async function(id){
  const next=getMS('pjoOwners');
  if(!next.length){toast('A project needs at least one owner','err');return;}
  await sb.schema('acc').from('project_owners').delete().eq('project_id',id);
  await sb.schema('acc').from('project_owners').insert(next.map((email,i)=>({project_id:id,email,rank:i})));
  await sb.schema('acc').from('projects').update({owner:next[0]}).eq('id',id);
  closeModal();toast('Owners updated','ok');projectDetail($('view'),id);
};
window.projectDelete=async function(id){
  if(!await confirmDialog('Delete this project? Its tasks will remain but lose their project link.'))return;
  const {data:files}=await sb.schema('acc').from('project_files').select('storage_path').eq('project_id',id);
  for(const f of (files||[])){ if(f.storage_path){ if(isS3Path(f.storage_path)) await s3Delete(f.storage_path); else await sb.storage.from('documents').remove([f.storage_path]); } }
  await sb.schema('acc').from('projects').delete().eq('id',id);
  toast('Project deleted','ok');location.hash='#/tasks/list';
};
window.projectEditModal=async function(id){
  const {data:p,error}=await sb.schema('acc').from('projects').select('*').eq('id',id).single();
  if(error||!p){toast('Could not load project','err');return;}
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Edit project</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm">
      <label>Project name</label><input id="peName" value="${esc(p.name)}">
      <label>Description</label>
      <div style="border:1px solid var(--line);border-radius:8px;overflow:hidden">
        <div style="display:flex;gap:2px;padding:6px;border-bottom:1px solid var(--line);background:#fafbfd">
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button>
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button>
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertUnorderedList')"><i class="fa-solid fa-list-ul"></i></button>
        </div>
        <div id="peDesc" contenteditable="true" style="min-height:70px;padding:10px 12px;font-size:13.5px;outline:none">${p.description||''}</div>
      </div>
      <label>Priority</label><select id="pePrio">${['Low','Medium','High','Urgent'].map(x=>`<option ${x===p.priority?'selected':''}>${x}</option>`).join('')}</select>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="projectEditSave(${id})"><i class="fa-solid fa-check"></i> Save</button></div>`,'lg');
};
window.projectEditSave=async function(id){
  const name=$('peName').value.trim();if(!name){toast('Enter a project name','err');return;}
  const {error}=await sb.schema('acc').from('projects').update({name,description:$('peDesc').innerHTML,priority:$('pePrio').value}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  closeModal();toast('Project updated','ok');projectDetail($('view'),id);
};
window.projectMarkComplete=async function(id,makeComplete){
  if(makeComplete){
    const {data:tks}=await sb.schema('acc').from('tasks').select('id').eq('project_id',id);
    const ids=(tks||[]).map(t=>t.id);
    if(ids.length){
      await sb.schema('acc').from('tasks').update({status:'Completed',progress:100}).in('id',ids);
      await completeTaskChecklists(ids);
    }
    await sb.schema('acc').from('projects').update({status:'Completed',progress:100}).eq('id',id);
  }else{
    await sb.schema('acc').from('projects').update({status:'In Progress'}).eq('id',id);
    await recalcProjectProgress(id);
  }
  toast(makeComplete?'Project marked complete':'Reopened','ok');
  projectDetail($('view'),id);
};

/* ---------- goals ---------- */
let GSCOPE='personal';
const GFILTER={prio:'All',status:'All'};
window.gfPrioChange=function(v){GFILTER.prio=v;taskGoals($('view'));};
window.gfStatusChange=function(v){GFILTER.status=v;taskGoals($('view'));};
async function taskGoals(v){
  setCrumb(['Accountability','Goals']);
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-bullseye" style="color:#d97706"></i> Goals</h1><p>Track personal, team and company objectives</p></div>
    <button class="btn btn-primary" onclick="goalCreateModal()"><i class="fa-solid fa-plus"></i> New Goal</button></div>`+taskTabs('goals')+
    `<div class="toolbar" style="justify-content:flex-end;flex-wrap:wrap;gap:10px">
      <div style="display:flex;gap:8px">
        ${fsGroupHtml('gfGroup',[
          {key:'gfScope',label:'Scope',options:['Personal','Team','Company'],current:GSCOPE.charAt(0).toUpperCase()+GSCOPE.slice(1),cb:'gfScopeChange'},
          {key:'gfPrio',label:'Priority',options:['Low','Medium','High','Urgent'],current:GFILTER.prio,cb:'gfPrioChange'},
          {key:'gfStatus',label:'Status',options:['Pending','In Progress','Completed'],current:GFILTER.status,cb:'gfStatusChange'}
        ])}
      </div>
    </div><div id="goalBody"><div class="loader"><div class="spin"></div></div></div>`;
  const me=state.email;
  const {myGoalIds}=await fetchGoalMemberships(me);
  let goalsRaw=[];try{const {data}=await sb.schema('acc').from('goals').select('*').eq('scope',GSCOPE).order('created_at',{ascending:false});goalsRaw=data||[];}catch(e){}
  let goals=goalsRaw;
  if(GSCOPE==='personal'){
    goals=goalsRaw.filter(g=>g.owner===me||g.created_by===me);
  } else if(GSCOPE==='team'){
    goals=goalsRaw.filter(g=>myGoalIds.has(g.id)||g.owner===me||g.created_by===me);
  }
  // company scope: show all (no filter)
  if(GFILTER.prio!=='All')goals=goals.filter(g=>g.priority===GFILTER.prio);
  if(GFILTER.status!=='All')goals=goals.filter(g=>(g.status||'Pending')===GFILTER.status);
  $('goalBody').innerHTML=goals.length?`<div class="grid lib-grid">${goals.map(g=>`<div class="card card-pad" style="cursor:pointer" onclick="location.hash='#/tasks/goal/${g.id}'">
    <div style="display:flex;justify-content:space-between;align-items:flex-start"><div class="ic" style="width:42px;height:42px;border-radius:11px;background:#fffbeb;color:#d97706;display:flex;align-items:center;justify-content:center;font-size:17px"><i class="fa-solid fa-bullseye"></i></div><span class="tag ${g.scope==='company'?'t-purple':g.scope==='team'?'t-blue':'t-gray'}" style="text-transform:capitalize">${esc(g.scope)}</span></div>
    <div style="font-weight:600;font-size:15px;margin-top:12px">${esc(g.name)}</div>
    <div style="color:var(--slate);font-size:12.5px;margin-top:4px;min-height:34px">${esc((g.description||'').replace(/<[^>]+>/g,' ').slice(0,80))}</div>
    <div style="margin-top:8px">${prioTag(g.priority)} ${statusTag(g.status||'Pending')}</div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:10px"><span style="color:var(--slate)">Progress</span><b>${g.progress||0}%</b></div>
    <div class="progress" style="margin-top:6px"><span style="width:${g.progress||0}%"></span></div></div>`).join('')}</div>`:`<div class="card card-pad empty"><i class="fa-regular fa-circle-dot"></i><div>No ${GSCOPE} goals match</div><button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="goalCreateModal()"><i class="fa-solid fa-plus"></i> Create one</button></div>`;
}
window.gfScopeChange=function(v){GSCOPE=v.toLowerCase();taskGoals($('view'));};
window.goalCreateModal=function(){
  const defScope=GSCOPE||'personal';const hide=defScope==='personal'?'display:none':'';
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-bullseye"></i> New goal</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">
    <label>Goal name</label><input id="glName" placeholder="e.g. Achieve ₹50 Cr in bookings">
    <label>Description</label>
    <div style="border:1px solid var(--line);border-radius:8px;overflow:hidden">
      <div style="display:flex;gap:2px;padding:6px;border-bottom:1px solid var(--line);background:#fafbfd">
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertUnorderedList')"><i class="fa-solid fa-list-ul"></i></button>
        <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertOrderedList')"><i class="fa-solid fa-list-ol"></i></button>
      </div>
      <div id="glDesc" contenteditable="true" style="min-height:70px;padding:10px 12px;font-size:13.5px;outline:none"></div>
    </div>
    <div class="two"><div><label>Scope</label><select id="glScope" onchange="glScopeChange()"><option value="personal" ${defScope==='personal'?'selected':''}>Personal</option><option value="team" ${defScope==='team'?'selected':''}>Team</option><option value="company" ${defScope==='company'?'selected':''}>Company</option></select></div>
    <div><label>Priority</label><select id="glPrio"><option>Low</option><option selected>Medium</option><option>High</option><option>Urgent</option></select></div></div>
    <div id="glOwnerWrap" style="${hide}"><label>Owner</label><select id="glOwner">${peopleOptions(state.email)}</select></div>
    <div class="two"><div><label>Start date</label><input type="date" id="glStart"></div><div><label>End date (optional)</label><input type="date" id="glEnd"></div></div>
    <div id="glMembersWrap" style="${hide}"><label>Members</label>${msHtml('glMembers')}</div>
    <label>Status</label><div class="seg" id="glStatusSeg">${['Pending','In Progress','Completed'].map((x,i)=>'<button type="button" class="seg-btn'+(i===0?' on':'')+'" onclick="glPickStatus(this,\''+x+'\')">'+x+'</button>').join('')}</div><input type="hidden" id="glStatus" value="Pending">
    <label>Attachment (optional)</label><input type="file" id="glFile">
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="glSave" onclick="goalSave()"><i class="fa-solid fa-check"></i> Create goal</button></div>`,'lg');
  setTimeout(()=>msInit('glMembers',[]),30);
};
window.glScopeChange=function(){const show=$('glScope').value!=='personal';$('glOwnerWrap').style.display=show?'':'none';$('glMembersWrap').style.display=show?'':'none';};
window.glPickStatus=function(btn,val){document.querySelectorAll('#glStatusSeg .seg-btn').forEach(b=>b.classList.remove('on'));btn.classList.add('on');$('glStatus').value=val;};
window.goalSave=async function(){
  const name=$('glName').value.trim();if(!name){toast('Enter a goal name','err');return;}
  const scope=$('glScope').value;
  const status=$('glStatus').value;
  const row={name,scope,description:$('glDesc').innerHTML,start_date:$('glStart').value||null,end_date:$('glEnd').value||null,progress:0,status,priority:$('glPrio').value,created_by:state.email,owner:scope==='personal'?state.email:($('glOwner')?$('glOwner').value:state.email)};
  const btn=$('glSave');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';
  const {data,error}=await sb.schema('acc').from('goals').insert(row).select().single();
  if(error){toast(error.message,'err');btn.disabled=false;return;}
  if(scope!=='personal'){const mem=getMS('glMembers');if(mem.length)await sb.schema('acc').from('goal_members').insert(mem.map(e=>({goal_id:data.id,email:e})));}
  const f=$('glFile').files[0];
  if(f){const key=s3KeyForGoal(data.id,f.name);const {data:upData,error:ue}=await uploadFileToS3(key,f);if(ue)toast('Goal created, but attachment upload failed: '+ue.message,'err');else await sb.schema('acc').from('goal_files').insert({goal_id:data.id,file_name:f.name,storage_path:upData.path,file_size:f.size,uploaded_by:state.email});}
  closeModal();toast('Goal created','ok');location.hash='#/tasks/goal/'+data.id;route();
};
const GLTFILTER={status:'All'};
window.gltStatusChange=function(v){GLTFILTER.status=v;goalDetail($('view'),window.__GL_ID);};
window.glTaskToggle=async function(taskId,goalId,done){
  if(done){
    const {data:resultStatus,error}=await sb.schema('acc').rpc('task_ask_approval',{tid:taskId});
    if(error){toast(error.message,'err');goalDetail($('view'),goalId);return;}
    if(resultStatus==='Awaiting Approval'){toast(NEEDS_TASK_PAGE_MSG,'warn');goalDetail($('view'),goalId);return;}
    await sb.schema('acc').from('task_activity').insert({task_id:taskId,actor:state.email,action:'marked this task complete'});
    toast('Marked complete','ok');
  }else{
    await sb.schema('acc').from('tasks').update({status:'Pending'}).eq('id',taskId);
    await recalcTaskProgress(taskId);
    toast('Reopened','ok');
  }
  await recalcGoalProgress(goalId);
  goalDetail($('view'),goalId);
};
async function goalDetail(v,id){
  loader(v);
  window.__GL_ID=id;
  const {data:g,error}=await sb.schema('acc').from('goals').select('*').eq('id',id).single();
  if(error||!g){v.innerHTML='<div class="empty"><i class="fa-solid fa-ban"></i><div>Goal not found</div></div>';return;}
  setCrumb(['Accountability',['Goals','#/tasks/goals'],g.name]);
  const [{data:mem},{data:files},{data:tasks},{data:comments}]=await Promise.all([
    sb.schema('acc').from('goal_members').select('*').eq('goal_id',id),
    sb.schema('acc').from('goal_files').select('*').eq('goal_id',id),
    sb.schema('acc').from('tasks').select('*').eq('goal_id',id).order('due_date',{ascending:true}),
    sb.schema('acc').from('goal_comments').select('*').eq('goal_id',id).order('created_at')
  ]);
  const list=tasks||[];
  let flist=list;
  if(GLTFILTER.status!=='All')flist=flist.filter(t=>t.status===GLTFILTER.status);
  const statusOpts=['Pending','Awaiting Approval','Completed'];
  const prog=g.progress||0;
  v.innerHTML=`<div class="page-head"><div><button class="btn btn-sm" onclick="goBack('tasks/list')"><i class="fa-solid fa-arrow-left"></i> Back</button><h1 style="margin-top:10px"><i class="fa-solid fa-bullseye" style="color:#d97706"></i> ${esc(g.name)}</h1><p><span class="tag ${g.scope==='company'?'t-purple':g.scope==='team'?'t-blue':'t-gray'}" style="text-transform:capitalize">${esc(g.scope)}</span> ${prioTag(g.priority)} ${statusTag(g.status||'Pending')} · Owner ${esc(nameOf(g.owner))} · ${list.length} task${list.length===1?'':'s'}</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn ${g.status==='Completed'?'btn-primary':''}" onclick="goalMarkComplete(${id},${g.status!=='Completed'})"><i class="fa-solid fa-circle-check"></i> ${g.status==='Completed'?'Completed':'Mark Complete'}</button>
      <button class="btn btn-primary" onclick="taskCreateModal('task',null,null,${id},'${esc(g.name).replace(/'/g,"\\'")}')"><i class="fa-solid fa-plus"></i> New Task</button>
    </div>
  </div>
  <div class="detail-grid">
    <div>
      <div class="card card-pad"><div class="sec-title">Description</div><div style="margin-top:8px;line-height:1.6;color:#334155;font-size:14px">${g.description||'<span style="color:#94a3b8">No description</span>'}</div></div>
      <div class="card card-pad" style="margin-top:16px"><div class="sec-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <span>Tasks</span>
        <span style="display:flex;gap:8px">
          ${fsHtml('gltStatus','Status',statusOpts,GLTFILTER.status,'gltStatusChange')}
        </span></div>
        <div style="margin-top:10px">${renderTaskDragList(flist,'goal',id)}</div>
      </div>
    </div>
    <div>
      <div class="card card-pad" style="text-align:center;padding-top:20px;padding-bottom:26px"><div class="sec-title" style="text-align:left">Progress</div>
        <div style="position:relative;width:180px;height:180px;margin:20px auto"><canvas id="chGoal"></canvas><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:700">${prog}%</div></div>
        <div style="color:var(--slate);font-size:12.5px;margin-top:10px">${list.length?`Auto-tracked from ${list.filter(t=>t.status==='Completed').length}/${list.length} tasks completed`:'Add tasks and tick them off to track progress'}</div>
      </div>
    </div>
  </div>
  <div class="card card-pad" style="margin-top:16px"><div class="sec-title"><i class="fa-solid fa-bullhorn"></i> Updates & Feedback</div>
    <div id="glCmList" class="chat-wrap" style="margin-top:10px">${(comments||[]).map(c=>glCmItem(c,id)).join('')||'<div style="color:var(--slate);font-size:13px">No updates yet — post the first one.</div>'}</div>
    <div id="glCmFileChip" style="display:none;align-items:center;gap:8px;margin-top:8px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;font-size:12.5px;color:var(--slate);width:fit-content"><i class="fa-solid fa-paperclip"></i><span id="glCmFileName"></span><i class="fa-solid fa-xmark" style="cursor:pointer;color:var(--err)" onclick="glCmClearFile()"></i></div>
    <input type="file" id="glCmFile" style="display:none" onchange="glCmFilePicked(this)">
    <div class="chat-composer"><button class="btn" title="Attach a file" onclick="document.getElementById('glCmFile').click()"><i class="fa-solid fa-paperclip"></i></button><input id="glCmNew" placeholder="Post an update or feedback…" onkeydown="if(event.key==='Enter')glCmAdd(${id})"><button class="btn btn-primary" onclick="glCmAdd(${id})"><i class="fa-solid fa-paper-plane"></i></button></div>
  </div>
  <div class="card card-pad" style="margin-top:16px">
    <div class="sec-title" style="display:flex;justify-content:space-between;align-items:center">Details <button class="btn btn-sm" onclick="goalEditModal(${id})"><i class="fa-solid fa-pen"></i> Edit</button></div>
    <div class="info-grid">
      <div class="fld"><div class="k"><i class="fa-solid fa-calendar-day"></i> Start date</div><div class="v">${fmtDate(g.start_date)}</div></div>
      <div class="fld"><div class="k"><i class="fa-solid fa-calendar-check"></i> End date</div><div class="v">${fmtDate(g.end_date)}</div></div>
      <div class="fld"><div class="k"><i class="fa-regular fa-user"></i> Owner</div><div class="v">${avatar(nameOf(g.owner))} ${esc(nameOf(g.owner))}</div></div>
      <div class="fld"><div class="k"><i class="fa-solid fa-flag"></i> Priority</div><div class="v">${prioTag(g.priority)}</div></div>
      <div class="fld"><div class="k"><i class="fa-solid fa-circle-dot"></i> Status</div><div class="v">${statusTag(g.status||'Pending')}</div></div>
    </div>
    <div class="info-divider"></div>
    <div class="info-sub" style="display:flex;justify-content:space-between;align-items:center">Attachments <span style="display:flex;gap:6px">
      <button class="btn btn-sm" onclick="filesDownloadSel('glAttachList')"><i class="fa-solid fa-download"></i> Download</button>
      <button class="btn btn-sm btn-danger" onclick="goalAttachDeleteSel(${id})"><i class="fa-solid fa-trash"></i> Delete</button>
      <button class="btn btn-sm" onclick="document.getElementById('glAttachAdd').click()"><i class="fa-solid fa-paperclip"></i> Add</button>
    </span></div>
    <input type="file" id="glAttachAdd" style="display:none" onchange="goalAttachUpload(${id},this)">
    <div id="glAttachList" class="attach-grid">${(files||[]).map(f=>`<label class="attach-card"><input type="checkbox" class="checkbox attach-chk" data-id="${f.id}" data-path="${esc(f.storage_path)}" data-name="${esc(f.file_name)}"><i class="fa-solid fa-paperclip"></i><span class="name" title="${esc(f.file_name)}">${esc(f.file_name)}</span></label>`).join('')||'<span style="color:var(--slate);font-size:12px">None</span>'}</div>
    <div class="info-divider"></div>
    <div class="info-sub" style="display:flex;justify-content:space-between;align-items:center">Members ${g.scope!=='personal'?`<button class="btn btn-sm" onclick="goalMembersModal(${id})"><i class="fa-solid fa-user-plus"></i> Manage</button>`:''}</div>
    ${g.scope!=='personal'?`<div class="people-grid">${(mem||[]).map(m=>`<span class="people-chip">${avatar(nameOf(m.email))} ${esc(nameOf(m.email))}</span>`).join('')||'<span style="color:var(--slate);font-size:13px">No members</span>'}</div>`:'<div style="color:var(--slate);font-size:12.5px">Personal goal — just you</div>'}
    <div class="info-divider"></div>
    <div style="display:flex;justify-content:flex-end"><button class="btn btn-sm btn-danger" onclick="goalDelete(${id})"><i class="fa-solid fa-trash"></i> Delete goal</button></div>
  </div>`;
  new Chart($('chGoal'),{type:'doughnut',data:{datasets:[{data:[prog,100-prog],backgroundColor:[prog===100?'#16a34a':'#d97706','#eef1f6'],borderWidth:0}]},options:{cutout:'78%',plugins:{legend:{display:false},tooltip:{enabled:false}}}});
  const glCmW=$('glCmList');if(glCmW)glCmW.scrollTop=glCmW.scrollHeight;
  wireProjTaskDrag('goal',id);
}
async function recalcGoalProgress(id){
  const {data:tasks}=await sb.schema('acc').from('tasks').select('status').eq('goal_id',id);
  const items=tasks||[];
  const total=items.length,done=items.filter(t=>t.status==='Completed').length;
  const p=total?Math.round(done/total*100):0;
  const {data:cur}=await sb.schema('acc').from('goals').select('status').eq('id',id).single();
  let status=cur?cur.status:null;
  if(p===100)status='Completed';else if(status==='Completed')status='In Progress';else if(p>0)status='In Progress';
  await sb.schema('acc').from('goals').update({progress:p,status}).eq('id',id);
}
function glCmItem(c,goalId){
  const mine=c.author===state.email;
  return `<div class="chat-msg ${mine?'mine':''}">
    ${mine?'':avatar(nameOf(c.author))}
    <div style="min-width:0">
      <div class="chat-meta">${mine?'':`<b>${esc(nameOf(c.author))}</b>`}<span>${relTime(c.created_at)}${c.edited?' · edited':''}</span></div>
      <div class="chat-bubble">
        <div id="glcm_body_${c.id}">${esc(c.body)}</div>
        ${mine?`<div class="chat-actions"><i class="fa-solid fa-pen chat-act-ic" title="Edit" onclick="glCmEdit(${c.id},${goalId})"></i><i class="fa-solid fa-trash chat-act-ic danger" title="Delete" onclick="glCmDelete(${c.id},${goalId})"></i></div>`:''}
      </div>
    </div>
  </div>`;
}
window.glCmFilePicked=function(inputEl){
  const f=inputEl.files[0];const chip=$('glCmFileChip'),nm=$('glCmFileName');
  if(!f){if(chip)chip.style.display='none';return;}
  if(nm)nm.textContent=f.name;if(chip)chip.style.display='flex';
};
window.glCmClearFile=function(){const inp=$('glCmFile');if(inp)inp.value='';const chip=$('glCmFileChip');if(chip)chip.style.display='none';};
window.glCmAdd=async function(id){
  const bEl=$('glCmNew');const b=(bEl.value||'').trim();
  const fEl=$('glCmFile');const f=fEl&&fEl.files&&fEl.files[0];
  if(!b&&!f)return;
  let body=b;
  if(f){
    const key=s3KeyForGoal(id,f.name);
    toast('Uploading '+f.name+'\u2026','ok');
    const {data:upData,error:ue}=await uploadFileToS3(key,f);
    if(ue){toast('Attachment upload failed: '+ue.message,'err');return;}
    await sb.schema('acc').from('goal_files').insert({goal_id:id,file_name:f.name,storage_path:upData.path,file_size:f.size,uploaded_by:state.email});
    body=(b?b+' ':'')+'\ud83d\udcce '+f.name;
  }
  await sb.schema('acc').from('goal_comments').insert({goal_id:id,author:state.email,body});
  goalDetail($('view'),id);
};
window.glCmEdit=function(cid,goalId){
  const el=$('glcm_body_'+cid);if(!el)return;const cur=el.textContent;
  el.innerHTML=`<div style="display:flex;gap:8px"><input id="glCmEditIn_${cid}" class="sel" style="flex:1;height:32px" value="${esc(cur)}"><button class="btn btn-sm btn-primary" onclick="glCmEditSave(${cid},${goalId})"><i class="fa-solid fa-check"></i></button></div>`;
  $('glCmEditIn_'+cid).focus();
};
window.glCmEditSave=async function(cid,goalId){
  const v=$('glCmEditIn_'+cid).value.trim();if(!v)return;
  const {error}=await sb.schema('acc').from('goal_comments').update({body:v,edited:true}).eq('id',cid);
  if(error){toast(error.message,'err');return;}
  toast('Message updated','ok');goalDetail($('view'),goalId);
};
window.glCmDelete=async function(cid,goalId){
  if(!await confirmDialog('Delete this message?'))return;
  const {error}=await sb.schema('acc').from('goal_comments').delete().eq('id',cid);
  if(error){toast(error.message,'err');return;}
  toast('Message deleted','ok');goalDetail($('view'),goalId);
};
window.goalMembersModal=async function(id){
  const {data:members}=await sb.schema('acc').from('goal_members').select('email').eq('goal_id',id);
  const current=(members||[]).map(m=>m.email);
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-users"></i> Manage members</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm"><label>Members</label>${msHtml('glmMembers')}</div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="goalMembersSave(${id})"><i class="fa-solid fa-check"></i> Save</button></div>`,'lg');
  setTimeout(()=>msInit('glmMembers',current),30);
};
window.goalMembersSave=async function(id){
  const {data:members}=await sb.schema('acc').from('goal_members').select('email').eq('goal_id',id);
  const current=new Set((members||[]).map(m=>m.email));
  const next=new Set(getMS('glmMembers'));
  const toAdd=[...next].filter(e=>!current.has(e));
  const toRemove=[...current].filter(e=>!next.has(e));
  if(toAdd.length)await sb.schema('acc').from('goal_members').insert(toAdd.map(e=>({goal_id:id,email:e})));
  for(const e of toRemove){await sb.schema('acc').from('goal_members').delete().eq('goal_id',id).eq('email',e);}
  closeModal();toast('Members updated','ok');goalDetail($('view'),id);
};
window.goalAttachUpload=async function(id,inputEl){
  const f=inputEl.files[0];if(!f)return;
  const key=s3KeyForGoal(id,f.name);
  toast('Uploading '+f.name+'…','ok');
  const {data:upData,error:ue}=await uploadFileToS3(key,f);
  if(ue){toast('Attachment upload failed: '+ue.message,'err');inputEl.value='';return;}
  const {error}=await sb.schema('acc').from('goal_files').insert({goal_id:id,file_name:f.name,storage_path:upData.path,file_size:f.size,uploaded_by:state.email});
  if(error){toast(error.message,'err');return;}
  toast('Attachment added','ok');goalDetail($('view'),id);
};
window.goalAttachDelete=async function(id,fileId,path){
  if(!await confirmDialog('Remove this attachment?'))return;
  if(path){ if(isS3Path(path)) await s3Delete(path); else await sb.storage.from('documents').remove([path]); }
  await sb.schema('acc').from('goal_files').delete().eq('id',fileId);
  toast('Attachment removed','ok');goalDetail($('view'),id);
};
window.goalAttachDeleteSel=async function(id){
  const checked=[...document.querySelectorAll('#glAttachList .attach-chk:checked')];
  if(!checked.length)return;
  if(!await confirmDialog(`Delete ${checked.length} file(s)?`))return;
  for(const cb of checked){
    const path=cb.dataset.path;
    if(path){ if(isS3Path(path)) await s3Delete(path); else await sb.storage.from('documents').remove([path]); }
    await sb.schema('acc').from('goal_files').delete().eq('id',cb.dataset.id);
  }
  toast('Attachments removed','ok');goalDetail($('view'),id);
};
window.goalDelete=async function(id){
  if(!await confirmDialog('Delete this goal permanently?'))return;
  const {data:files}=await sb.schema('acc').from('goal_files').select('storage_path').eq('goal_id',id);
  for(const f of (files||[])){ if(f.storage_path){ if(isS3Path(f.storage_path)) await s3Delete(f.storage_path); else await sb.storage.from('documents').remove([f.storage_path]); } }
  await sb.schema('acc').from('goals').delete().eq('id',id);
  toast('Goal deleted','ok');location.hash='#/tasks/goals';
};
window.goalEditModal=async function(id){
  const {data:g,error}=await sb.schema('acc').from('goals').select('*').eq('id',id).single();
  if(error||!g){toast('Could not load goal','err');return;}
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Edit goal</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm">
      <label>Goal name</label><input id="geName" value="${esc(g.name)}">
      <label>Description</label>
      <div style="border:1px solid var(--line);border-radius:8px;overflow:hidden">
        <div style="display:flex;gap:2px;padding:6px;border-bottom:1px solid var(--line);background:#fafbfd">
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button>
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button>
          <button type="button" class="btn btn-sm btn-ghost" onmousedown="event.preventDefault();document.execCommand('insertUnorderedList')"><i class="fa-solid fa-list-ul"></i></button>
        </div>
        <div id="geDesc" contenteditable="true" style="min-height:70px;padding:10px 12px;font-size:13.5px;outline:none">${g.description||''}</div>
      </div>
      <div class="two"><div><label>Start date</label><input type="date" id="geStart" value="${g.start_date||''}"></div><div><label>End date</label><input type="date" id="geEnd" value="${g.end_date||''}"></div></div>
      <div class="two"><div><label>Owner</label><select id="geOwner">${peopleOptions(g.owner)}</select></div>
      <div><label>Priority</label><select id="gePrio">${['Low','Medium','High','Urgent'].map(x=>`<option ${x===g.priority?'selected':''}>${x}</option>`).join('')}</select></div></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="goalEditSave(${id})"><i class="fa-solid fa-check"></i> Save</button></div>`,'lg');
};
window.goalEditSave=async function(id){
  const name=$('geName').value.trim();if(!name){toast('Enter a goal name','err');return;}
  const {error}=await sb.schema('acc').from('goals').update({name,description:$('geDesc').innerHTML,start_date:$('geStart').value||null,end_date:$('geEnd').value||null,owner:$('geOwner').value,priority:$('gePrio').value}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  closeModal();toast('Goal updated','ok');goalDetail($('view'),id);
};
window.goalMarkComplete=async function(id,makeComplete){
  if(makeComplete){
    const {data:tks}=await sb.schema('acc').from('tasks').select('id').eq('goal_id',id);
    const ids=(tks||[]).map(t=>t.id);
    if(ids.length){
      await sb.schema('acc').from('tasks').update({status:'Completed',progress:100}).in('id',ids);
      await completeTaskChecklists(ids);
    }
    await sb.schema('acc').from('goals').update({status:'Completed',progress:100}).eq('id',id);
  }else{
    await sb.schema('acc').from('goals').update({status:'In Progress'}).eq('id',id);
    await recalcGoalProgress(id);
  }
  toast(makeComplete?'Marked complete':'Reopened','ok');
  goalDetail($('view'),id);
};

/* ---------- SETTINGS ---------- */
VIEWS.settings=async function(v){
  setCrumb(['Home','Settings']);
  const nm=(state.profile&&state.profile.full_name)||state.email.split('@')[0];
  const roles=state.roles||{};
  const modRows=[['doc','Documents'],['acc','Accountability / Tasks'],['crm','CRM'],['hr','HR'],['projects','Projects'],['finance','Finance'],['kraya','Procurement'],['masters','Masters']];
  const myModRows=modRows.filter(m=>roles[m[0]]);
  const people=await getPeople();
  // acc.user_profile.department is an array column (a person can belong to more than one dept) —
  // not a plain string, so this needs an array membership check, not ===.
  const rawDept=state.profile&&state.profile.department;
  const deptArr=Array.isArray(rawDept)?rawDept:(rawDept?[rawDept]:[]);
  const dept=deptArr.join(', ');
  // Workspace/connection info: the administrator account (Super Admin) plus every user in the
  // Systems department — nobody else.
  const canSeeWorkspace=!!(state.super||deptArr.includes('Systems'));
  v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-gear" style="color:#475569"></i> Settings</h1><p>Your account, access and workspace preferences</p></div></div>
  <div class="grid grid-2">
    <div class="card card-pad"><div class="sec-title">Account</div>
      <div style="display:flex;align-items:center;gap:14px;margin-top:14px"><span class="avatar-sm" style="width:54px;height:54px;font-size:18px;background:${colorFor(state.email)}">${esc(initials(nm).toUpperCase())}</span><div><div style="font-weight:700;font-size:16px">${esc(nm)}</div><div style="color:var(--slate);font-size:13px">${esc(state.email)}</div>${state.super?'<span class="tag t-purple" style="margin-top:6px"><i class="fa-solid fa-shield-halved"></i> Super Admin</span>':''}</div></div>
      <div class="frm" style="margin-top:18px">
        <label>Full name</label><input id="obName" value="${esc(nm)}">
        <label>Designation <span style="color:var(--slate);font-weight:400">(optional)</span></label><input id="obDesig" placeholder="e.g. Project Manager" value="${esc((state.profile&&state.profile.designation)||'')}">
        <label>Department</label><input disabled value="${esc(dept)}" placeholder="Not assigned yet" style="background:#f1f5f9;color:var(--slate);cursor:not-allowed">
        ${rmPickerHtml(people,(state.profile&&state.profile.reporting_manager)||'')}
        <div style="margin-top:16px"><button class="btn btn-primary" onclick="setProfileSave()"><i class="fa-solid fa-check"></i> Save changes</button></div>
      </div>
    </div>
    <div class="card card-pad"><div class="sec-title">Module Access</div><div class="sec-sub">Your role per module (set by an administrator)</div>
      ${myModRows.length?`<table style="margin-top:6px"><tbody>${myModRows.map(m=>`<tr><td style="font-weight:500">${m[1]}</td><td style="text-align:right"><span class="tag t-green">${esc(roles[m[0]])}</span></td></tr>`).join('')}</tbody></table>`:'<div style="color:var(--slate);font-size:13px;margin-top:12px">No module access assigned yet — ask an administrator.</div>'}
    </div>
  </div>
  ${canSeeWorkspace?`<div class="card card-pad" style="margin-top:16px"><div class="sec-title">Workspace</div><div class="sec-sub">Connection & system information</div>
    <table style="margin-top:6px"><tbody>
      <tr><td style="color:var(--slate)">Organisation</td><td style="text-align:right"><b>Jain Group</b></td></tr>
      <tr><td style="color:var(--slate)">Database</td><td style="text-align:right"><b>Supabase · ap-south-1</b> <span class="tag t-green">Connected</span></td></tr>
      <tr><td style="color:var(--slate)">Storage buckets</td><td style="text-align:right"><b>documents, legal-docs, task-attachments, branding</b></td></tr>
      <tr><td style="color:var(--slate)">Security</td><td style="text-align:right">Row-Level Security <span class="tag t-green">Enforced</span></td></tr>
      <tr><td style="color:var(--slate)">Version</td><td style="text-align:right"><b>Nexus-RE v1.0</b></td></tr>
      <tr><td style="color:var(--slate)">This session</td><td style="text-align:right" id="sessInfo">…</td></tr>
    </tbody></table>
  </div>`:''}`;
  if(canSeeWorkspace)try{
    const {data}=await sb.auth.getSession();
    const tok=data&&data.session&&data.session.access_token;
    const el=document.getElementById('sessInfo');
    if(tok&&el){
      const p=JSON.parse(atob(tok.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      el.innerHTML='started <b>'+new Date(p.iat*1000).toLocaleTimeString()+'</b> · token …'+esc(tok.slice(-10));
    }
  }catch(e){}
};
window.setProfileSave=async function(){
  const name=$('obName').value.trim();if(!name){toast('Enter your name','err');return;}
  const row={email:state.email,full_name:name,designation:$('obDesig').value,reporting_manager:$('obMgr').value||null,onboarded:true,avatar_color:colorFor(state.email)};
  const {error}=await sb.schema('acc').from('user_profile').upsert(row,{onConflict:'email'});
  if(error){toast(error.message,'err');return;}
  state.profile=Object.assign(state.profile||{},row);refreshBootCache();PEOPLE=null;toast('Profile saved','ok');
  VIEWS.settings($('view'));
};


