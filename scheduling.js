/* ===========================================================================
   JAIN-E · PROJECT SCHEDULING (Operations)   [loads after nexus-core.js]

   A CPM planning board for construction activities.

   · Activities carry a planned start + planned duration and sit in a WBS tree
     (a row with is_group = true is a summary whose dates roll up from children).
   · Every activity is scoped to a level — Project / Tower / Floor / Flat / Room —
     using the same block/floor/flat vocabulary as the Inspection module.
   · Activities are linked with FS / SS / FF / SF dependencies and a lag.
   · Actual start and actual finish are keyed in by the user; nothing is inferred.
   · "Reschedule" runs a forward + backward CPM pass from the data date over the
     actuals, durations and links, and proposes new dates for everything still
     pending. The proposal is stored and changes nothing until it is approved —
     on approval the dates are written back and frozen as the next baseline.

   Durations are WORKING days, counted on the schedule's own calendar
   (week-offs + holiday list). Duration 1 = starts and finishes the same day;
   duration 0 = a milestone.
   =========================================================================== */
(function(){
if(typeof sb==='undefined'||typeof VIEWS==='undefined')return;

const ACC=()=>sb.schema('acc');
const me =()=>((state&&state.email)||'').toLowerCase();
const E  =s=>(typeof esc==='function'?esc(s==null?'':s):String(s==null?'':s));

/* ============================ DATES & CALENDAR ============================ */
const DAYMS=86400000;
function s2d(s){ if(!s)return null; const m=String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m?new Date(+m[1],+m[2]-1,+m[3]):null; }
function d2s(d){ if(!d)return null; return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function addDays(d,n){ const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); x.setDate(x.getDate()+n); return x; }
function dayDiff(a,b){ return Math.round((new Date(b.getFullYear(),b.getMonth(),b.getDate())-new Date(a.getFullYear(),a.getMonth(),a.getDate()))/DAYMS); }
function maxD(a,b){ return !a?b:!b?a:(a>b?a:b); }
function minD(a,b){ return !a?b:!b?a:(a<b?a:b); }
/* IST "today" — the portal works in Asia/Kolkata regardless of the device clock. */
function istToday(){ const n=new Date(Date.now()+(330+new Date().getTimezoneOffset())*60000); return new Date(n.getFullYear(),n.getMonth(),n.getDate()); }
function fmtD(v){ const d=(v instanceof Date)?v:s2d(v); return d?d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit'}):'—'; }
function fmtDLong(v){ const d=(v instanceof Date)?v:s2d(v); return d?d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—'; }

/* A schedule's working-day calendar. week_offs holds the weekday numbers that are NOT worked
   (0 = Sunday); holidays is a list of specific dates. */
function calOf(sch){
  let offs=new Set(((sch&&Array.isArray(sch.week_offs))?sch.week_offs:[0]).map(Number).filter(n=>n>=0&&n<=6));
  if(offs.size>=7)offs=new Set([0]);                       // a week with no working day cannot be scheduled
  const hol=new Set(((sch&&Array.isArray(sch.holidays))?sch.holidays:[]).map(x=>String(x).slice(0,10)));
  return { offs, hol, isWork(d){ return !this.offs.has(d.getDay())&&!this.hol.has(d2s(d)); } };
}
const CAP=4000;                                            // loop guard (~11 years of calendar days)
function nextWork(d,cal){ let x=d,i=0; while(!cal.isWork(x)&&i++<CAP)x=addDays(x,1); return x; }
function prevWork(d,cal){ let x=d,i=0; while(!cal.isWork(x)&&i++<CAP)x=addDays(x,-1); return x; }
/* n working days forward (or backward, when n < 0) from d. */
function addWork(d,n,cal){
  if(!d)return null;
  let x=n>=0?nextWork(d,cal):prevWork(d,cal), k=n, i=0;
  while(k>0&&i++<CAP){ x=nextWork(addDays(x,1),cal); k--; }
  i=0; while(k<0&&i++<CAP){ x=prevWork(addDays(x,-1),cal); k++; }
  return x;
}
/* Finish date of an activity starting on `start` and occupying `dur` working days. */
function finishOf(start,dur,cal){ if(!start)return null; const s=nextWork(start,cal); return addWork(s,Math.max(0,(dur||0)-1),cal); }
/* Inclusive count of working days from a to b (1 when a === b and it is a working day). */
function workSpan(a,b,cal){
  if(!a||!b)return 0;
  if(b<a)return -workSpan(b,a,cal);
  let n=0,x=new Date(a.getFullYear(),a.getMonth(),a.getDate()),i=0;
  while(x<=b&&i++<CAP){ if(cal.isWork(x))n++; x=addDays(x,1); }
  return n;
}

/* ============================ CPM ============================
   Forward pass, group roll-up, then a backward pass for total float.

   Completed activities (actual finish keyed in) are frozen on their actual dates.
   In-progress activities (actual start, no finish) keep their real start; what is left of them
   is re-laid from the data date — remaining = ceil(duration x (1 - progress%)), and an activity
   reported at 0% is treated as still needing its full duration.
   Pending activities are pushed forward by their predecessors, their own constraint, and the
   data date — a plan can never propose a start in the past.                                     */
function cpm(acts,deps,cal,dataDate){
  const byId={}; acts.forEach(a=>{byId[a.id]=a;});
  const kids={}; acts.forEach(a=>{ const p=a.parent_id||0; (kids[p]=kids[p]||[]).push(a.id); });
  const isLeaf=a=>!a.is_group&&!(kids[a.id]&&kids[a.id].length);
  const leaves=acts.filter(isLeaf), leafSet=new Set(leaves.map(a=>a.id));
  const preds={},succs={};
  deps.forEach(d=>{
    if(!leafSet.has(d.pred_id)||!leafSet.has(d.succ_id))return;
    (preds[d.succ_id]=preds[d.succ_id]||[]).push(d);
    (succs[d.pred_id]=succs[d.pred_id]||[]).push(d);
  });

  /* Kahn topological order; whatever is left over sits inside a dependency loop. */
  const indeg={}; leaves.forEach(a=>{indeg[a.id]=(preds[a.id]||[]).length;});
  const q=leaves.filter(a=>!indeg[a.id]).map(a=>a.id), order=[];
  while(q.length){
    const id=q.shift(); order.push(id);
    (succs[id]||[]).forEach(d=>{ if(--indeg[d.succ_id]===0)q.push(d.succ_id); });
  }
  const seen=new Set(order);
  const cycle=order.length===leaves.length?[]:leaves.filter(a=>!seen.has(a.id)).map(a=>a.id);

  const R={};
  const dd=dataDate||istToday();
  order.forEach(id=>{
    const a=byId[id], dur=Math.max(0,a.planned_duration||0);
    const as=s2d(a.actual_start), af=s2d(a.actual_finish);
    const r={id,dur,state:'pending',es:null,ef:null,violates:null};

    if(af){ r.state='done'; r.es=as||af; r.ef=af; R[id]=r; return; }

    /* Earliest start allowed by the predecessors. */
    let bound=null;
    (preds[id]||[]).forEach(d=>{
      const p=R[d.pred_id]; if(!p||!p.ef||!p.es)return;
      const lag=d.lag_days|0; let cs=null;
      if(d.dep_type==='SS')      cs=addWork(p.es,lag,cal);
      else if(d.dep_type==='FF') cs=addWork(addWork(p.ef,lag,cal),-(Math.max(1,dur)-1),cal);
      else if(d.dep_type==='SF') cs=addWork(addWork(p.es,lag,cal),-(Math.max(1,dur)-1),cal);
      else                       cs=addWork(p.ef,1+lag,cal);   // FS
      bound=maxD(bound,cs);
    });

    if(as){
      /* In progress — the real start stands; only the remainder moves. */
      r.state='wip'; r.es=as;
      const pct=Math.min(100,Math.max(0,a.progress_pct||0));
      const rem=pct>0?Math.ceil(dur*(1-pct/100)):dur;
      const from=maxD(dd,as);
      r.ef=rem<=0?nextWork(from,cal):addWork(nextWork(from,cal),rem-1,cal);
      r.remaining=rem;
    }else{
      let es=maxD(bound||s2d(a.planned_start)||dd,dd);
      const cd=s2d(a.constraint_date);
      if(cd&&a.constraint_type==='SNET') es=maxD(es,cd);
      if(cd&&a.constraint_type==='MSO')  es=cd;
      r.es=nextWork(es,cal);
      r.ef=dur<=0?r.es:addWork(r.es,dur-1,cal);
      if(cd&&a.constraint_type==='FNLT'&&r.ef>cd) r.violates='Finish-no-later-than '+fmtD(cd);
    }
    R[id]=r;
  });
  cycle.forEach(id=>{
    const a=byId[id], st=s2d(a.planned_start);
    R[id]={id,dur:a.planned_duration||0,state:'cycle',es:st,ef:finishOf(st,a.planned_duration,cal),violates:'In a dependency loop'};
  });

  /* Backward pass — total float in working days. Best effort: an odd link leaves float
     undefined rather than breaking the whole view. */
  try{
    let projEnd=null; order.forEach(id=>{ projEnd=maxD(projEnd,R[id].ef); });
    order.slice().reverse().forEach(id=>{
      const r=R[id], dur=Math.max(1,r.dur||1);
      let lf=null;
      (succs[id]||[]).forEach(d=>{
        const s=R[d.succ_id]; if(!s||!s.ls||!s.lf)return;
        const lag=d.lag_days|0; let c=null;
        if(d.dep_type==='SS')      c=addWork(addWork(s.ls,-lag,cal),dur-1,cal);
        else if(d.dep_type==='FF') c=addWork(s.lf,-lag,cal);
        else if(d.dep_type==='SF') c=addWork(addWork(s.lf,-lag,cal),dur-1,cal);
        else                       c=addWork(s.ls,-(1+lag),cal);   // FS
        lf=minD(lf,c);
      });
      r.lf=lf||projEnd||r.ef;
      r.ls=addWork(r.lf,-(dur-1),cal);
      r.float=(r.state==='done')?null:workSpan(r.es,r.ls,cal)-1;
      r.critical=r.state!=='done'&&r.float!=null&&r.float<=0;
    });
  }catch(e){ /* float is a nicety, not a requirement */ }

  /* Group roll-up, deepest first. */
  const depthOf=a=>{ let n=0,x=a,i=0; while(x&&x.parent_id&&i++<200){ x=byId[x.parent_id]; n++; } return n; };
  acts.filter(a=>!isLeaf(a)).sort((x,y)=>depthOf(y)-depthOf(x)).forEach(g=>{
    let es=null,ef=null,anyWip=false,allDone=true,pctSum=0,pctN=0;
    (kids[g.id]||[]).forEach(cid=>{
      const c=R[cid]; if(!c)return;
      es=minD(es,c.es); ef=maxD(ef,c.ef);
      if(c.state!=='done')allDone=false;
      if(c.state==='wip')anyWip=true;
      pctN++; pctSum+=c.state==='done'?100:Math.min(100,Math.max(0,(byId[cid].progress_pct||0)));
    });
    R[g.id]={id:g.id,group:true,es,ef,dur:workSpan(es,ef,cal),
             state:pctN===0?'pending':allDone?'done':anyWip?'wip':'pending',
             rollupPct:pctN?Math.round(pctSum/pctN):0};
  });

  return {R,cycle,order,preds,succs,leafSet,kids,isLeaf};
}

function pctOf(a,r){
  if(a.actual_finish)return 100;
  if(r&&r.group)return r.rollupPct||0;
  return Math.min(100,Math.max(0,a.progress_pct||0));
}
function actState(a){ return a.actual_finish?'Completed':a.actual_start?'In Progress':'Not Started'; }

/* ============================ MODULE STATE & DATA ============================ */
const LEVELS=['Project','Tower','Floor','Flat','Room'];
const DEPS_T={FS:'Finish → Start',SS:'Start → Start',FF:'Finish → Finish',SF:'Start → Finish'};
const CONSTR={ASAP:'As soon as possible',SNET:'Start no earlier than',FNLT:'Finish no later than',MSO:'Must start on'};
const ROOMS=['Kitchen','Bathroom','Bedroom','Living / Dining','Balcony','Utility','Toilet','Lobby','Staircase','Lift Well','Terrace','Others'];
const WDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const F0=()=>({q:'',level:'All',tower:'All',floor:'All',flat:'All',cat:'All',status:'All',who:'All',contractor:'All',mine:false});

const SC={
  boot:false, busy:false,
  schedules:[], contractors:[], schedId:null,
  acts:[], deps:[], baselines:[], runs:[], baseItems:{},   // baseItems: baselineId -> {activityId: item}
  tab:'plan', f:F0(), collapsed:new Set(), cmpBase:null, zoom:'week',
  preview:null,          // {dataDate, rows:[…], cycle:[…]} — held in memory until submitted
  runOpen:null           // id of the reschedule run being reviewed
};
const LS_KEY='jaine.sched.schedId';
const sched =()=>SC.schedules.find(s=>s.id===SC.schedId)||null;
const cal   =()=>calOf(sched());
const dataDate=()=>s2d((sched()||{}).data_date)||istToday();
const contractorName=id=>{ const c=SC.contractors.find(x=>x.id===id); return c?c.name:'—'; };
const curBaseline=()=>SC.baselines.find(b=>b.is_current)||null;
/* Only the schedule's owner may approve or reject a reschedule. The real check is in the
   sched_run_decide RPC (against the JWT, so it cannot be spoofed); this just keeps the buttons
   from appearing for everyone else. */
const ownerOf=()=>{ const s=sched(); return s?String(s.owner_email||s.created_by||'').toLowerCase():''; };
const iAmOwner=()=>{ const o=ownerOf(); return !!o&&o===me(); };

/* Masters shared with the Inspection module (insp-items.js). Falls back to whatever the
   schedule itself already uses if that file is not loaded on this page. */
function masters(){
  const uniq=k=>[...new Set(SC.acts.map(a=>a[k]).filter(Boolean))].sort();
  return {
    projects:(window.INSP_PROJECTS||[]).slice(),
    towers  :(window.INSP_BLOCKS  ||uniq('tower')),
    floors  :(window.INSP_FLOORS  ||uniq('floor')),
    flats   :(window.INSP_FLATS   ||uniq('flat')),
    cats    :(window.INSP_CATS    ||uniq('work_category')),
    rooms   :[...new Set(ROOMS.concat(uniq('room')))]
  };
}

async function loadBoot(){
  const [s,c]=await Promise.all([
    ACC().from('sched_schedules').select('*').order('created_at',{ascending:false}),
    ACC().from('sched_contractors').select('*').order('name')
  ]);
  if(s.error)throw s.error;
  if(c.error)throw c.error;
  SC.schedules=s.data||[]; SC.contractors=c.data||[];
  try{ await getPeople(); }catch(e){}
  const saved=Number(localStorage.getItem(LS_KEY)||0);
  if(saved&&SC.schedules.some(x=>x.id===saved))SC.schedId=saved;
  else if(SC.schedules.length)SC.schedId=SC.schedules[0].id;
  SC.boot=true;
}
async function loadSchedule(){
  if(!SC.schedId){ SC.acts=[];SC.deps=[];SC.baselines=[];SC.runs=[]; return; }
  const id=SC.schedId;
  const [a,d,b,r]=await Promise.all([
    ACC().from('sched_activities').select('*').eq('schedule_id',id).order('sort_order').order('id'),
    ACC().from('sched_deps').select('*').eq('schedule_id',id),
    ACC().from('sched_baselines').select('*').eq('schedule_id',id).order('seq',{ascending:false}),
    ACC().from('sched_runs').select('*').eq('schedule_id',id).order('created_at',{ascending:false}).limit(50)
  ]);
  if(a.error)throw a.error;
  SC.acts=a.data||[]; SC.deps=d.data||[]; SC.baselines=b.data||[]; SC.runs=r.data||[];
  SC.baseItems={};
  const cb=curBaseline();
  if(SC.cmpBase&&!SC.baselines.some(x=>x.id===SC.cmpBase))SC.cmpBase=null;
  if(!SC.cmpBase&&cb)SC.cmpBase=cb.id;
  if(SC.cmpBase)await loadBaselineItems(SC.cmpBase);
}
async function loadBaselineItems(bid){
  if(!bid||SC.baseItems[bid])return SC.baseItems[bid];
  const {data,error}=await ACC().from('sched_baseline_items').select('*').eq('baseline_id',bid);
  if(error)throw error;
  const m={}; (data||[]).forEach(x=>{m[x.activity_id]=x;});
  SC.baseItems[bid]=m; return m;
}
function baseItem(id){ const m=SC.cmpBase?SC.baseItems[SC.cmpBase]:null; return m?m[id]:null; }

/* Ordered WBS walk: parents before children, siblings by sort_order then id. */
function tree(){
  const kids={}; SC.acts.forEach(a=>{ const p=a.parent_id||0; (kids[p]=kids[p]||[]).push(a); });
  Object.keys(kids).forEach(k=>kids[k].sort((x,y)=>(x.sort_order-y.sort_order)||(x.id-y.id)));
  const out=[];
  (function walk(pid,depth){
    (kids[pid]||[]).forEach(a=>{ out.push({a,depth,hasKids:!!(kids[a.id]&&kids[a.id].length)}); walk(a.id,depth+1); });
  })(0,0);
  /* Any row whose parent was deleted out from under it still has to appear. */
  const shown=new Set(out.map(o=>o.a.id));
  SC.acts.forEach(a=>{ if(!shown.has(a.id))out.push({a,depth:0,hasKids:false}); });
  return out;
}
function locOf(a){
  const bits=[];
  if(a.tower)bits.push('Tower '+a.tower);
  if(a.floor)bits.push('Flr '+a.floor);
  if(a.flat&&a.flat!=='NA')bits.push('Flat '+a.flat);
  if(a.room)bits.push(a.room);
  return bits.join(' · ')||'Project-wide';
}
function matches(a){
  const f=SC.f, q=(f.q||'').trim().toLowerCase();
  if(q&&![a.name,a.code,a.work_category,a.tower,a.floor,a.flat,a.room,a.notes].some(x=>String(x||'').toLowerCase().includes(q)))return false;
  if(f.level!=='All'&&a.level!==f.level)return false;
  if(f.tower!=='All'&&String(a.tower||'')!==f.tower)return false;
  if(f.floor!=='All'&&String(a.floor||'')!==f.floor)return false;
  if(f.flat!=='All'&&String(a.flat||'')!==f.flat)return false;
  if(f.cat!=='All'&&String(a.work_category||'')!==f.cat)return false;
  if(f.status!=='All'&&actState(a)!==f.status)return false;
  if(f.who!=='All'&&String(a.assigned_to||'')!==f.who)return false;
  if(f.contractor!=='All'&&String(a.contractor_id||'')!==f.contractor)return false;
  if(f.mine&&String(a.assigned_to||'').toLowerCase()!==me())return false;
  return true;
}
function filterActive(){ const f=SC.f; return !!(f.q||f.mine)||['level','tower','floor','flat','cat','status','who','contractor'].some(k=>f[k]!=='All'); }
/* Rows to draw: matching rows, plus every ancestor of a match so the tree stays readable,
   minus anything hidden inside a collapsed group. */
function visibleRows(){
  const all=tree(), byId={}; SC.acts.forEach(a=>{byId[a.id]=a;});
  let keep=null;
  if(filterActive()){
    keep=new Set();
    SC.acts.forEach(a=>{ if(!matches(a))return; let x=a,i=0; while(x&&i++<200){ keep.add(x.id); x=byId[x.parent_id]; } });
  }
  const out=[];
  const hidden=new Set();
  all.forEach(o=>{
    const a=o.a;
    if(keep&&!keep.has(a.id))return;
    let x=byId[a.parent_id],i=0,buried=false;
    while(x&&i++<200){ if(SC.collapsed.has(x.id)){buried=true;break;} x=byId[x.parent_id]; }
    if(buried){ hidden.add(a.id); return; }
    out.push(o);
  });
  return {rows:out,hiddenCount:hidden.size};
}

/* ============================ VIEW SHELL ============================ */
VIEWS.scheduling=async function(v,seg){
  setCrumb(['Operations','Project Scheduling']);
  if(seg&&seg[0]&&['plan','gantt','links','baselines','reschedule','contractors'].includes(seg[0]))SC.tab=seg[0];
  if(!SC.boot){
    loader(v);
    try{ await loadBoot(); await loadSchedule(); }
    catch(e){ return fail(v,e); }
  }
  draw(v);
};
function fail(v,e){
  v.innerHTML=head()+'<div class="card card-pad empty"><i class="fa-solid fa-triangle-exclamation"></i>'+
    '<div style="font-weight:600;color:var(--ink)">Could not load the schedule</div><p>'+E(e&&e.message||String(e))+'</p>'+
    '<button class="btn" style="margin-top:12px" onclick="schReload()"><i class="fa-solid fa-rotate"></i> Retry</button></div>';
}
function head(){
  return '<div class="page-head"><div><h1><i class="fa-solid fa-diagram-project" style="color:#7c3aed"></i> Project Scheduling</h1>'+
    '<p>Plan construction activities, link them, track actuals and reschedule what is still pending</p></div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
    (SC.schedId?'<button class="btn" onclick="schActForm(null,null)"><i class="fa-solid fa-plus"></i> Activity</button>':'')+
    '<button class="btn btn-primary" onclick="schSchedForm(null)"><i class="fa-solid fa-folder-plus"></i> New schedule</button>'+
    '</div></div>';
}
function draw(v){
  if(!SC.schedules.length){
    v.innerHTML=head()+'<div class="card card-pad empty"><i class="fa-regular fa-calendar"></i>'+
      '<div style="font-weight:600;color:var(--ink)">No schedules yet</div>'+
      '<p style="max-width:460px;margin:6px auto 0">A schedule holds the activity plan for one project — its working-day calendar, its activities and its baselines. Create one to begin.</p>'+
      '<button class="btn btn-primary" style="margin-top:14px" onclick="schSchedForm(null)"><i class="fa-solid fa-folder-plus"></i> New schedule</button></div>';
    return;
  }
  const t=SC.tab;
  v.innerHTML=head()+schedBar()+tabs(t)+'<div id="schBody"></div>';
  const body=document.getElementById('schBody');
  if(t==='gantt')            body.innerHTML=viewGantt();
  else if(t==='links')       body.innerHTML=viewLinks();
  else if(t==='baselines')   body.innerHTML=viewBaselines();
  else if(t==='reschedule')  body.innerHTML=viewReschedule();
  else if(t==='contractors') body.innerHTML=viewContractors();
  else                       body.innerHTML=viewPlan();
  if(t==='gantt')setTimeout(drawGanttLinks,0);
}
function tabs(t){
  const items=[['plan','Plan','fa-list-check'],['gantt','Gantt','fa-chart-gantt'],['links','Dependencies','fa-link'],
               ['baselines','Baselines','fa-layer-group'],['reschedule','Reschedule','fa-wand-magic-sparkles'],
               ['contractors','Contractors','fa-helmet-safety']];
  const pending=SC.runs.filter(r=>r.status==='Pending').length;
  return '<div class="tabs">'+items.map(i=>'<div class="tab'+(t===i[0]?' active':'')+'" onclick="schTab(\''+i[0]+'\')">'+
    '<i class="fa-solid '+i[2]+'" style="margin-right:6px"></i>'+i[1]+
    (i[0]==='reschedule'&&pending?' <span class="tag t-amber" style="margin-left:6px">'+pending+'</span>':'')+'</div>').join('')+'</div>';
}

/* Schedule picker + data date + headline numbers. */
function schedBar(){
  const s=sched(); if(!s)return '';
  const c=cal(), dd=dataDate();
  const st=stats();
  const cb=curBaseline();
  const offs=[...c.offs].sort().map(n=>WDAYS[n]).join(', ')||'none';
  const sel='<select class="sel" onchange="schPick(this.value)">'+SC.schedules.map(x=>
      '<option value="'+x.id+'"'+(x.id===SC.schedId?' selected':'')+'>'+E(x.project)+' — '+E(x.name)+'</option>').join('')+'</select>';
  const kpi=(lbl,val,col)=>'<div class="sch-kpi"><div class="n" style="color:'+col+'">'+val+'</div><div class="l">'+lbl+'</div></div>';
  return '<div class="card card-pad sch-bar">'+
    '<div class="sch-bar-top">'+
      '<div class="sch-bar-pick"><label>Schedule</label>'+sel+'</div>'+
      '<div class="sch-bar-pick"><label>Data date</label>'+
        '<input type="date" class="sel" value="'+E(d2s(dd))+'" onchange="schSetDataDate(this.value)" title="The as-of date every reschedule starts from">'+
      '</div>'+
      '<div class="sch-bar-meta">'+
        '<div><span class="sch-mk">Calendar</span> Week off: <b>'+E(offs)+'</b> · Holidays: <b>'+c.hol.size+'</b></div>'+
        '<div><span class="sch-mk">Baseline</span> '+(cb?'<b>'+E(cb.name)+'</b> <span style="color:var(--slate)">(#'+cb.seq+', '+fmtD(cb.created_at)+')</span>':'<span style="color:var(--slate)">none set</span>')+'</div>'+
        '<div><span class="sch-mk">Owner</span> '+(ownerOf()?'<b>'+E(nameOf(ownerOf()))+'</b>'+(iAmOwner()?' <span class="tag t-green">you</span>':'')+' <span style="color:var(--slate)">· approves reschedules</span>':'<span style="color:#c83232">not set — nobody can approve</span>')+'</div>'+
      '</div>'+
      '<div style="display:flex;gap:8px;margin-left:auto;flex-wrap:wrap">'+
        '<button class="btn btn-sm" onclick="schSchedForm('+s.id+')"><i class="fa-solid fa-sliders"></i> Calendar</button>'+
        '<button class="btn btn-sm" onclick="schBaselineForm()"><i class="fa-solid fa-layer-group"></i> Set baseline</button>'+
        '<button class="btn btn-sm btn-primary" onclick="schRunPreview()"><i class="fa-solid fa-wand-magic-sparkles"></i> Reschedule</button>'+
      '</div>'+
    '</div>'+
    '<div class="sch-kpis">'+
      kpi('Activities',st.total,'var(--ink)')+
      kpi('Completed',st.done,'#16855a')+
      kpi('In progress',st.wip,'#1763A6')+
      kpi('Not started',st.todo,'#94a3b8')+
      kpi('Overdue',st.late,st.late?'#c83232':'#94a3b8')+
      kpi('% complete',st.pct+'%','#7c3aed')+
      (st.slip!==null?kpi('Slip vs baseline',(st.slip>0?'+':'')+st.slip+'d',st.slip>0?'#c83232':'#16855a'):'')+
    '</div></div>';
}
function stats(){
  const c=cal(), dd=dataDate();
  const leaves=SC.acts.filter(a=>!a.is_group);
  let done=0,wip=0,todo=0,late=0,pct=0;
  leaves.forEach(a=>{
    const s=actState(a);
    if(s==='Completed')done++; else if(s==='In Progress')wip++; else todo++;
    pct+=a.actual_finish?100:Math.min(100,Math.max(0,a.progress_pct||0));
    const pf=finishOf(s2d(a.planned_start),a.planned_duration,c);
    if(!a.actual_finish&&pf&&pf<dd)late++;
  });
  /* Slip = how much the current plan's end date has moved past the comparison baseline's. */
  let slip=null;
  const bm=SC.cmpBase?SC.baseItems[SC.cmpBase]:null;
  if(bm){
    let pEnd=null,bEnd=null;
    leaves.forEach(a=>{
      pEnd=maxD(pEnd,s2d(a.actual_finish)||finishOf(s2d(a.planned_start),a.planned_duration,c));
      const b=bm[a.id]; if(b)bEnd=maxD(bEnd,s2d(b.planned_finish));
    });
    if(pEnd&&bEnd)slip=dayDiff(bEnd,pEnd);
  }
  return {total:leaves.length,done,wip,todo,late,pct:leaves.length?Math.round(pct/leaves.length):0,slip};
}

/* ============================ PLAN (the activity grid) ============================
   The grid shows the plan as stored. It does not silently re-run CPM — the stored planned
   start + duration IS the plan, and only an approved reschedule changes it. What the grid does
   add is a logic check: any link that the stored dates already break is flagged, so it is
   obvious before a reschedule is run.                                                        */
function logicIssues(){
  const c=cal(), byId={}; SC.acts.forEach(a=>{byId[a.id]=a;});
  const st=a=>s2d(a.planned_start), fi=a=>finishOf(s2d(a.planned_start),a.planned_duration,c);
  const out={};
  SC.deps.forEach(d=>{
    const p=byId[d.pred_id], s=byId[d.succ_id]; if(!p||!s)return;
    const ps=st(p),pf=fi(p),ss=st(s),sf=fi(s); if(!ps||!ss)return;
    const lag=d.lag_days|0; let bad=null;
    if(d.dep_type==='SS'){ const need=addWork(ps,lag,c); if(ss<need)bad='must start on or after '+fmtD(need); }
    else if(d.dep_type==='FF'){ const need=addWork(pf,lag,c); if(sf<need)bad='must finish on or after '+fmtD(need); }
    else if(d.dep_type==='SF'){ const need=addWork(ps,lag,c); if(sf<need)bad='must finish on or after '+fmtD(need); }
    else { const need=addWork(pf,1+lag,c); if(ss<need)bad='must start on or after '+fmtD(need); }
    if(bad)(out[s.id]=out[s.id]||[]).push(E(p.code||('#'+p.id))+' '+d.dep_type+(lag?(lag>0?'+':'')+lag+'d':'')+' — '+bad);
  });
  return out;
}
function predLabel(id){
  const byId={}; SC.acts.forEach(a=>{byId[a.id]=a;});
  return SC.deps.filter(d=>d.succ_id===id).map(d=>{
    const p=byId[d.pred_id]; if(!p)return '';
    return (p.code||('#'+p.id))+(d.dep_type==='FS'?'':' '+d.dep_type)+(d.lag_days?(d.lag_days>0?'+':'')+d.lag_days+'d':'');
  }).filter(Boolean).join(', ');
}
function viewPlan(){
  const c=cal(), dd=dataDate();
  const {rows,hiddenCount}=visibleRows();
  const issues=logicIssues();
  const M=masters();
  const body=rows.map(o=>planRow(o,c,dd,issues)).join('');
  const foot=hiddenCount?'<div style="padding:10px 14px;font-size:12.5px;color:var(--slate);border-top:1px dashed var(--line)">'+hiddenCount+' row(s) hidden inside collapsed groups · <a style="color:var(--brand);cursor:pointer" onclick="schExpandAll()">expand all</a></div>':'';
  return planToolbar(M)+
    '<div class="card" style="padding:0;overflow:hidden">'+
      '<div class="sch-grid-wrap"><table class="tbl sch-grid"><thead><tr>'+
        '<th style="min-width:250px">Activity</th><th>Level / location</th><th>Category</th>'+
        '<th>Plan start</th><th style="text-align:center">Dur</th><th>Plan finish</th>'+
        '<th>Actual start</th><th>Actual finish</th><th style="min-width:110px">Progress</th>'+
        '<th>Status</th><th>Pred.</th><th>vs base</th><th>Assigned</th><th>Contractor</th><th></th>'+
      '</tr></thead><tbody>'+
      (body||'<tr><td colspan="15"><div class="empty" style="padding:44px"><i class="fa-regular fa-rectangle-list"></i><div style="font-weight:600;color:var(--ink)">'+
        (SC.acts.length?'No activity matches these filters':'No activities yet')+'</div><p>'+
        (SC.acts.length?'Clear the filters to see the whole plan.':'Add the first activity — or a group to hold a set of them.')+'</p>'+
        (SC.acts.length?'':'<button class="btn btn-primary" style="margin-top:12px" onclick="schActForm(null,null)"><i class="fa-solid fa-plus"></i> Add activity</button>')+
        '</div></td></tr>')+
      '</tbody></table></div>'+foot+
    '</div>';
}
function planToolbar(M){
  const f=SC.f;
  const sel=(key,label,vals)=>'<select class="sel" onchange="schFilter(\''+key+'\',this.value)" title="'+label+'"><option value="All">'+label+': all</option>'+
    (vals||[]).map(x=>'<option value="'+E(x)+'"'+(f[key]===String(x)?' selected':'')+'>'+E(x)+'</option>').join('')+'</select>';
  const people=(PEOPLE||[]).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  return '<div class="toolbar">'+
    '<div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input id="schQ" placeholder="Search activity, code, category, location…" value="'+E(f.q)+'" oninput="schSearch(this.value)"></div>'+
    sel('level','Level',LEVELS)+sel('tower','Tower',M.towers)+sel('floor','Floor',M.floors)+sel('flat','Flat',M.flats)+
    sel('cat','Category',M.cats)+sel('status','Status',['Not Started','In Progress','Completed'])+
    '<select class="sel" onchange="schFilter(\'who\',this.value)"><option value="All">Assignee: all</option>'+
      people.map(p=>'<option value="'+E(p.email)+'"'+(f.who===p.email?' selected':'')+'>'+E(p.name)+'</option>').join('')+'</select>'+
    '<select class="sel" onchange="schFilter(\'contractor\',this.value)"><option value="All">Contractor: all</option>'+
      SC.contractors.map(x=>'<option value="'+x.id+'"'+(f.contractor===String(x.id)?' selected':'')+'>'+E(x.name)+'</option>').join('')+'</select>'+
    '<button class="chip'+(f.mine?' active':'')+'" onclick="schToggleMine()"><i class="fa-solid fa-user"></i> Mine</button>'+
    (filterActive()?'<button class="btn btn-sm" onclick="schFilterClear()"><i class="fa-solid fa-xmark"></i> Clear</button>':'')+
    '<span style="flex:1"></span>'+
    '<button class="btn btn-sm" onclick="schCollapseAll()"><i class="fa-solid fa-compress"></i></button>'+
    '<button class="btn btn-sm" onclick="schExpandAll()"><i class="fa-solid fa-expand"></i></button>'+
    '<button class="btn btn-sm" onclick="schExportCsv()"><i class="fa-solid fa-file-csv"></i> CSV</button>'+
  '</div>';
}
function planRow(o,c,dd,issues){
  const a=o.a, isG=a.is_group||o.hasKids;
  const ps=s2d(a.planned_start), pf=finishOf(ps,a.planned_duration,c);
  const st=actState(a), pct=pctOf(a,null);
  const late=!a.actual_finish&&pf&&pf<dd;
  const b=baseItem(a.id);
  const bf=b?s2d(b.planned_finish):null;
  const varD=(bf&&pf)?dayDiff(bf,pf):null;
  const iss=issues[a.id];
  const pad=8+o.depth*17;
  const caret=o.hasKids
    ? '<i class="fa-solid fa-caret-'+(SC.collapsed.has(a.id)?'right':'down')+' sch-caret" onclick="event.stopPropagation();schToggle('+a.id+')"></i>'
    : '<span class="sch-caret-sp"></span>';
  const rollup=isG?groupRollup(a.id,c):null;
  const showStart=isG?(rollup&&rollup.s):ps, showFin=isG?(rollup&&rollup.f):pf;
  const dur=isG?(rollup&&rollup.s&&rollup.f?workSpan(rollup.s,rollup.f,c):'—'):(a.planned_duration===0?'MS':a.planned_duration);
  return '<tr class="sch-row'+(isG?' sch-group':'')+(late?' sch-late':'')+'">'+
    '<td style="padding-left:'+pad+'px">'+caret+
      '<span class="sch-code">'+E(a.code||'')+'</span>'+
      '<b class="sch-name" onclick="schActForm('+a.id+',null)">'+E(a.name)+'</b>'+
      (a.planned_duration===0&&!isG?' <span class="tag t-purple" style="margin-left:5px">Milestone</span>':'')+
      (iss?' <i class="fa-solid fa-triangle-exclamation sch-warn" title="'+E(iss.join(' | '))+'"></i>':'')+
    '</td>'+
    '<td><span class="sch-lvl">'+E(a.level)+'</span><div class="sch-loc">'+E(locOf(a))+'</div></td>'+
    '<td style="color:var(--slate)">'+E(a.work_category||'—')+'</td>'+
    '<td>'+fmtD(showStart)+'</td>'+
    '<td style="text-align:center">'+dur+'</td>'+
    '<td'+(late?' style="color:#c83232;font-weight:600"':'')+'>'+fmtD(showFin)+'</td>'+
    '<td>'+(isG?'—':(a.actual_start?fmtD(a.actual_start):'<span style="color:#cbd5e1">—</span>'))+'</td>'+
    '<td>'+(isG?'—':(a.actual_finish?fmtD(a.actual_finish):'<span style="color:#cbd5e1">—</span>'))+'</td>'+
    '<td>'+(isG?groupPctBar(a.id):pctBar(pct))+'</td>'+
    '<td>'+(isG?'':statusTag(st))+'</td>'+
    '<td style="color:var(--slate);font-size:12px">'+E(predLabel(a.id)||'—')+'</td>'+
    '<td>'+(varD===null?'<span style="color:#cbd5e1">—</span>':'<span class="tag '+(varD>0?'t-red':varD<0?'t-green':'t-gray')+'">'+(varD>0?'+':'')+varD+'d</span>')+'</td>'+
    '<td>'+(a.assigned_to?avatar(nameOf(a.assigned_to))+' <span style="font-size:12.5px">'+E(nameOf(a.assigned_to))+'</span>':'<span style="color:#cbd5e1">—</span>')+'</td>'+
    '<td style="font-size:12.5px">'+(a.contractor_id?E(contractorName(a.contractor_id)):'<span style="color:#cbd5e1">—</span>')+'</td>'+
    '<td class="sch-acts">'+
      (isG?'':'<button class="sch-ib" title="Key in actuals" onclick="schActualsForm('+a.id+')"><i class="fa-solid fa-calendar-check"></i></button>')+
      '<button class="sch-ib" title="Edit" onclick="schActForm('+a.id+',null)"><i class="fa-solid fa-pen"></i></button>'+
      '<button class="sch-ib" title="Add sub-activity" onclick="schActForm(null,'+a.id+')"><i class="fa-solid fa-plus"></i></button>'+
      '<button class="sch-ib danger" title="Delete" onclick="schActDelete('+a.id+')"><i class="fa-solid fa-trash"></i></button>'+
    '</td></tr>';
}
function groupRollup(id,c){
  const kids={}; SC.acts.forEach(a=>{ const p=a.parent_id||0; (kids[p]=kids[p]||[]).push(a); });
  let s=null,f=null;
  (function walk(pid){ (kids[pid]||[]).forEach(a=>{
    if(!(a.is_group||(kids[a.id]&&kids[a.id].length))){
      const st=s2d(a.actual_start)||s2d(a.planned_start);
      const fi=s2d(a.actual_finish)||finishOf(s2d(a.planned_start),a.planned_duration,c);
      s=minD(s,st); f=maxD(f,fi);
    }
    walk(a.id);
  }); })(id);
  return {s,f};
}
function groupPctBar(id){
  const kids={}; SC.acts.forEach(a=>{ const p=a.parent_id||0; (kids[p]=kids[p]||[]).push(a); });
  let sum=0,n=0;
  (function walk(pid){ (kids[pid]||[]).forEach(a=>{
    if(!(a.is_group||(kids[a.id]&&kids[a.id].length))){ sum+=a.actual_finish?100:Math.min(100,Math.max(0,a.progress_pct||0)); n++; }
    walk(a.id);
  }); })(id);
  return pctBar(n?Math.round(sum/n):0);
}
function pctBar(p){
  const col=p>=100?'#16855a':p>0?'#1763A6':'#cbd5e1';
  return '<div style="display:flex;align-items:center;gap:7px"><div class="progress" style="max-width:64px;flex:1;min-width:44px"><span style="width:'+p+'%;background:'+col+'"></span></div><span style="font-size:11.5px;color:var(--slate)">'+p+'%</span></div>';
}

/* ============================ ACTIVITY FORM ============================ */
function optList(vals,cur,blank){
  return '<option value="">'+(blank||'—')+'</option>'+(vals||[]).map(x=>'<option value="'+E(x)+'"'+(String(cur||'')===String(x)?' selected':'')+'>'+E(x)+'</option>').join('');
}
window.schActForm=function(id,parentId){
  const a=id?SC.acts.find(x=>x.id===id):null;
  if(id&&!a)return;
  const M=masters();
  const isG=a?!!a.is_group:false;
  const parents=SC.acts.filter(x=>x.id!==id&&!isDescendant(x.id,id));
  const people=(PEOPLE||[]).slice().sort((x,y)=>String(x.name).localeCompare(String(y.name)));
  const lvl=a?a.level:'Project';
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-'+(id?'pen':'plus')+'"></i> '+(id?'Edit activity':'New activity')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'+
  '<div class="modal-body frm">'+
    '<div class="two"><div><label>Activity name</label><input id="afName" value="'+E(a?a.name:'')+'" placeholder="e.g. RCC slab casting — 3rd floor"></div>'+
    '<div><label>WBS code</label><input id="afCode" value="'+E(a?a.code:'')+'" placeholder="e.g. 1.2.3"></div></div>'+

    '<label style="display:flex;align-items:center;gap:9px;cursor:pointer"><input type="checkbox" id="afGroup" style="width:auto" '+(isG?'checked':'')+' onchange="schFormGroupToggle()"> This is a group (a summary row — its dates roll up from the activities inside it)</label>'+

    '<label>Sits under</label><select id="afParent"><option value="">— top level —</option>'+
      parents.map(p=>'<option value="'+p.id+'"'+((a?a.parent_id:parentId)===p.id?' selected':'')+'>'+E((p.code?p.code+' · ':'')+p.name)+'</option>').join('')+'</select>'+

    '<div class="two"><div><label>Level</label><select id="afLevel" onchange="schFormLevel()">'+
      LEVELS.map(l=>'<option'+(lvl===l?' selected':'')+'>'+l+'</option>').join('')+'</select></div>'+
    '<div><label>Work category</label><select id="afCat">'+optList(M.cats,a?a.work_category:'','— none —')+'</select></div></div>'+

    '<div id="afLoc" class="sch-loc-grid">'+locFields(lvl,a,M)+'</div>'+

    '<div id="afPlan"'+(isG?' class="hidden"':'')+'>'+
      '<div class="two"><div><label>Planned start</label><input type="date" id="afStart" value="'+E(a?a.planned_start:'')+'"></div>'+
      '<div><label>Planned duration (working days · 0 = milestone)</label><input type="number" min="0" id="afDur" value="'+(a?a.planned_duration:1)+'"></div></div>'+
      '<div class="two"><div><label>Constraint</label><select id="afCT" onchange="schFormConstraint()">'+
        Object.keys(CONSTR).map(k=>'<option value="'+k+'"'+((a?a.constraint_type:'ASAP')===k?' selected':'')+'>'+CONSTR[k]+'</option>').join('')+'</select></div>'+
      '<div id="afCDWrap"'+((a&&a.constraint_type&&a.constraint_type!=='ASAP')?'':' class="hidden"')+'><label>Constraint date</label><input type="date" id="afCD" value="'+E(a?a.constraint_date:'')+'"></div></div>'+
      '<label>Progress (%) — how much of the work is done</label><input type="number" min="0" max="100" id="afPct" value="'+(a?a.progress_pct:0)+'">'+
    '</div>'+

    '<div class="two"><div><label>Assigned to</label><select id="afWho"><option value="">— nobody —</option>'+
      people.map(p=>'<option value="'+E(p.email)+'"'+((a&&a.assigned_to)===p.email?' selected':'')+'>'+E(p.name)+'</option>').join('')+'</select></div>'+
    '<div><label>Contractor</label><select id="afCon"><option value="">— none —</option>'+
      SC.contractors.filter(x=>x.active||(a&&a.contractor_id===x.id)).map(x=>'<option value="'+x.id+'"'+((a&&a.contractor_id)===x.id?' selected':'')+'>'+E(x.name)+'</option>').join('')+
      '</select></div></div>'+

    '<label>Notes</label><textarea id="afNotes" placeholder="Optional">'+E(a?a.notes:'')+'</textarea>'+
    (id?'<div class="sch-hint"><i class="fa-solid fa-circle-info"></i> Actual start and actual finish are keyed in from the <b>Actuals</b> button on the row — they are never changed by a reschedule.</div>':'')+
  '</div>'+
  '<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" id="afSave" onclick="schActSave('+(id||'null')+')">'+(id?'Save':'Create')+'</button></div>','lg');
};
function isDescendant(id,ofId){
  if(!ofId)return false;
  const byId={}; SC.acts.forEach(a=>{byId[a.id]=a;});
  let x=byId[id],i=0; while(x&&i++<200){ if(x.parent_id===ofId)return true; x=byId[x.parent_id]; }
  return false;
}
function locFields(level,a,M){
  const need={Project:[],Tower:['tower'],Floor:['tower','floor'],Flat:['tower','floor','flat'],Room:['tower','floor','flat','room']}[level]||[];
  if(!need.length)return '<div class="sch-hint" style="margin:0"><i class="fa-solid fa-circle-info"></i> A project-level activity covers the whole project — no tower, floor or flat needed.</div>';
  const box=(id,label,vals,cur)=>'<div><label>'+label+'</label><select id="'+id+'">'+optList(vals,cur,'— any —')+'</select></div>';
  let h='';
  if(need.includes('tower'))h+=box('afTower','Tower / block',M.towers,a?a.tower:'');
  if(need.includes('floor'))h+=box('afFloor','Floor',M.floors,a?a.floor:'');
  if(need.includes('flat')) h+=box('afFlat','Flat',M.flats,a?a.flat:'');
  if(need.includes('room')) h+=box('afRoom','Room',M.rooms,a?a.room:'');
  return h;
}
window.schFormLevel=function(){
  const lvl=document.getElementById('afLevel').value;
  const a={tower:val('afTower'),floor:val('afFloor'),flat:val('afFlat'),room:val('afRoom')};
  document.getElementById('afLoc').innerHTML=locFields(lvl,a,masters());
};
window.schFormGroupToggle=function(){
  const on=document.getElementById('afGroup').checked;
  document.getElementById('afPlan').classList.toggle('hidden',on);
};
window.schFormConstraint=function(){
  const t=document.getElementById('afCT').value;
  document.getElementById('afCDWrap').classList.toggle('hidden',t==='ASAP');
};
function val(id){ const e=document.getElementById(id); return e?e.value:''; }
function num(id,def){ const e=document.getElementById(id); if(!e)return def; const n=parseInt(e.value,10); return isNaN(n)?def:n; }

window.schActSave=async function(id){
  const name=val('afName').trim();
  if(!name)return toast('Give the activity a name','warn');
  const isG=document.getElementById('afGroup').checked;
  const lvl=val('afLevel')||'Project';
  const ct=isG?'ASAP':(val('afCT')||'ASAP');
  const dur=isG?0:Math.max(0,num('afDur',1));
  const start=isG?null:(val('afStart')||null);
  const row={
    schedule_id:SC.schedId, name, code:val('afCode').trim()||null,
    is_group:isG, parent_id:val('afParent')?Number(val('afParent')):null,
    level:lvl,
    tower:lvl==='Project'?null:(val('afTower')||null),
    floor:(lvl==='Project'||lvl==='Tower')?null:(val('afFloor')||null),
    flat:(lvl==='Flat'||lvl==='Room')?(val('afFlat')||null):null,
    room:lvl==='Room'?(val('afRoom')||null):null,
    work_category:val('afCat')||null,
    planned_start:start, planned_duration:dur,
    constraint_type:ct, constraint_date:(ct==='ASAP'?null:(val('afCD')||null)),
    progress_pct:isG?0:Math.min(100,Math.max(0,num('afPct',0))),
    assigned_to:val('afWho')||null,
    contractor_id:val('afCon')?Number(val('afCon')):null,
    notes:val('afNotes').trim()||null
  };
  if(!isG&&!start)return toast('A planned start is needed (or mark it a group)','warn');
  if(row.parent_id&&id&&(row.parent_id===id||isDescendant(row.parent_id,id)))return toast('An activity cannot sit under itself','warn');
  const btn=document.getElementById('afSave'); if(btn)btn.disabled=true;
  try{
    if(id){ row.updated_at=new Date().toISOString();
      const {error}=await ACC().from('sched_activities').update(row).eq('id',id); if(error)throw error; }
    else { row.created_by=me(); row.sort_order=(SC.acts.reduce((m,x)=>Math.max(m,x.sort_order||0),0))+10;
      const {error}=await ACC().from('sched_activities').insert(row); if(error)throw error; }
    closeModal(); toast(id?'Activity saved':'Activity added','ok');
    await refresh();
  }catch(e){ if(btn)btn.disabled=false; toast(e.message||'Could not save','err'); }
};
window.schActDelete=async function(id){
  const a=SC.acts.find(x=>x.id===id); if(!a)return;
  const kids=SC.acts.filter(x=>x.parent_id===id).length;
  const links=SC.deps.filter(d=>d.pred_id===id||d.succ_id===id).length;
  const extra=[kids?kids+' sub-activity(ies)':'',links?links+' link(s)':''].filter(Boolean).join(' and ');
  if(!await confirmDialog('Delete "'+a.name+'"?'+(extra?' This also removes its '+extra+'.':''),{okLabel:'Delete'}))return;
  try{
    const {error}=await ACC().from('sched_activities').delete().eq('id',id); if(error)throw error;
    toast('Activity deleted','ok'); await refresh();
  }catch(e){ toast(e.message||'Could not delete','err'); }
};

/* ---- actuals: the only place actual start / actual finish are entered ---- */
window.schActualsForm=function(id){
  const a=SC.acts.find(x=>x.id===id); if(!a)return;
  const c=cal(), ps=s2d(a.planned_start), pf=finishOf(ps,a.planned_duration,c);
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-calendar-check" style="color:#16855a"></i> Actuals</h3><span class="x" onclick="closeModal()">&times;</span></div>'+
  '<div class="modal-body frm">'+
    '<div class="sch-actual-head"><b>'+E(a.name)+'</b><div style="color:var(--slate);font-size:12.5px;margin-top:2px">'+E(a.level)+' · '+E(locOf(a))+'</div>'+
      '<div style="margin-top:8px;font-size:12.5px;color:var(--slate)">Planned <b>'+fmtDLong(ps)+'</b> → <b>'+fmtDLong(pf)+'</b> · '+(a.planned_duration||0)+' working day(s)</div></div>'+
    '<div class="two"><div><label>Actual start</label><input type="date" id="acS" value="'+E(a.actual_start||'')+'"></div>'+
    '<div><label>Actual finish</label><input type="date" id="acF" value="'+E(a.actual_finish||'')+'"></div></div>'+
    '<label>Progress (%)</label><input type="number" min="0" max="100" id="acP" value="'+(a.progress_pct||0)+'">'+
    '<div class="sch-hint"><i class="fa-solid fa-circle-info"></i> Leave the finish blank while the work is still running — the reschedule uses the progress % to work out what is left. An activity reported at 0% is treated as still needing its full duration.</div>'+
  '</div>'+
  '<div class="modal-foot">'+
    (a.actual_start?'<button class="btn btn-danger" onclick="schActualsClear('+id+')">Clear actuals</button>':'')+
    '<span style="flex:1"></span><button class="btn" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" id="acSave" onclick="schActualsSave('+id+')">Save</button></div>');
};
window.schActualsSave=async function(id){
  const s=val('acS')||null, f=val('acF')||null;
  if(f&&!s)return toast('An actual finish needs an actual start','warn');
  if(s&&f&&s2d(f)<s2d(s))return toast('The finish cannot be before the start','warn');
  const pct=f?100:Math.min(100,Math.max(0,num('acP',0)));
  const btn=document.getElementById('acSave'); if(btn)btn.disabled=true;
  try{
    const {error}=await ACC().from('sched_activities')
      .update({actual_start:s,actual_finish:f,progress_pct:pct,updated_at:new Date().toISOString()}).eq('id',id);
    if(error)throw error;
    closeModal(); toast('Actuals saved','ok'); await refresh();
  }catch(e){ if(btn)btn.disabled=false; toast(e.message||'Could not save','err'); }
};
window.schActualsClear=async function(id){
  if(!await confirmDialog('Clear the actual start and finish for this activity?',{okLabel:'Clear'}))return;
  try{
    const {error}=await ACC().from('sched_activities')
      .update({actual_start:null,actual_finish:null,progress_pct:0,updated_at:new Date().toISOString()}).eq('id',id);
    if(error)throw error;
    closeModal(); toast('Actuals cleared','ok'); await refresh();
  }catch(e){ toast(e.message||'Could not clear','err'); }
};

/* ============================ GANTT ============================
   Plain HTML/SVG — no chart library. Bars are absolutely positioned on a day grid; the
   dependency arrows are one SVG layer drawn over the same grid.                          */
const ZOOM={day:{px:24,lbl:'Day'},week:{px:9,lbl:'Week'},month:{px:3.2,lbl:'Month'}};
const GLBL=290, GROW=30, GHEAD=48;
function viewGantt(){
  const c=cal(), dd=dataDate();
  const {rows}=visibleRows();
  if(!rows.length)return ganttBar()+'<div class="card card-pad empty"><i class="fa-regular fa-chart-bar"></i><div style="font-weight:600;color:var(--ink)">Nothing to chart</div><p>Add activities, or clear the filters.</p></div>';

  const bm=SC.cmpBase?SC.baseItems[SC.cmpBase]:null;
  const seg=[];                       // one entry per visible row
  let lo=null,hi=null;
  rows.forEach(o=>{
    const a=o.a, isG=a.is_group||o.hasKids;
    let s,f;
    if(isG){ const r=groupRollup(a.id,c); s=r.s; f=r.f; }
    else { s=s2d(a.actual_start)||s2d(a.planned_start); f=s2d(a.actual_finish)||finishOf(s2d(a.planned_start),a.planned_duration,c); }
    const b=bm?bm[a.id]:null;
    const bs=b?s2d(b.planned_start):null, bf=b?s2d(b.planned_finish):null;
    seg.push({o,a,isG,s,f,bs,bf});
    lo=minD(lo,minD(s,bs)); hi=maxD(hi,maxD(f,bf));
  });
  lo=minD(lo,dd)||dd; hi=maxD(hi,dd)||dd;
  lo=addDays(lo,-6); hi=addDays(hi,10);
  const px=ZOOM[SC.zoom].px, days=Math.max(1,dayDiff(lo,hi)+1), W=Math.round(days*px);
  const X=d=>d?Math.round(dayDiff(lo,d)*px):0;

  /* header: month band + tick row */
  let months='',ticks='';
  let m=new Date(lo.getFullYear(),lo.getMonth(),1);
  while(m<=hi){
    const mEnd=new Date(m.getFullYear(),m.getMonth()+1,0);
    const a=maxD(m,lo), b=minD(mEnd,hi);
    const x=X(a), w=Math.max(0,X(b)-x+px);
    if(w>2)months+='<div class="g-month" style="left:'+x+'px;width:'+w+'px">'+m.toLocaleDateString('en-IN',{month:'short',year:'2-digit'})+'</div>';
    m=new Date(m.getFullYear(),m.getMonth()+1,1);
  }
  const step=SC.zoom==='day'?1:SC.zoom==='week'?7:0;
  if(step){
    for(let i=0;i<days;i+=step){
      const d=addDays(lo,i), x=Math.round(i*px);
      const off=!c.isWork(d);
      ticks+='<div class="g-tick'+(off?' off':'')+'" style="left:'+x+'px;width:'+Math.round(step*px)+'px">'+
        (SC.zoom==='day'?d.getDate():d.getDate()+'/'+(d.getMonth()+1))+'</div>';
    }
  }
  /* non-working-day shading (day + week zoom only — at month zoom it is just noise) */
  let shade='';
  if(SC.zoom!=='month'){
    for(let i=0;i<days;i++){ const d=addDays(lo,i); if(!c.isWork(d))shade+='<div class="g-off" style="left:'+Math.round(i*px)+'px;width:'+Math.ceil(px)+'px"></div>'; }
  }
  const todayX=X(dd);

  const bars=seg.map((g,i)=>{
    const a=g.a, pct=g.isG?null:pctOf(a,null);
    const late=!a.actual_finish&&g.f&&g.f<dd&&!g.isG;
    const w=g.s&&g.f?Math.max(3,X(g.f)-X(g.s)+px):0;
    const isMs=!g.isG&&(a.planned_duration===0);
    let bar='';
    if(g.s&&g.f){
      if(isMs) bar='<div class="g-ms" style="left:'+(X(g.s)+px/2-6)+'px" title="'+E(a.name)+' · milestone '+fmtDLong(g.s)+'"></div>';
      else if(g.isG) bar='<div class="g-bar grp" style="left:'+X(g.s)+'px;width:'+w+'px" title="'+E(a.name)+' · '+fmtDLong(g.s)+' → '+fmtDLong(g.f)+'"></div>';
      else bar='<div class="g-bar'+(a.actual_finish?' done':late?' late':a.actual_start?' wip':'')+'" style="left:'+X(g.s)+'px;width:'+w+'px" '+
        'title="'+E(a.name)+'&#10;'+fmtDLong(g.s)+' → '+fmtDLong(g.f)+' · '+(a.planned_duration||0)+'d · '+pct+'%'+(a.contractor_id?'&#10;'+E(contractorName(a.contractor_id)):'')+'">'+
        (pct>0?'<span class="g-fill" style="width:'+pct+'%"></span>':'')+'</div>';
    }
    const base=(g.bs&&g.bf)?'<div class="g-base" style="left:'+X(g.bs)+'px;width:'+Math.max(3,X(g.bf)-X(g.bs)+px)+'px" title="Baseline '+fmtDLong(g.bs)+' → '+fmtDLong(g.bf)+'"></div>':'';
    const lbl='<div class="g-lbl" style="padding-left:'+(10+g.o.depth*14)+'px" title="'+E(a.name)+'">'+
        (g.isG?'<i class="fa-solid fa-folder" style="color:#94a3b8;margin-right:6px"></i>':'')+
        '<span class="g-lbl-t'+(g.isG?' b':'')+'" onclick="schActForm('+a.id+',null)">'+E(a.name)+'</span></div>';
    return '<div class="g-row'+(i%2?' alt':'')+'">'+lbl+'<div class="g-track" style="width:'+W+'px">'+bar+base+'</div></div>';
  }).join('');

  /* dependency arrows */
  const idx={}; seg.forEach((g,i)=>{idx[g.a.id]=i;});
  const arrows=SC.deps.map(d=>{
    const pi=idx[d.pred_id], si=idx[d.succ_id];
    if(pi===undefined||si===undefined)return '';
    const p=seg[pi], s=seg[si]; if(!p.s||!p.f||!s.s||!s.f)return '';
    const fromStart=(d.dep_type==='SS'||d.dep_type==='SF');
    const toFinish =(d.dep_type==='FF'||d.dep_type==='SF');
    const x1=fromStart?X(p.s):X(p.f)+px, y1=pi*GROW+GROW/2;
    const x2=toFinish ?X(s.f)+px:X(s.s),  y2=si*GROW+GROW/2;
    const dir=toFinish?1:-1, gap=9;
    const ax=x2+dir*gap, mid=(y1+y2)/2;
    const pts=[[x1,y1],[x1+(fromStart?-gap:gap),y1],[x1+(fromStart?-gap:gap),mid],[ax,mid],[ax,y2],[x2,y2]];
    const head=toFinish?[[x2,y2],[x2+7,y2-4],[x2+7,y2+4]]:[[x2,y2],[x2-7,y2-4],[x2-7,y2+4]];
    return '<polyline points="'+pts.map(q=>q[0]+','+q[1]).join(' ')+'"/><polygon points="'+head.map(q=>q[0]+','+q[1]).join(' ')+'"/>';
  }).join('');

  const H=seg.length*GROW;
  return ganttBar()+
  '<div class="card" style="padding:0;overflow:hidden">'+
    '<div class="gantt-wrap" id="ganttWrap">'+
      '<div style="min-width:'+(GLBL+W)+'px">'+
        '<div class="g-head"><div class="g-lbl head">Activity</div><div class="g-track" style="width:'+W+'px">'+
          shade+months+'<div class="g-tickrow">'+ticks+'</div>'+
          '<div class="g-today" style="left:'+todayX+'px" title="Data date '+fmtDLong(dd)+'"></div>'+
        '</div></div>'+
        '<div class="g-body" style="height:'+H+'px">'+bars+
          '<svg class="g-links" style="left:'+GLBL+'px;width:'+W+'px;height:'+H+'px">'+arrows+'</svg>'+
          '<div class="g-today body" style="left:'+(GLBL+todayX)+'px;height:'+H+'px"></div>'+
        '</div>'+
      '</div>'+
    '</div>'+
  '</div>'+
  '<div class="sch-legend">'+
    '<span><i class="g-key plan"></i> Planned</span><span><i class="g-key wip"></i> In progress</span>'+
    '<span><i class="g-key done"></i> Complete</span><span><i class="g-key late"></i> Overdue</span>'+
    '<span><i class="g-key grp"></i> Group</span><span><i class="g-key base"></i> Baseline</span>'+
    '<span><i class="g-key today"></i> Data date</span>'+
  '</div>';
}
function ganttBar(){
  const b=curBaseline();
  return '<div class="toolbar">'+
    '<div class="tabs-sm">'+Object.keys(ZOOM).map(k=>'<button class="tsm-btn'+(SC.zoom===k?' on':'')+'" onclick="schZoom(\''+k+'\')">'+ZOOM[k].lbl+'</button>').join('')+'</div>'+
    '<select class="sel" onchange="schCmpBase(this.value)"><option value="">Compare to: no baseline</option>'+
      SC.baselines.map(x=>'<option value="'+x.id+'"'+(SC.cmpBase===x.id?' selected':'')+'>#'+x.seq+' · '+E(x.name)+(x.is_current?' (current)':'')+'</option>').join('')+'</select>'+
    '<span style="flex:1"></span>'+
    '<button class="btn btn-sm" onclick="schGanttToday()"><i class="fa-solid fa-crosshairs"></i> Jump to data date</button>'+
  '</div>';
}
function drawGanttLinks(){ schGanttToday(); }
window.schGanttToday=function(){
  const w=document.getElementById('ganttWrap'); if(!w)return;
  /* The body marker, not the header one: its offsetLeft already includes the sticky label
     column, so it is the true x inside the scroll area. */
  const t=w.querySelector('.g-today.body'); if(!t)return;
  w.scrollLeft=Math.max(0,t.offsetLeft-w.clientWidth/2);
};
window.schZoom=function(z){ SC.zoom=z; redraw(); };
window.schCmpBase=async function(v){
  SC.cmpBase=v?Number(v):null;
  try{ if(SC.cmpBase)await loadBaselineItems(SC.cmpBase); }catch(e){ toast(e.message||'Could not load that baseline','err'); }
  redraw();
};

/* ============================ DEPENDENCIES ============================ */
function viewLinks(){
  const byId={}; SC.acts.forEach(a=>{byId[a.id]=a;});
  const iss=logicIssues();
  const rows=SC.deps.slice().sort((a,b)=>a.pred_id-b.pred_id||a.succ_id-b.succ_id).map(d=>{
    const p=byId[d.pred_id], s=byId[d.succ_id];
    if(!p||!s)return '';
    const bad=(iss[s.id]||[]).length;
    return '<tr>'+
      '<td><span class="sch-code">'+E(p.code||'')+'</span><b>'+E(p.name)+'</b><div class="sch-loc">'+E(locOf(p))+'</div></td>'+
      '<td><span class="tag t-blue">'+d.dep_type+'</span><div style="font-size:11.5px;color:var(--slate);margin-top:3px">'+DEPS_T[d.dep_type]+'</div></td>'+
      '<td style="text-align:center">'+(d.lag_days?(d.lag_days>0?'+':'')+d.lag_days+'d':'—')+'</td>'+
      '<td><span class="sch-code">'+E(s.code||'')+'</span><b>'+E(s.name)+'</b><div class="sch-loc">'+E(locOf(s))+'</div></td>'+
      '<td>'+(bad?'<span class="tag t-red" title="'+E((iss[s.id]||[]).join(' | '))+'">breached</span>':'<span class="tag t-green">ok</span>')+'</td>'+
      '<td style="text-align:right"><button class="sch-ib danger" onclick="schLinkDelete('+d.id+')" title="Remove link"><i class="fa-solid fa-trash"></i></button></td>'+
    '</tr>';
  }).join('');
  return '<div class="toolbar"><div style="font-size:13px;color:var(--slate)"><b>'+SC.deps.length+'</b> link(s) · a link decides how far a successor is pushed when its predecessor moves</div>'+
    '<span style="flex:1"></span><button class="btn btn-primary btn-sm" onclick="schLinkForm()"><i class="fa-solid fa-link"></i> Add link</button></div>'+
    '<div class="card" style="padding:0;overflow:hidden"><div style="overflow-x:auto"><table class="tbl">'+
    '<thead><tr><th>Predecessor</th><th>Type</th><th style="text-align:center">Lag</th><th>Successor</th><th>Plan check</th><th></th></tr></thead>'+
    '<tbody>'+(rows||'<tr><td colspan="6"><div class="empty" style="padding:44px"><i class="fa-solid fa-link-slash"></i><div style="font-weight:600;color:var(--ink)">No dependencies yet</div><p>Without links, a reschedule only moves activities that have started late — it cannot cascade.</p></div></td></tr>')+'</tbody></table></div></div>';
}
window.schLinkForm=function(){
  const opts=SC.acts.filter(a=>!a.is_group).sort((a,b)=>(a.sort_order-b.sort_order)||(a.id-b.id))
    .map(a=>'<option value="'+a.id+'">'+E((a.code?a.code+' · ':'')+a.name+'  —  '+locOf(a))+'</option>').join('');
  if(!opts)return toast('Add at least two activities first','warn');
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-link"></i> Add dependency</h3><span class="x" onclick="closeModal()">&times;</span></div>'+
  '<div class="modal-body frm">'+
    '<label>Predecessor — the activity that comes first</label><select id="lkP">'+opts+'</select>'+
    '<div class="two"><div><label>Relationship</label><select id="lkT">'+Object.keys(DEPS_T).map(k=>'<option value="'+k+'">'+k+' · '+DEPS_T[k]+'</option>').join('')+'</select></div>'+
    '<div><label>Lag (working days, may be negative)</label><input type="number" id="lkL" value="0"></div></div>'+
    '<label>Successor — the activity that waits</label><select id="lkS">'+opts+'</select>'+
    '<div class="sch-hint"><i class="fa-solid fa-circle-info"></i> Groups cannot be linked; link the activities inside them.</div>'+
  '</div>'+
  '<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="lkSave" onclick="schLinkSave()">Add link</button></div>');
};
window.schLinkSave=async function(){
  const p=Number(val('lkP')), s=Number(val('lkS'));
  if(!p||!s)return toast('Pick both activities','warn');
  if(p===s)return toast('An activity cannot depend on itself','warn');
  if(SC.deps.some(d=>d.pred_id===p&&d.succ_id===s))return toast('That link already exists','warn');
  const row={schedule_id:SC.schedId,pred_id:p,succ_id:s,dep_type:val('lkT')||'FS',lag_days:num('lkL',0),created_by:me()};
  /* refuse a link that would close a loop, rather than letting CPM discover it later */
  if(reachable(s,p,SC.deps.concat([row])))return toast('That link would create a dependency loop','warn');
  const btn=document.getElementById('lkSave'); if(btn)btn.disabled=true;
  try{
    const {error}=await ACC().from('sched_deps').insert(row); if(error)throw error;
    closeModal(); toast('Link added','ok'); await refresh();
  }catch(e){ if(btn)btn.disabled=false; toast(e.message||'Could not add the link','err'); }
};
function reachable(from,to,deps){
  const succ={}; deps.forEach(d=>{ (succ[d.pred_id]=succ[d.pred_id]||[]).push(d.succ_id); });
  const seen=new Set([from]), stack=[from];
  while(stack.length){ const x=stack.pop(); if(x===to)return true; (succ[x]||[]).forEach(y=>{ if(!seen.has(y)){seen.add(y);stack.push(y);} }); }
  return false;
}
window.schLinkDelete=async function(id){
  if(!await confirmDialog('Remove this dependency?',{okLabel:'Remove'}))return;
  try{ const {error}=await ACC().from('sched_deps').delete().eq('id',id); if(error)throw error;
    toast('Link removed','ok'); await refresh(); }
  catch(e){ toast(e.message||'Could not remove','err'); }
};

/* ============================ BASELINES ============================
   A baseline is a frozen copy of every activity's planned dates. The "current" baseline is the
   one variance is measured against by default; any baseline can be picked for comparison.   */
function snapshot(acts){
  const c=cal();
  return (acts||SC.acts).map(a=>({
    activity_id:a.id,
    planned_start:a.planned_start||null,
    planned_finish:d2s(finishOf(s2d(a.planned_start),a.planned_duration,c)),
    planned_duration:a.planned_duration,
    actual_start:a.actual_start||null,
    actual_finish:a.actual_finish||null,
    progress_pct:a.progress_pct||0
  }));
}
function viewBaselines(){
  const rows=SC.baselines.map(b=>'<tr'+(SC.cmpBase===b.id?' class="sch-sel"':'')+'>'+
    '<td><b>#'+b.seq+'</b></td>'+
    '<td><b>'+E(b.name)+'</b>'+(b.is_current?' <span class="tag t-green">current</span>':'')+
      (b.note?'<div class="sch-loc">'+E(b.note)+'</div>':'')+'</td>'+
    '<td><span class="tag '+(b.source==='reschedule'?'t-purple':'t-gray')+'">'+(b.source==='reschedule'?'from reschedule':'manual')+'</span></td>'+
    '<td>'+fmtDLong(b.created_at)+'<div class="sch-loc">'+E(nameOf(b.created_by))+'</div></td>'+
    '<td>'+(b.approved_by?fmtDLong(b.approved_at)+'<div class="sch-loc">'+E(nameOf(b.approved_by))+'</div>':'<span style="color:#cbd5e1">—</span>')+'</td>'+
    '<td style="text-align:right;white-space:nowrap">'+
      '<button class="btn btn-sm" onclick="schCmpBase('+b.id+')">'+(SC.cmpBase===b.id?'Comparing':'Compare')+'</button> '+
      (b.is_current?'':'<button class="btn btn-sm" onclick="schBaselineMakeCurrent('+b.id+')">Make current</button> ')+
      '<button class="sch-ib danger" title="Delete" onclick="schBaselineDelete('+b.id+')"><i class="fa-solid fa-trash"></i></button>'+
    '</td></tr>').join('');
  return '<div class="toolbar"><div style="font-size:13px;color:var(--slate)">A baseline freezes today\'s plan so later slippage can be measured against it. Approving a reschedule creates one automatically.</div>'+
    '<span style="flex:1"></span><button class="btn btn-primary btn-sm" onclick="schBaselineForm()"><i class="fa-solid fa-layer-group"></i> Set baseline</button></div>'+
    '<div class="card" style="padding:0;overflow:hidden"><div style="overflow-x:auto"><table class="tbl">'+
      '<thead><tr><th>#</th><th>Baseline</th><th>Source</th><th>Created</th><th>Approved</th><th></th></tr></thead><tbody>'+
      (rows||'<tr><td colspan="6"><div class="empty" style="padding:44px"><i class="fa-solid fa-layer-group"></i><div style="font-weight:600;color:var(--ink)">No baselines yet</div><p>Set one once the plan is agreed — everything after that is measured against it.</p></div></td></tr>')+
      '</tbody></table></div></div>'+
    (SC.cmpBase?varianceCard():'');
}
function varianceCard(){
  const c=cal(), bm=SC.baseItems[SC.cmpBase]||{}, b=SC.baselines.find(x=>x.id===SC.cmpBase);
  const rows=SC.acts.filter(a=>!a.is_group).map(a=>{
    const bi=bm[a.id];
    const ps=s2d(a.planned_start), pf=finishOf(ps,a.planned_duration,c);
    const bs=bi?s2d(bi.planned_start):null, bf=bi?s2d(bi.planned_finish):null;
    const ds=(bs&&ps)?dayDiff(bs,ps):null, df=(bf&&pf)?dayDiff(bf,pf):null;
    return {a,bs,bf,ps,pf,ds,df,isNew:!bi};
  }).filter(r=>r.isNew||r.ds||r.df).sort((x,y)=>(y.df||0)-(x.df||0));
  const cell=v=>v===null?'<span style="color:#cbd5e1">—</span>':'<span class="tag '+(v>0?'t-red':v<0?'t-green':'t-gray')+'">'+(v>0?'+':'')+v+'d</span>';
  return '<div class="card" style="padding:0;overflow:hidden;margin-top:16px">'+
    '<div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">Variance vs baseline #'+(b?b.seq:'')+' · '+E(b?b.name:'')+'</div>'+
      '<div style="font-size:12.5px;color:var(--slate);margin-top:3px">'+rows.length+' activity(ies) differ from that baseline. Positive = later than baseline.</div></div>'+
    '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Activity</th><th>Baseline start</th><th>Plan start</th><th>Δ start</th><th>Baseline finish</th><th>Plan finish</th><th>Δ finish</th></tr></thead><tbody>'+
    (rows.length?rows.map(r=>'<tr><td><b>'+E(r.a.name)+'</b>'+(r.isNew?' <span class="tag t-blue">added after baseline</span>':'')+'<div class="sch-loc">'+E(locOf(r.a))+'</div></td>'+
      '<td>'+fmtD(r.bs)+'</td><td>'+fmtD(r.ps)+'</td><td>'+cell(r.ds)+'</td>'+
      '<td>'+fmtD(r.bf)+'</td><td>'+fmtD(r.pf)+'</td><td>'+cell(r.df)+'</td></tr>').join('')
     :'<tr><td colspan="7"><div class="empty" style="padding:32px"><i class="fa-solid fa-equals"></i><div style="font-weight:600;color:var(--ink)">The plan still matches this baseline</div></div></td></tr>')+
    '</tbody></table></div></div>';
}
window.schBaselineForm=function(){
  if(!SC.acts.length)return toast('There is nothing to baseline yet','warn');
  const n=(SC.baselines[0]?SC.baselines[0].seq:0)+1;
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-layer-group"></i> Set baseline</h3><span class="x" onclick="closeModal()">&times;</span></div>'+
  '<div class="modal-body frm"><label>Name</label><input id="blName" value="Baseline '+n+'">'+
    '<label>Note</label><textarea id="blNote" placeholder="What is being frozen and why"></textarea>'+
    '<div class="sch-hint"><i class="fa-solid fa-circle-info"></i> Freezes the planned start, duration and finish of all '+SC.acts.length+' row(s) as they stand now, and becomes the current baseline.</div></div>'+
  '<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="blSave" onclick="schBaselineSave()">Set baseline</button></div>');
};
window.schBaselineSave=async function(){
  const btn=document.getElementById('blSave'); if(btn)btn.disabled=true;
  try{
    const {error}=await ACC().rpc('sched_baseline_create',{
      p_schedule_id:SC.schedId,p_name:val('blName').trim(),p_note:val('blNote').trim()||null,
      p_source:'manual',p_items:snapshot(),p_created_by:me(),p_approved_by:null});
    if(error)throw error;
    closeModal(); toast('Baseline set','ok'); SC.cmpBase=null; await refresh();
  }catch(e){ if(btn)btn.disabled=false; toast(e.message||'Could not set the baseline','err'); }
};
window.schBaselineMakeCurrent=async function(id){
  try{
    let r=await ACC().from('sched_baselines').update({is_current:false}).eq('schedule_id',SC.schedId).eq('is_current',true);
    if(r.error)throw r.error;
    r=await ACC().from('sched_baselines').update({is_current:true}).eq('id',id);
    if(r.error)throw r.error;
    toast('Current baseline changed','ok'); SC.cmpBase=id; await refresh();
  }catch(e){ toast(e.message||'Could not change it','err'); }
};
window.schBaselineDelete=async function(id){
  const b=SC.baselines.find(x=>x.id===id); if(!b)return;
  if(!await confirmDialog('Delete baseline #'+b.seq+' — "'+b.name+'"? The frozen dates in it are lost.',{okLabel:'Delete'}))return;
  try{
    const {error}=await ACC().from('sched_baselines').delete().eq('id',id); if(error)throw error;
    if(SC.cmpBase===id)SC.cmpBase=null; delete SC.baseItems[id];
    /* Deleting the current baseline would otherwise leave the schedule with baselines but no
       current one, and variance would silently disappear. Promote the newest survivor. */
    if(b.is_current){
      const next=SC.baselines.filter(x=>x.id!==id).sort((x,y)=>y.seq-x.seq)[0];
      if(next){ const r=await ACC().from('sched_baselines').update({is_current:true}).eq('id',next.id);
        if(r.error)throw r.error; SC.cmpBase=next.id; }
    }
    toast('Baseline deleted','ok'); await refresh();
  }catch(e){ toast(e.message||'Could not delete','err'); }
};

