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
function projectMini(p){return `<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--line-2);cursor:pointer" onclick="location.hash='#/tasks/project/${p.id}'"><div class="ic" style="width:32px;height:32px;border-radius:9px;background:#eff4ff;color:#1d4ed8;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0"><i class="fa-solid fa-diagram-project"></i></div><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</div><div style="color:var(--slate);font-size:11.5px">Owner ${esc(nameOf(p.owner||p.created_by))}</div></div><i class="fa-solid fa-chevron-right" style="color:#cbd5e1;font-size:12px"></i></div>`;}


/* ---------- create / edit task ---------- */
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
function taskScoreboard(){ navTo('scoreboard'); }

/* ===== Global first-login onboarding (full screen, no sidebar) ===== */