/* ============================ RESCHEDULE ============================
   Run → review → submit for approval → approve. Nothing touches the plan until approval, and
   approval writes the new dates and the resulting baseline in one transaction (sched_run_decide). */
function buildPreview(){
  const c=cal(), dd=dataDate();
  const {R,cycle}=cpm(SC.acts,SC.deps,c,dd);
  const rows=[];
  SC.acts.filter(a=>!a.is_group).forEach(a=>{
    const r=R[a.id]; if(!r||r.state==='done')return;
    const oldS=s2d(a.planned_start), oldF=finishOf(oldS,a.planned_duration,c);
    const newS=r.es, newF=r.ef;
    if(!newS||!newF)return;
    const newDur=(a.planned_duration===0)?0:Math.max(1,workSpan(newS,newF,c));
    const delta=oldF&&newF?dayDiff(oldF,newF):null;
    const changed=(d2s(newS)!==d2s(oldS))||newDur!==a.planned_duration;
    rows.push({id:a.id,name:a.name,loc:locOf(a),state:r.state,oldS,oldF,newS,newF,newDur,
               oldDur:a.planned_duration,delta,changed,float:r.float,critical:r.critical,violates:r.violates});
  });
  rows.sort((x,y)=>(y.delta||0)-(x.delta||0)||(x.newS-y.newS));
  return {dataDate:d2s(dd),rows,cycle};
}
window.schRunPreview=function(){
  if(!SC.acts.filter(a=>!a.is_group).length)return toast('Add activities first','warn');
  SC.preview=buildPreview(); SC.tab='reschedule';
  redraw();
  toast(SC.preview.rows.filter(r=>r.changed).length+' activity(ies) would move','ok');
};
function viewReschedule(){
  return (SC.preview?previewCard():'')+pendingCard()+historyCard();
}
function previewCard(){
  const p=SC.preview, moved=p.rows.filter(r=>r.changed);
  const cyc=p.cycle.length?'<div class="sch-alert err"><i class="fa-solid fa-circle-exclamation"></i> '+p.cycle.length+
    ' activity(ies) sit in a dependency loop and were left where they are. Fix the links on the Dependencies tab.</div>':'';
  const bad=p.rows.filter(r=>r.violates);
  const warn=bad.length?'<div class="sch-alert warn"><i class="fa-solid fa-triangle-exclamation"></i> '+bad.length+
    ' activity(ies) break a date constraint at these new dates: '+E(bad.slice(0,4).map(r=>r.name).join(', '))+(bad.length>4?' …':'')+'</div>':'';
  const rows=p.rows.map(r=>'<tr'+(r.changed?'':' class="sch-dim"')+'>'+
    '<td><b>'+E(r.name)+'</b><div class="sch-loc">'+E(r.loc)+'</div></td>'+
    '<td>'+(r.state==='wip'?'<span class="tag t-blue">in progress</span>':r.state==='cycle'?'<span class="tag t-red">looped</span>':'<span class="tag t-gray">not started</span>')+'</td>'+
    '<td>'+fmtD(r.oldS)+' → '+fmtD(r.oldF)+'</td>'+
    '<td><b>'+fmtD(r.newS)+' → '+fmtD(r.newF)+'</b></td>'+
    '<td style="text-align:center">'+(r.oldDur===r.newDur?r.newDur:'<b>'+r.oldDur+' → '+r.newDur+'</b>')+'</td>'+
    '<td>'+(r.delta===null?'—':'<span class="tag '+(r.delta>0?'t-red':r.delta<0?'t-green':'t-gray')+'">'+(r.delta>0?'+':'')+r.delta+'d</span>')+'</td>'+
    '<td style="text-align:center">'+(r.float==null?'—':(r.critical?'<span class="tag t-red">critical</span>':r.float+'d'))+'</td>'+
  '</tr>').join('');
  return '<div class="card" style="padding:0;overflow:hidden;margin-bottom:16px">'+
    '<div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px">'+
      '<div><div class="insp-kicker" style="color:#7c3aed">PROPOSAL — NOTHING SAVED YET</div>'+
      '<div class="sec-title" style="margin:2px 0 0">Reschedule from '+fmtDLong(p.dataDate)+'</div>'+
      '<div style="font-size:12.5px;color:var(--slate);margin-top:3px"><b>'+moved.length+'</b> of '+p.rows.length+' pending activity(ies) would move. Completed work is untouched.</div></div>'+
      '<div style="display:flex;gap:8px"><button class="btn" onclick="schPreviewDiscard()">Discard</button>'+
      '<button class="btn btn-primary" id="rsSubmit" onclick="schPreviewSubmit()"'+(moved.length?'':' disabled')+'><i class="fa-solid fa-paper-plane"></i> Submit for approval</button></div>'+
    '</div>'+cyc+warn+
    '<div style="overflow-x:auto;max-height:520px"><table class="tbl"><thead><tr><th>Activity</th><th>State</th><th>Current plan</th><th>Proposed</th><th style="text-align:center">Dur</th><th>Shift</th><th style="text-align:center">Float</th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="7"><div class="empty" style="padding:32px"><i class="fa-solid fa-check"></i><div style="font-weight:600;color:var(--ink)">Nothing pending to reschedule</div></div></td></tr>')+
    '</tbody></table></div></div>';
}
window.schPreviewDiscard=function(){ SC.preview=null; redraw(); };
window.schPreviewSubmit=async function(){
  const p=SC.preview; if(!p)return;
  const moved=p.rows.filter(r=>r.changed);
  if(!moved.length)return toast('Nothing would change','warn');
  const btn=document.getElementById('rsSubmit'); if(btn)btn.disabled=true;
  try{
    const ins=await ACC().from('sched_runs').insert({
      schedule_id:SC.schedId,data_date:p.dataDate,status:'Pending',created_by:me(),
      note:moved.length+' activity(ies) proposed to move'}).select('id').single();
    if(ins.error)throw ins.error;
    const runId=ins.data.id;
    const items=moved.map(r=>({run_id:runId,activity_id:r.id,
      old_start:d2s(r.oldS),old_finish:d2s(r.oldF),old_duration:r.oldDur,
      new_start:d2s(r.newS),new_finish:d2s(r.newF),new_duration:r.newDur,delta_days:r.delta}));
    const it=await ACC().from('sched_run_items').insert(items);
    /* Without this the header row would survive as a Pending approval with nothing in it. */
    if(it.error){ try{ await ACC().from('sched_runs').delete().eq('id',runId); }catch(_){} throw it.error; }
    SC.preview=null; SC.runOpen=runId;
    toast('Sent for approval','ok'); await refresh();
  }catch(e){ if(btn)btn.disabled=false; toast(e.message||'Could not submit','err'); }
};
function pendingCard(){
  const pend=SC.runs.filter(r=>r.status==='Pending');
  if(!pend.length)return '';
  return pend.map(r=>'<div class="card" style="padding:0;overflow:hidden;margin-bottom:16px">'+
    '<div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px">'+
      '<div><div class="insp-kicker" style="color:#E08600">AWAITING APPROVAL</div>'+
      '<div class="sec-title" style="margin:2px 0 0">Reschedule #'+r.id+' · data date '+fmtDLong(r.data_date)+'</div>'+
      '<div style="font-size:12.5px;color:var(--slate);margin-top:3px">Raised by '+E(nameOf(r.created_by))+' · '+fmtDLong(r.created_at)+(r.note?' · '+E(r.note):'')+'</div></div>'+
      '<div style="display:flex;gap:8px">'+
        '<button class="btn btn-sm" onclick="schRunOpen('+r.id+')">'+(SC.runOpen===r.id?'Hide':'Review')+' changes</button>'+
        (iAmOwner()
          ?'<button class="btn btn-sm btn-danger" onclick="schRunDecide('+r.id+',\'Rejected\')">Reject</button>'+
           '<button class="btn btn-sm btn-ok" onclick="schRunDecide('+r.id+',\'Approved\')"><i class="fa-solid fa-check"></i> Approve</button>'
          :'')+
      '</div></div>'+
    (SC.runOpen===r.id?'<div id="runItems'+r.id+'" class="sch-run-items"><div class="loader"><div class="spin"></div></div></div>':'')+
    '<div class="sch-hint" style="margin:0;border-top:1px solid var(--line);border-radius:0"><i class="fa-solid fa-'+(iAmOwner()?'circle-info':'lock')+'"></i> '+
      (iAmOwner()
        ?'Approving writes these dates onto the plan and freezes the result as the next baseline.'
        :(ownerOf()
           ?'Only the schedule owner, <b>'+E(nameOf(ownerOf()))+'</b>, can approve or reject this. You can still review the changes.'
           :'This schedule has no owner, so nobody can approve it. Set an owner from <b>Calendar</b>.'))+
    '</div></div>').join('');
}
window.schRunOpen=async function(id){
  SC.runOpen=SC.runOpen===id?null:id;
  redraw();
  if(SC.runOpen!==id)return;
  const host=document.getElementById('runItems'+id); if(!host)return;
  try{
    const {data,error}=await ACC().from('sched_run_items').select('*').eq('run_id',id);
    if(error)throw error;
    const byId={}; SC.acts.forEach(a=>{byId[a.id]=a;});
    host.innerHTML='<div style="overflow-x:auto;max-height:420px"><table class="tbl"><thead><tr><th>Activity</th><th>Was</th><th>Becomes</th><th>Shift</th></tr></thead><tbody>'+
      (data||[]).map(x=>{const a=byId[x.activity_id];return '<tr><td><b>'+E(a?a.name:'#'+x.activity_id)+'</b>'+(a?'<div class="sch-loc">'+E(locOf(a))+'</div>':'')+'</td>'+
        '<td>'+fmtD(x.old_start)+' → '+fmtD(x.old_finish)+'</td><td><b>'+fmtD(x.new_start)+' → '+fmtD(x.new_finish)+'</b></td>'+
        '<td><span class="tag '+((x.delta_days||0)>0?'t-red':(x.delta_days||0)<0?'t-green':'t-gray')+'">'+((x.delta_days||0)>0?'+':'')+(x.delta_days||0)+'d</span></td></tr>';}).join('')+
      '</tbody></table></div>';
  }catch(e){ host.innerHTML='<div class="card-pad" style="color:var(--err)">'+E(e.message||String(e))+'</div>'; }
};
window.schRunDecide=async function(id,decision){
  const r=SC.runs.find(x=>x.id===id); if(!r)return;
  if(!iAmOwner())return toast(ownerOf()?('Only '+nameOf(ownerOf())+' owns this schedule and can decide this'):'This schedule has no owner yet','warn');
  if(decision==='Rejected'){
    if(!await confirmDialog('Reject reschedule #'+id+'? The plan stays as it is.',{okLabel:'Reject'}))return;
  }else{
    if(!await confirmDialog('Approve reschedule #'+id+'? The proposed dates are written onto the plan and frozen as a new baseline.',
        {danger:false,okLabel:'Approve',icon:'fa-circle-check'}))return;
  }
  try{
    let items=[];
    if(decision==='Approved'){
      /* Snapshot the plan as it will look once the run is applied — the RPC stores this as the
         new baseline in the same transaction that writes the dates. */
      const {data,error}=await ACC().from('sched_run_items').select('*').eq('run_id',id);
      if(error)throw error;
      const upd={}; (data||[]).forEach(x=>{upd[x.activity_id]=x;});
      const after=SC.acts.map(a=>{
        const u=upd[a.id]; if(!u)return a;
        return Object.assign({},a,{planned_start:u.new_start,planned_duration:u.new_duration==null?a.planned_duration:u.new_duration});
      });
      items=snapshot(after);
    }
    const res=await ACC().rpc('sched_run_decide',{
      p_run_id:id,p_decision:decision,p_by:me(),
      p_baseline_name:decision==='Approved'?('Rescheduled '+fmtDLong(r.data_date)):null,
      p_items:items});
    if(res.error)throw res.error;
    SC.runOpen=null; SC.cmpBase=null; SC.preview=null;
    toast(decision==='Approved'?'Reschedule approved — new baseline created':'Reschedule rejected','ok');
    await refresh();
  }catch(e){ toast(e.message||'Could not record the decision','err'); }
};
function historyCard(){
  const past=SC.runs.filter(r=>r.status!=='Pending');
  if(!past.length&&!SC.preview&&!SC.runs.length){
    return '<div class="card card-pad empty"><i class="fa-solid fa-wand-magic-sparkles"></i>'+
      '<div style="font-weight:600;color:var(--ink)">No reschedule has been run yet</div>'+
      '<p style="max-width:480px;margin:6px auto 0">A reschedule reads the actual starts and finishes you have keyed in, the planned durations and the dependency links, and works out fresh dates for everything still pending — from the data date forward.</p>'+
      '<button class="btn btn-primary" style="margin-top:14px" onclick="schRunPreview()"><i class="fa-solid fa-wand-magic-sparkles"></i> Run a reschedule</button></div>';
  }
  if(!past.length)return '';
  return '<div class="card" style="padding:0;overflow:hidden"><div class="card-pad" style="border-bottom:1px solid var(--line)"><div class="sec-title" style="margin:0">History</div></div>'+
    '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>#</th><th>Data date</th><th>Raised by</th><th>Outcome</th><th>Decided</th><th>Baseline</th></tr></thead><tbody>'+
    past.map(r=>{const b=SC.baselines.find(x=>x.id===r.baseline_id);
      return '<tr><td><b>'+r.id+'</b></td><td>'+fmtDLong(r.data_date)+'</td>'+
      '<td>'+E(nameOf(r.created_by))+'<div class="sch-loc">'+fmtDLong(r.created_at)+'</div></td>'+
      '<td><span class="tag '+(r.status==='Approved'?'t-green':'t-red')+'">'+r.status+'</span></td>'+
      '<td>'+(r.decided_by?E(nameOf(r.decided_by))+'<div class="sch-loc">'+fmtDLong(r.decided_at)+'</div>':'—')+'</td>'+
      '<td>'+(b?'#'+b.seq+' · '+E(b.name):'—')+'</td></tr>';}).join('')+
    '</tbody></table></div></div>';
}

/* ============================ CONTRACTORS ============================ */
function viewContractors(){
  const used={}; SC.acts.forEach(a=>{ if(a.contractor_id)used[a.contractor_id]=(used[a.contractor_id]||0)+1; });
  const rows=SC.contractors.map(x=>'<tr'+(x.active?'':' class="sch-dim"')+'>'+
    '<td>'+avatar(x.name)+' <b>'+E(x.name)+'</b>'+(x.active?'':' <span class="tag t-gray">inactive</span>')+'</td>'+
    '<td style="color:var(--slate)">'+E(x.code||'—')+'</td><td>'+E(x.trade||'—')+'</td>'+
    '<td>'+E(x.contact_person||'—')+'<div class="sch-loc">'+E([x.phone,x.email].filter(Boolean).join(' · ')||'')+'</div></td>'+
    '<td style="text-align:center">'+(used[x.id]||0)+'</td>'+
    '<td style="text-align:right"><button class="sch-ib" onclick="schConForm('+x.id+')" title="Edit"><i class="fa-solid fa-pen"></i></button>'+
      '<button class="sch-ib danger" onclick="schConDelete('+x.id+')" title="Delete"><i class="fa-solid fa-trash"></i></button></td></tr>').join('');
  return '<div class="toolbar"><div style="font-size:13px;color:var(--slate)">Contractors available to assign to any activity in any schedule.</div>'+
    '<span style="flex:1"></span><button class="btn btn-primary btn-sm" onclick="schConForm(null)"><i class="fa-solid fa-plus"></i> Add contractor</button></div>'+
    '<div class="card" style="padding:0;overflow:hidden"><div style="overflow-x:auto"><table class="tbl">'+
    '<thead><tr><th>Contractor</th><th>Code</th><th>Trade</th><th>Contact</th><th style="text-align:center">Activities</th><th></th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="6"><div class="empty" style="padding:44px"><i class="fa-solid fa-helmet-safety"></i><div style="font-weight:600;color:var(--ink)">No contractors yet</div><p>Add the agencies doing the work so activities can be assigned to them.</p></div></td></tr>')+
    '</tbody></table></div></div>';
}
window.schConForm=function(id){
  const x=id?SC.contractors.find(y=>y.id===id):null;
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-helmet-safety"></i> '+(id?'Edit contractor':'New contractor')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'+
  '<div class="modal-body frm">'+
    '<div class="two"><div><label>Name</label><input id="cnName" value="'+E(x?x.name:'')+'"></div>'+
    '<div><label>Code</label><input id="cnCode" value="'+E(x?x.code:'')+'" placeholder="optional, unique"></div></div>'+
    '<label>Trade / scope</label><input id="cnTrade" value="'+E(x?x.trade:'')+'" placeholder="e.g. RCC, Plumbing, Finishing">'+
    '<div class="two"><div><label>Contact person</label><input id="cnPer" value="'+E(x?x.contact_person:'')+'"></div>'+
    '<div><label>Phone</label><input id="cnPh" value="'+E(x?x.phone:'')+'"></div></div>'+
    '<label>Email</label><input id="cnEm" value="'+E(x?x.email:'')+'">'+
    '<label style="display:flex;align-items:center;gap:9px;cursor:pointer"><input type="checkbox" id="cnAct" style="width:auto" '+(!x||x.active?'checked':'')+'> Active (available to assign)</label>'+
  '</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>'+
  '<button class="btn btn-primary" id="cnSave" onclick="schConSave('+(id||'null')+')">'+(id?'Save':'Add')+'</button></div>');
};
window.schConSave=async function(id){
  const name=val('cnName').trim(); if(!name)return toast('Name is needed','warn');
  const row={name,code:val('cnCode').trim()||null,trade:val('cnTrade').trim()||null,
             contact_person:val('cnPer').trim()||null,phone:val('cnPh').trim()||null,
             email:val('cnEm').trim()||null,active:document.getElementById('cnAct').checked};
  const btn=document.getElementById('cnSave'); if(btn)btn.disabled=true;
  try{
    const q=id?ACC().from('sched_contractors').update(row).eq('id',id)
              :ACC().from('sched_contractors').insert(Object.assign({created_by:me()},row));
    const {error}=await q; if(error)throw error;
    closeModal(); toast(id?'Contractor saved':'Contractor added','ok');
    const {data}=await ACC().from('sched_contractors').select('*').order('name');
    SC.contractors=data||[]; redraw();
  }catch(e){ if(btn)btn.disabled=false; toast(e.message||'Could not save','err'); }
};
window.schConDelete=async function(id){
  const x=SC.contractors.find(y=>y.id===id); if(!x)return;
  const n=SC.acts.filter(a=>a.contractor_id===id).length;
  if(!await confirmDialog('Delete "'+x.name+'"?'+(n?' '+n+' activity(ies) in this schedule will be left with no contractor.':''),{okLabel:'Delete'}))return;
  try{ const {error}=await ACC().from('sched_contractors').delete().eq('id',id); if(error)throw error;
    toast('Contractor deleted','ok');
    const {data}=await ACC().from('sched_contractors').select('*').order('name');
    SC.contractors=data||[]; await refresh(); }
  catch(e){ toast(e.message||'Could not delete','err'); }
};

/* ============================ SCHEDULE / CALENDAR FORM ============================ */
window.schSchedForm=function(id){
  const s=id?SC.schedules.find(x=>x.id===id):null;
  const offs=new Set(((s&&Array.isArray(s.week_offs))?s.week_offs:[0]).map(Number));
  const hol=((s&&Array.isArray(s.holidays))?s.holidays:[]).map(x=>String(x).slice(0,10)).join('\n');
  const projects=(window.INSP_PROJECTS||[]).concat(SC.schedules.map(x=>x.project));
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-'+(id?'sliders':'folder-plus')+'"></i> '+(id?'Schedule & calendar':'New schedule')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'+
  '<div class="modal-body frm">'+
    '<div class="two"><div><label>Project</label><input id="sfProj" list="sfProjList" value="'+E(s?s.project:'')+'" placeholder="e.g. Dream World City">'+
      '<datalist id="sfProjList">'+[...new Set(projects)].filter(Boolean).map(p=>'<option value="'+E(p)+'">').join('')+'</datalist></div>'+
    '<div><label>Schedule name</label><input id="sfName" value="'+E(s?s.name:'')+'" placeholder="e.g. Tower A — execution plan"></div></div>'+
    '<label>Description</label><textarea id="sfDesc" placeholder="Optional">'+E(s?s.description:'')+'</textarea>'+
    '<label>Owner — the only person who can approve or reject a reschedule</label>'+
    '<select id="sfOwner">'+(function(){
      const cur=String((s&&(s.owner_email||s.created_by))||me()).toLowerCase();
      const people=(PEOPLE||[]).slice().sort((x,y)=>String(x.name).localeCompare(String(y.name)));
      const known=people.some(p=>String(p.email).toLowerCase()===cur);
      return '<option value="">— nobody (no reschedule can be approved) —</option>'+
        (cur&&!known?'<option value="'+E(cur)+'" selected>'+E(cur)+'</option>':'')+
        people.map(p=>'<option value="'+E(p.email)+'"'+(String(p.email).toLowerCase()===cur?' selected':'')+'>'+E(p.name)+'</option>').join('');
    })()+'</select>'+
    '<div class="two"><div><label>Status</label><select id="sfStatus">'+['Draft','Active','Closed'].map(x=>'<option'+((s?s.status:'Active')===x?' selected':'')+'>'+x+'</option>').join('')+'</select></div>'+
    '<div><label>Data date (the as-of date a reschedule starts from)</label><input type="date" id="sfDD" value="'+E(s?s.data_date:d2s(istToday()))+'"></div></div>'+
    '<label>Weekly off — days not worked</label>'+
    '<div class="sch-wdays">'+WDAYS.map((d,i)=>'<label class="sch-wday"><input type="checkbox" class="sfWd" value="'+i+'"'+(offs.has(i)?' checked':'')+'> '+d+'</label>').join('')+'</div>'+
    '<label>Holidays — one date per line (YYYY-MM-DD)</label><textarea id="sfHol" placeholder="2026-10-20&#10;2026-11-08" style="min-height:96px;font-family:ui-monospace,monospace">'+E(hol)+'</textarea>'+
    '<div class="sch-hint"><i class="fa-solid fa-circle-info"></i> Every duration in this schedule is counted in working days on this calendar. Changing it does not move any date on its own — run a reschedule for that.</div>'+
  '</div>'+
  '<div class="modal-foot">'+
    (id?'<button class="btn btn-danger" onclick="schSchedDelete('+id+')">Delete schedule</button>':'')+
    '<span style="flex:1"></span><button class="btn" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" id="sfSave" onclick="schSchedSave('+(id||'null')+')">'+(id?'Save':'Create')+'</button></div>','lg');
};
window.schSchedSave=async function(id){
  const project=val('sfProj').trim(), name=val('sfName').trim();
  if(!project)return toast('Which project is this for?','warn');
  if(!name)return toast('Give the schedule a name','warn');
  const offs=[...document.querySelectorAll('.sfWd')].filter(x=>x.checked).map(x=>Number(x.value));
  if(offs.length>=7)return toast('At least one day of the week has to be a working day','warn');
  const bad=[];
  const hol=val('sfHol').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean)
    .filter(x=>{ const ok=/^\d{4}-\d{2}-\d{2}$/.test(x)&&s2d(x); if(!ok)bad.push(x); return ok; });
  if(bad.length)return toast('These holidays are not YYYY-MM-DD: '+bad.slice(0,3).join(', '),'warn');
  const row={project,name,description:val('sfDesc').trim()||null,status:val('sfStatus'),
             owner_email:val('sfOwner')||null,
             data_date:val('sfDD')||d2s(istToday()),week_offs:offs,holidays:[...new Set(hol)].sort(),
             updated_at:new Date().toISOString()};
  const btn=document.getElementById('sfSave'); if(btn)btn.disabled=true;
  try{
    if(id){ const {error}=await ACC().from('sched_schedules').update(row).eq('id',id); if(error)throw error; }
    else{
      const {data,error}=await ACC().from('sched_schedules')
        .insert(Object.assign({created_by:me()},row)).select('id').single();
      if(error)throw error;
      SC.schedId=data.id; localStorage.setItem(LS_KEY,String(data.id));
      SC.cmpBase=null; SC.collapsed=new Set(); SC.preview=null;
    }
    closeModal(); toast(id?'Schedule saved':'Schedule created','ok');
    const {data}=await ACC().from('sched_schedules').select('*').order('created_at',{ascending:false});
    SC.schedules=data||[]; await refresh();
  }catch(e){ if(btn)btn.disabled=false; toast(e.message||'Could not save','err'); }
};
window.schSchedDelete=async function(id){
  const s=SC.schedules.find(x=>x.id===id); if(!s)return;
  const n=SC.acts.length;
  if(!await confirmDialog('Delete the schedule "'+s.name+'"? Its '+n+' activity(ies), links, baselines and reschedule history go with it.',{okLabel:'Delete schedule'}))return;
  try{
    const {error}=await ACC().from('sched_schedules').delete().eq('id',id); if(error)throw error;
    closeModal(); toast('Schedule deleted','ok');
    const {data}=await ACC().from('sched_schedules').select('*').order('created_at',{ascending:false});
    SC.schedules=data||[];
    SC.schedId=SC.schedules.length?SC.schedules[0].id:null;
    localStorage.setItem(LS_KEY,String(SC.schedId||''));
    SC.cmpBase=null; SC.preview=null; SC.collapsed=new Set();
    await refresh();
  }catch(e){ toast(e.message||'Could not delete','err'); }
};

/* ============================ HANDLERS ============================ */
function redraw(){ const v=document.getElementById('view'); if(v&&PAGE==='scheduling')draw(v); }
async function refresh(){
  try{ await loadSchedule(); }catch(e){ toast(e.message||'Could not reload','err'); }
  redraw();
}
window.schReload=async function(){ SC.boot=false; renderPage(); };
window.schTab=function(t){ SC.tab=t; SC.runOpen=null; navTo('scheduling/'+t); };
window.schPick=async function(v){
  SC.schedId=Number(v); localStorage.setItem(LS_KEY,String(SC.schedId));
  SC.cmpBase=null; SC.preview=null; SC.runOpen=null; SC.collapsed=new Set(); SC.f=F0();
  await refresh();
};
window.schSetDataDate=async function(v){
  if(!v)return;
  try{
    const {error}=await ACC().from('sched_schedules').update({data_date:v,updated_at:new Date().toISOString()}).eq('id',SC.schedId);
    if(error)throw error;
    const s=sched(); if(s)s.data_date=v;
    SC.preview=null; toast('Data date set to '+fmtDLong(v),'ok'); redraw();
  }catch(e){ toast(e.message||'Could not set the data date','err'); }
};
window.schFilter=function(k,v){ SC.f[k]=v; redraw(); };
window.schToggleMine=function(){ SC.f.mine=!SC.f.mine; redraw(); };
window.schFilterClear=function(){ SC.f=F0(); redraw(); };
window.schSearch=function(v){
  SC.f.q=v; redraw();
  const i=document.getElementById('schQ');
  if(i){ i.focus(); try{ i.setSelectionRange(i.value.length,i.value.length); }catch(e){} }
};
window.schToggle=function(id){ if(SC.collapsed.has(id))SC.collapsed.delete(id); else SC.collapsed.add(id); redraw(); };
window.schCollapseAll=function(){
  const kids=new Set(SC.acts.map(a=>a.parent_id).filter(Boolean));
  SC.collapsed=new Set([...kids].concat(SC.acts.filter(a=>a.is_group).map(a=>a.id)));
  redraw();
};
window.schExpandAll=function(){ SC.collapsed=new Set(); redraw(); };

window.schExportCsv=function(){
  const c=cal(), dd=dataDate();
  const {rows}=visibleRows();
  const head=['WBS','Activity','Group','Level','Tower','Floor','Flat','Room','Category',
              'Plan start','Duration (wd)','Plan finish','Actual start','Actual finish','Progress %',
              'Status','Predecessors','Assigned to','Contractor','Baseline finish','Variance (d)','Notes'];
  const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const body=rows.map(o=>{
    const a=o.a, isG=a.is_group||o.hasKids;
    const ps=s2d(a.planned_start), pf=finishOf(ps,a.planned_duration,c);
    const b=baseItem(a.id), bf=b?s2d(b.planned_finish):null;
    const roll=isG?groupRollup(a.id,c):null;
    return [a.code||'',a.name,isG?'Yes':'',a.level,a.tower||'',a.floor||'',a.flat||'',a.room||'',a.work_category||'',
      d2s(isG?(roll&&roll.s):ps)||'',isG?'':a.planned_duration,d2s(isG?(roll&&roll.f):pf)||'',
      a.actual_start||'',a.actual_finish||'',isG?'':pctOf(a,null),isG?'':actState(a),
      predLabel(a.id),a.assigned_to?nameOf(a.assigned_to):'',a.contractor_id?contractorName(a.contractor_id):'',
      d2s(bf)||'',(bf&&pf)?dayDiff(bf,pf):'',a.notes||''].map(q).join(',');
  });
  const s=sched();
  const csv=[head.map(q).join(',')].concat(body).join('\r\n');
  const url=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');
  a.href=url;
  a.download=('schedule-'+(s?s.project+'-'+s.name:'plan')+'-'+d2s(dd)+'.csv').replace(/[^\w.\-]+/g,'_');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
  toast('CSV downloaded','ok');
};

})();
