/* ============================ LEGAL MIS - RESHAPED (29 Oct 2026) ============================
   As asked by Ayush. The table is in three sections - Case, Hearing, Action - and a case is opened
   on a page of its own (legal/mis/case/<id>), as are its hearings (legal/mis/hearing/<id>) and its
   actions (legal/mis/action/<id>); each is a real address, so Back returns to the table.

   HEARINGS (public.mis_hearings): every date the case is before the court, newest first, each with
   its stage, person and remarks. A new hearing can never be dated in the past; an earlier one can
   be corrected. The newest date is the case's Hearing Date.
   ACTIONS (public.mis_case_actions): what this office has to do and by when. Each is an
   Accountability task for the person it is given to - the task's due date IS the Action Date and
   the task being completed IS the action being done - so changing either side changes both. One
   action is open at a time; the next is added at the top once the current one is completed.
   SCORE: an action scores when its task is completed, against its date - late -1, on the day or one
   day before 0, earlier +1, seven or more days early +2 (only when it was given seven days).
   Everything here reads MIST(), so a copy running on localhost uses the *_test tables. */

/* THE STAGES, as Legal gave them (2 Nov 2026): a primary stage, the stage under it, and - for a disposal on
   merit - Win or Loss. Offered in ONE dropdown, each written out in full the way Case Type reads
   ("DISMISS - DISPOSED OF ON MERIT - WIN"), in Legal's order (LM_STAGES below). */
const LM_STAGE_TREE=[
  ['FILING',[['STATEMENT OF CLAIM']]],
  ['CONDONATION HEARING',[]],
  ['APPEARANCE',[['VAKALATNAMA FILED']]],
  ['SR-AD/ MOTION OF SERVICE',[['PAPER PUBLICATION'],['RE-SERVICING']]],
  ['WRITTEN STATEMENT/ OBJECTION/ VERSION',[['WRITTEN OBJECTION'],['WRITTEN STATEMENT'],['WRITTEN VERSION'],['STATEMENT OF DEFENCE'],['REJOINDER/REPLICATION'],['ACCEPTANCE OF WS/WO']]],
  ['DOCUMENT SCRUTINIZATION',[]],
  ['FRAMING OF ISSUES',[]],
  ['HEARING',[['IA/MA HEARING'],['EA HEARING'],['INJUNCTION HEARING'],['PETITION HEARING'],['ADMISSION HEARING'],['PRE-COGNIZANCE HEARING']]],
  ['CHARGE/ PLEA',[]],
  ['EVIDENCE',[['P.H./ EVIDENCE BY COMPLAINANT'],['EX-PARTE HEARING'],['EVIDENCE BY DEFENCE'],['EXAMINATION-IN-CHIEF'],['CROSS EXAMINATION'],['313 Cr PC']]],
  ['QUESTIONNAIRE',[['QUESTIONNAIRE BY US'],['REPLY TO QUESTIONNAIRE BY US'],['QUESTIONNAIRE BY OP'],['REPLY TO QUESTIONNAIRE BY OP']]],
  ['ARGUMENT',[['FINAL HEARING'],['FILING BNA'],['BNA BY OP']]],
  ['MEDIATION/SETTLEMENT',[['PRE-INST MEDIATION']]],
  ['ORDER/JUDGMENT',[['ORDER RESERVED'],['ORDER PASSED/ FINAL MINUTES OF HEARING'],['JUDGMENT RESERVED'],['JUDGMENT PASSED']]],
  ['COMPLIANCE OF ORDER',[['BY US'],['BY OP']]],
  ['DISMISS',[['DISPOSED OF ON MERIT',['WIN','LOSS']],['WITHDRAWN'],['DISMISSED FOR DEFAULT']]],
  ['APPEAL/ REVISION/ REVIEW',[]]
];
const LM_STAGES=[];
LM_STAGE_TREE.forEach(p=>{ LM_STAGES.push(p[0]); p[1].forEach(s=>{ LM_STAGES.push(p[0]+' - '+s[0]); (s[1]||[]).forEach(t=>LM_STAGES.push(p[0]+' - '+s[0]+' - '+t)); }); });
const LM_NEAR_DAYS=7;   // a hearing or open action within this many days makes the case "coming up"
const LM_COLS=[
  {k:'title',   l:'Case Title',    sec:'case',    w:300},
  {k:'type',    l:'Case Type',     sec:'case',    w:170},
  {k:'court',   l:'Court Name',    sec:'case',    w:210},
  {k:'hearing', l:'Hearing Date',  sec:'hearing', w:128},
  {k:'location',l:'Location',      sec:'hearing', w:140},
  {k:'cnr',     l:'CNR No.',       sec:'hearing', w:170},
  {k:'incharge',l:'Incharge',      sec:'hearing', w:140},
  {k:'advocate',l:'Advocate',      sec:'hearing', w:160},
  {k:'action',  l:'Action',        sec:'action',  w:280}
];
// Each column can be dragged wider or narrower at its own header edge, within these limits (px).
const LM_COL_MIN=80, LM_COL_MAX=520;
const LM={rows:[],hearings:{},actions:{},tasks:{},comments:{},types:[],courts:[],advocates:[],people:[],
  sel:new Set(),typeFilter:'',docCounts:{},docFolders:{},docVault:{}};

/* ---------------------------------------------------------------- small helpers */
function lmIso(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function lmToday(){ return lmIso(new Date()); }
function lmAddDays(iso,n){ const d=new Date(iso+'T12:00:00'); d.setDate(d.getDate()+n); return lmIso(d); }
function lmDiff(a,b){ return Math.round((new Date(a+'T12:00:00')-new Date(b+'T12:00:00'))/86400000); }
function lmDmy(iso){ if(!iso) return ''; const s=String(iso).slice(0,10).split('-'); return s.length===3?s[2]+'/'+s[1]+'/'+s[0]:String(iso); }
function lmName(e){ if(!e) return '—'; const p=(LM.people||[]).find(x=>String(x.email).toLowerCase()===String(e).toLowerCase()); return p?p.name:(String(e).indexOf('@')>0?String(e).split('@')[0]:String(e)); }
function lmTaskDone(t){ return !!(t&&t.completed_at&&t.status!=='Pending'); }
// The score an action earns, the same rule the database uses (legal_mis_action_points).
function lmPoints(actionDate,created,done){
  if(!done||!actionDate) return null;
  if(done>actionDate) return -1;
  const early=lmDiff(actionDate,done);
  if(early<=1) return 0;
  if(early>=7 && lmDiff(actionDate,created)>=7) return 2;
  return 1;
}
function lmPtsChip(p){
  if(p===null||p===undefined) return '';
  const c=p>0?['#dcfce7','#166534']:(p<0?['#fee2e2','#991b1b']:['#f1f5f9','#475569']);
  return '<span class="lm-pts" style="background:'+c[0]+';color:'+c[1]+'">'+(p>0?'+':'')+p+'</span>';
}
function lmLegalPeople(){ return (LM.people||[]).filter(p=>Array.isArray(p.depts)&&p.depts.indexOf('Legal')!==-1).sort((a,b)=>String(a.name).localeCompare(String(b.name))); }
function lmActionPeople(){ return (LM.people||[]).filter(p=>Array.isArray(p.depts)&&(p.depts.indexOf('Legal')!==-1||p.depts.indexOf('Administration')!==-1)).sort((a,b)=>String(a.name).localeCompare(String(b.name))); }
// A case's hearings newest first, its actions newest first, and what that makes its current state.
function lmCaseState(r){
  const hs=LM.hearings[r.id]||[], as=LM.actions[r.id]||[];
  const cur=as[0]||null, t=cur?LM.tasks[cur.task_id]:null;
  const hearing=(hs[0]&&hs[0].hearing_date)||(r.case_next_date_iso?String(r.case_next_date_iso).slice(0,10):null);
  const adate=cur?(String((t&&t.due_date)||cur.action_date).slice(0,10)):null;
  return {hs,as,cur,task:t,hearing,adate,open:!!(cur&&t&&!t.completed_at),done:!!(cur&&lmTaskDone(t)),
    legacyAdate:(!cur&&r.next_date_iso)?String(r.next_date_iso).slice(0,10):null};
}

/* ---------------------------------------------------------------- loading */
async function lmLoadLists(){
  const [ty,co,ad]=await Promise.all([
    sb.from('mis_case_types').select('name,sort').order('sort',{ascending:true,nullsFirst:false}).order('name'),
    sb.from('mis_courts').select('name').order('name'),
    sb.from('legal_advocates').select('advocate_name,active').order('advocate_name')
  ]);
  LM.types=((ty&&ty.data)||[]).map(x=>x.name);
  LM.courts=((co&&co.data)||[]).map(x=>x.name);
  const seen=new Set(); LM.advocates=[];
  ((ad&&ad.data)||[]).forEach(a=>{ const n=String(a.advocate_name||'').trim(); if(n&&a.active!==false&&!seen.has(n.toLowerCase())){ seen.add(n.toLowerCase()); LM.advocates.push(n); } });
  try{ LM.people=await getPeople(); }catch(e){ LM.people=[]; }
}
async function lmLoadAll(onlyCase){
  const qc=sb.from(MIST('mis_cases')).select('*'), qh=sb.from(MIST('mis_hearings')).select('*'), qa=sb.from(MIST('mis_case_actions')).select('*');
  const [c,h,a]=await Promise.all([
    onlyCase?qc.eq('id',onlyCase):qc.order('id',{ascending:true}),
    (onlyCase?qh.eq('case_id',onlyCase):qh).order('hearing_date',{ascending:false}).order('id',{ascending:false}),
    (onlyCase?qa.eq('case_id',onlyCase):qa).order('created_at',{ascending:false})
  ]);
  if(c.error) throw c.error;
  const rows=c.data||[];
  const hearings={}, actions={};
  (h.data||[]).forEach(x=>{ (hearings[x.case_id]=hearings[x.case_id]||[]).push(x); });
  (a.data||[]).forEach(x=>{ (actions[x.case_id]=actions[x.case_id]||[]).push(x); });
  const ids=(a.data||[]).map(x=>x.task_id).filter(Boolean);
  const tasks={}, comments={};
  if(ids.length){
    const [t,cm]=await Promise.all([
      sb.schema('acc').from('ptasks').select('id,status,completed_at,due_date,title').in('id',ids),
      sb.schema('acc').from('ptask_comments').select('task_id,author,body,created_at,system').in('task_id',ids).order('created_at',{ascending:true})
    ]);
    ((t&&t.data)||[]).forEach(x=>{ tasks[x.id]=x; });
    ((cm&&cm.data)||[]).forEach(x=>{ if(!x.system&&String(x.body||'').trim()) (comments[x.task_id]=comments[x.task_id]||[]).push(x); });
  }
  if(onlyCase){
    LM.rows=(LM.rows||[]).filter(r=>r.id!==onlyCase).concat(rows);
    Object.assign(LM.hearings,{[onlyCase]:hearings[onlyCase]||[]});
    Object.assign(LM.actions,{[onlyCase]:actions[onlyCase]||[]});
    Object.assign(LM.tasks,tasks); Object.assign(LM.comments,comments);
  } else { LM.rows=rows; LM.hearings=hearings; LM.actions=actions; LM.tasks=tasks; LM.comments=comments; }
  return rows;
}
async function lmLoadDocs(caseId){
  const qf=sb.from(MIST('mis_case_folders')).select('*');
  const {data:fo}=await (caseId?qf.eq('case_id',caseId):qf);
  const folders=fo||[];
  let files=[];
  if(folders.length){
    const {data:fi}=await sb.from(MIST('mis_case_files')).select('*').in('folder_id',folders.map(f=>f.id)).order('file_name',{ascending:true});
    files=fi||[];
  }
  return {folders,files};
}

/* ---------------------------------------------------------------- shared look */
function lmStyles(){
  if(document.getElementById('lmStyles')) return;
  const st=document.createElement('style'); st.id='lmStyles';
  st.textContent=`
  .lm-bar{position:sticky;top:0;z-index:40;background:var(--bg,#f5f7fb);padding:2px 0 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .lm-bar .lm-left{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .lm-bar .lm-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto}
  .lm-btn{height:36px;padding:0 13px;display:inline-flex;align-items:center;gap:7px;border-radius:9px;font:600 13px/1 inherit;
    font-family:inherit;border:1px solid var(--line);background:var(--bg-card,#fff);color:var(--ink);cursor:pointer;white-space:nowrap}
  .lm-btn:hover:not(:disabled){border-color:var(--slate)}
  .lm-btn:disabled{cursor:not-allowed;color:var(--slate);border-style:dashed;background:var(--bg-subtle,#f8fafc)}
  .lm-btn.primary{background:var(--brand,#1d4ed8);border-color:var(--brand,#1d4ed8);color:#fff}
  .lm-btn.danger:not(:disabled){color:#b91c1c;border-color:#fecaca}
  .lm-sel{height:36px;padding:0 30px 0 11px;border:1px solid var(--line);border-radius:9px;font:600 13px inherit;font-family:inherit;
    background:var(--bg-card,#fff) url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2364748b' stroke-width='1.8' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 10px center/11px 8px;
    -webkit-appearance:none;appearance:none;color:var(--ink);cursor:pointer;max-width:240px}
  .lm-search{position:relative;width:280px;max-width:100%}
  .lm-search i{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--slate);font-size:13px}
  .lm-search input{width:100%;height:36px;padding:0 10px 0 32px;border:1px solid var(--line);border-radius:9px;font:13px inherit;font-family:inherit;background:var(--bg-card,#fff)}
  .lm-count{font-size:12.5px;color:var(--slate);padding:0 4px}
  .lm-test{font-size:11px;font-weight:700;letter-spacing:.04em;padding:4px 9px;border-radius:20px;background:#fef3c7;color:#92400e;border:1px solid #fde68a}
  .lm-wrap{background:var(--bg-card,#fff);border:1px solid var(--line);border-radius:12px;overflow:auto;max-height:calc(100vh - 250px)}
  #lmTbl{border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:13px;width:max-content;min-width:100%}
  #lmTbl th{position:sticky;background:var(--bg-subtle,#f8fafc);z-index:5;text-align:left;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--slate);padding:9px 11px;border-bottom:1px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #lmTbl tr.lm-colrow th{top:0;position:sticky}
  #lmTbl th .lm-rz{position:absolute;right:0;top:0;bottom:0;width:9px;cursor:col-resize;border-right:2px solid var(--line)}
  #lmTbl th .lm-rz:hover,#lmTbl th .lm-rz.on{background:var(--brand-a10,#dbe4ff)}
  #lmTbl td{padding:10px 11px;border-bottom:1px solid var(--line-2,#eef1f6);vertical-align:top;overflow:hidden}
  /* Files: pinned to the right edge however far the table is scrolled, as on the live MIS. */
  #lmTbl th.lm-upth,#lmTbl td.lm-upcell{position:sticky;right:0;text-align:center;box-shadow:-6px 0 8px -6px rgba(15,23,42,.22)}
  #lmTbl th.lm-upth{z-index:7}
  #lmTbl td.lm-upcell{z-index:2;background:var(--bg-card,#fff)}
  #lmTbl tr.lm-on td.lm-upcell{background:inherit}
  .lm-upbtn{position:relative;width:38px;height:32px;border-radius:9px;border:1px solid var(--line);background:#fff;color:var(--slate);cursor:pointer}
  .lm-upbtn:hover{border-color:#7c3aed;color:#7c3aed}
  .lm-upbtn.has{color:#2563eb;border-color:#bfdbfe;background:#eff6ff}
  .lm-upbtn .n{position:absolute;top:-7px;right:-7px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:#2563eb;color:#fff;font-size:10px;font-weight:700;line-height:17px}
  #lmTbl tbody tr{cursor:pointer;transition:background .1s}
  #lmTbl tbody tr:hover td{background:var(--bg-hover,#f8fafc)}
  #lmTbl tbody tr.lm-on td{background:#eff6ff}
  #lmTbl td.lm-first{border-left:3px solid transparent;white-space:nowrap}
  #lmTbl tr.lm-near td.lm-first{border-left-color:#1e3a8a}
  #lmTbl tr.lm-disposed td{opacity:.45;filter:grayscale(.6)}
  #lmTbl tr.lm-group td{background:var(--bg-subtle,#f8fafc);cursor:default;padding:7px 12px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--slate)}
  #lmTbl tr.lm-dragging td{background:#eef2ff;box-shadow:inset 0 0 0 1px #c7d2fe}
  .lm-grip{color:var(--slate-2,#94a3b8);margin-left:9px;cursor:grab;touch-action:none;padding:2px}
  .lm-grip:hover{color:var(--brand,#1d4ed8)}
  .lm-cb{width:16px;height:16px;accent-color:var(--brand,#1d4ed8);cursor:pointer;vertical-align:middle}
  .lm-t1{font-weight:650;color:var(--ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
  .lm-t2{font-size:11.5px;color:var(--slate);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lm-cell{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;color:var(--ink-2,#334155)}
  .lm-mute{color:var(--slate-2,#94a3b8)}
  .lm-datebtn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--line);background:#fff;font:600 12.5px inherit;font-family:inherit;color:var(--ink);cursor:pointer;white-space:nowrap}
  .lm-datebtn.h{border-color:var(--line);background:#fff;color:var(--ink)}
  .lm-datebtn.h i{color:#8b5cf6}
  .lm-datebtn.a{border-color:#fde68a;background:#fffbeb;color:#92400e}
  .lm-datebtn.done{border-color:#bbf7d0;background:#f0fdf4;color:#166534}
  .lm-datebtn.none{border-style:dashed;color:var(--slate);background:#fff;font-weight:500}
  .lm-acell{cursor:pointer;border-radius:8px;margin:-4px -6px;padding:4px 6px}
  .lm-acell:hover{background:#fff7ed}
  .lm-brief{margin:-6px 0 16px;padding:11px 14px;border:1px solid var(--line);border-radius:11px;background:#fff;font-size:13.5px;line-height:1.55;color:var(--ink-2,#334155)}
  .lm-brief b{display:block;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--slate);margin-bottom:3px}
  .lm-datebtn:hover{filter:brightness(.97)}
  .lm-pts{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:20px;padding:0 6px;border-radius:20px;font-size:11px;font-weight:800}
  /* pages */
  .lm-page{max-width:1080px;margin:0 auto;padding-bottom:90px}
  .lm-phead{display:flex;align-items:center;gap:14px;margin:0 0 18px;flex-wrap:wrap}
  .lm-back{height:34px;padding:0 12px;border-radius:9px;border:1px solid var(--line);background:#fff;font:600 13px inherit;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:7px;color:var(--ink)}
  .lm-back:hover{border-color:var(--slate)}
  .lm-ptitle{font-size:19px;font-weight:750;color:var(--ink);line-height:1.3;flex:1;min-width:220px}
  .lm-psub{font-size:12.5px;color:var(--slate);font-weight:500;margin-top:3px}
  .lm-card{background:var(--bg-card,#fff);border:1px solid var(--line);border-radius:14px;margin-bottom:16px;overflow:visible}
  .lm-chead{display:flex;align-items:center;gap:11px;padding:14px 18px;border-bottom:1px solid var(--line)}
  .lm-cnum{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:#fff;flex:none}
  .lm-ctitle{font-weight:700;font-size:14.5px;color:var(--ink)}
  .lm-cnote{font-size:12px;color:var(--slate);margin-left:auto}
  .lm-cbody{padding:16px 18px}
  .lm-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 18px}
  .lm-grid .full{grid-column:1/-1}
  @media(max-width:720px){ .lm-grid{grid-template-columns:1fr} }
  .lm-f label{display:block;font-size:11.5px;font-weight:700;letter-spacing:.03em;color:var(--slate);margin:0 0 6px;text-transform:uppercase}
  .lm-f label .rq{color:#dc2626;margin-left:3px}
  .lm-f label .op{color:var(--slate-2,#94a3b8);font-weight:500;text-transform:none;letter-spacing:0;margin-left:5px}
  .lm-in{width:100%;box-sizing:border-box;height:40px;padding:0 12px;border:1px solid var(--line);border-radius:9px;font:14px inherit;font-family:inherit;background:#fff;color:var(--ink)}
  textarea.lm-in{height:auto;min-height:84px;padding:10px 12px;resize:vertical;line-height:1.5}
  select.lm-in{-webkit-appearance:none;appearance:none;padding-right:32px;cursor:pointer;
    background:#fff url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2364748b' stroke-width='1.8' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 12px center/11px 8px}
  .lm-in:focus{outline:none;border-color:var(--brand,#1d4ed8);box-shadow:0 0 0 3px var(--brand-a10,#e0e7ff)}
  .lm-in.lm-bad{border-color:#f87171;box-shadow:0 0 0 3px #fee2e2}
  .lm-in.lm-date{cursor:pointer;background:#fff url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='2' y='3' width='12' height='11' rx='2' fill='none' stroke='%2364748b' stroke-width='1.4'/%3E%3Cpath d='M2 6.5h12M5 1.5v3M11 1.5v3' stroke='%2364748b' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 12px center/15px 15px}
  .lm-ro{min-height:40px;padding:9px 12px;border:1px solid var(--line);border-radius:9px;background:var(--bg-subtle,#f8fafc);font-size:14px;box-sizing:border-box}
  .lm-combo{position:relative}
  .lm-combo-list{display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:90;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 30px rgba(15,23,42,.16);max-height:230px;overflow:auto;padding:5px}
  .lm-combo.open .lm-combo-list{display:block}
  .lm-combo-opt{padding:8px 10px;border-radius:7px;font-size:13px;cursor:pointer}
  .lm-combo-opt:hover{background:var(--brand-a10,#eef2ff);color:var(--brand,#1d4ed8)}
  .lm-combo-new{padding:8px 10px;font-size:12px;color:var(--slate)}
  .lm-pp{position:relative}
  .lm-pp-btn{display:flex;align-items:center;gap:9px;text-align:left;cursor:pointer}
  .lm-pp-btn .avatar-sm{width:24px;height:24px;font-size:10px;flex:none}
  .lm-pp-btn .lm-pp-nm{font-weight:600;font-size:14px;color:var(--ink);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .lm-pp-ph{flex:1;color:var(--slate-2,#94a3b8);font-size:14px}
  .lm-pp-caret{font-size:10px;color:var(--slate);margin-left:auto}
  .lm-pp-list{display:none;position:absolute;top:calc(100% + 5px);left:0;right:0;min-width:260px;z-index:95;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 14px 34px rgba(15,23,42,.18);overflow:hidden}
  .lm-pp.open .lm-pp-list{display:block}
  .lm-pp-qw{position:relative;padding:8px;border-bottom:1px solid var(--line)}
  .lm-pp-qw i{position:absolute;left:19px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--slate)}
  .lm-pp-q{width:100%;box-sizing:border-box;height:34px;padding:0 10px 0 30px;border:1px solid var(--line);border-radius:8px;font:13px inherit;font-family:inherit}
  .lm-pp-q:focus{outline:none;border-color:var(--brand,#1d4ed8)}
  .lm-pp-opts{max-height:260px;overflow:auto;padding:5px}
  .lm-pp-opt{display:flex;align-items:center;gap:10px;padding:7px 9px;border-radius:8px;cursor:pointer}
  .lm-pp-opt:hover{background:var(--bg-hover,#f1f5f9)}
  .lm-pp-opt.on{background:var(--brand-a10,#eef2ff)}
  .lm-pp-opt .avatar-sm{width:30px;height:30px;font-size:11px;flex:none}
  .lm-pp-txt{display:flex;flex-direction:column;min-width:0;flex:1}
  .lm-pp-txt .lm-pp-nm{font-weight:600;font-size:13.5px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lm-pp-em{font-size:11.5px;color:var(--slate);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lm-pp-tick{color:var(--brand,#1d4ed8);font-size:12px}
  .lm-pp-none{padding:12px;font-size:12.5px;color:var(--slate)}
  .lm-foot{position:sticky;bottom:0;z-index:30;display:flex;align-items:center;gap:12px;justify-content:flex-end;padding:12px 0;background:linear-gradient(to top,var(--bg,#f5f7fb) 70%,transparent)}
  .lm-foot .lm-miss{margin-right:auto;font-size:12.5px;color:#b91c1c}
  .lm-hcard{border:1px solid var(--line);border-left:3px solid #a78bfa;border-radius:12px;padding:13px 15px;margin-bottom:10px;background:#fff}
  .lm-hcard.new{border:1px dashed #cbd5e1;border-left:3px solid #a78bfa;background:var(--bg-subtle,#f8fafc)}
  /* The newest hearing / the current action, and the box for adding the next one, stand out in a deeper
     shade - purple for hearings, blue for actions - so the one that matters now is seen first. */
  .lm-hcard.new,.lm-hcard.lm-cur{border-color:#a78bfa;border-left:5px solid #5b21b6;background:#ede9fe}
  .lm-hcard.new{border-style:dashed;border-left-style:solid}
  .lm-acard.lm-cur,.lm-acard.lm-anew{border-color:#93c5fd;border-left:5px solid #1e3a8a;background:#dbeafe}
  .lm-hcard2{display:flex;gap:14px;align-items:flex-start}
  .lm-hcard2.past{background:#fcfcfd}
  .lm-hcal{flex:none;width:56px;border:1px solid var(--line);border-radius:10px;overflow:hidden;text-align:center;background:#fff}
  .lm-hcal .m{display:block;background:#ede9fe;color:#6d28d9;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:3px 0}
  .lm-hcal .d{display:block;font-size:20px;font-weight:800;color:var(--ink);line-height:1.15;padding-top:3px}
  .lm-hcal .y{display:block;font-size:10.5px;color:var(--slate);padding-bottom:4px}
  .lm-hbody{flex:1;min-width:0}
  .lm-hwho{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px;color:var(--ink)}
  .lm-hwho .avatar-sm{width:24px;height:24px;font-size:10px}
  .lm-hwho-l{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--slate);margin-right:2px}
  .lm-hrow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .lm-hdate{font-weight:750;font-size:15px;color:var(--ink)}
  .lm-stage{font-size:11.5px;font-weight:650;padding:3px 10px;border-radius:20px;background:#f1f5f9;color:#334155;border:1px solid var(--line)}
  .lm-hmeta{font-size:12.5px;color:var(--slate)}
  .lm-hrem{font-size:13.5px;color:var(--ink);margin-top:8px;line-height:1.55;white-space:pre-wrap}
  .lm-acard{border:1px solid var(--line);border-left:5px solid #f59e0b;border-radius:12px;padding:13px 15px;margin-bottom:11px;background:#fff}
  .lm-acard.done{border-left-color:#16a34a}
  .lm-acard .lm-atext{font-weight:700;font-size:14.5px;color:var(--ink)}
  .lm-status{font-size:11.5px;font-weight:700;padding:3px 10px;border-radius:20px}
  .lm-status.p{background:#fef3c7;color:#92400e}
  .lm-status.c{background:#dcfce7;color:#166534}
  /* Add action: a real button (it read as plain text before), in the actions' dark blue. */
  .lm-addbar{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 18px;border:0;border-radius:10px;color:#fff;font-weight:650;font-size:13px;cursor:pointer;margin-bottom:12px;background:#1e3a8a;box-shadow:0 1px 2px rgba(15,23,42,.15)}
  .lm-addbar:hover{background:#1e40af}
  .lm-addbar.off{background:#e2e8f0;color:var(--slate);cursor:not-allowed;box-shadow:none}
  .lm-addact{height:28px;padding:0 11px;font-size:12px}
  .lm-files{border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .lm-file{display:flex;align-items:center;gap:10px;padding:9px 12px;border-top:1px solid var(--line);font-size:13px}
  .lm-file:first-child{border-top:0}
  .lm-file .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
  .lm-file .nm:hover{color:var(--brand,#1d4ed8);text-decoration:underline}
  .lm-file .sz{font-size:11.5px;color:var(--slate)}
  .lm-file .x{border:0;background:transparent;color:var(--slate);cursor:pointer;font-size:13px;padding:4px}
  .lm-file .x:hover{color:#dc2626}
  .lm-path{font-size:12.5px;color:var(--slate);margin-bottom:10px}
  .lm-path b{color:#1e3a8a}
  .lm-empty{padding:18px;border:1px dashed var(--line);border-radius:10px;text-align:center;color:var(--slate);font-size:13px}
  /* folder picker */
  .lm-fp-crumb{display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:13px;margin-bottom:10px}
  .lm-fp-crumb a{color:var(--brand,#1d4ed8);cursor:pointer;font-weight:600}
  .lm-fp-list{border:1px solid var(--line);border-radius:10px;max-height:280px;overflow:auto}
  .lm-fp-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-top:1px solid var(--line);cursor:pointer;font-size:13.5px}
  .lm-fp-item:first-child{border-top:0}
  .lm-fp-item:hover{background:#f5f8ff}
  .lm-fp-item i{color:#f59e0b}
  /* date picker - the Accountability one, without the repeat rail */
  .lm-dp{position:fixed;z-index:2000;width:300px;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 30px rgba(16,24,40,.18);overflow:hidden;font-family:inherit}
  .lm-dp-main{padding:10px 12px 12px}
  .lm-dp-head{display:flex;align-items:center;gap:2px;margin-bottom:4px}
  .lm-dp-title{flex:1;text-align:center;font-size:12.5px;font-weight:700}
  .lm-dp-nav{width:25px;height:25px;border:0;border-radius:7px;background:transparent;color:var(--slate);cursor:pointer;font-size:11px}
  .lm-dp-nav:hover{background:var(--brand-a10,#eef2ff);color:var(--brand,#1d4ed8)}
  .lm-dp-dow,.lm-dp-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px}
  .lm-dp-dow span{text-align:center;font-size:10px;font-weight:700;color:var(--slate-2,#94a3b8);padding-bottom:2px}
  .lm-dp-day{height:30px;border:0;border-radius:7px;background:transparent;font:12.5px inherit;font-family:inherit;font-variant-numeric:tabular-nums;color:var(--ink);cursor:pointer;position:relative;padding:0}
  .lm-dp-day:hover:not([disabled]):not(.on){background:var(--brand-a10,#eef2ff)}
  .lm-dp-day.pad{opacity:.35}
  .lm-dp-day[disabled]{opacity:.28;cursor:default}
  .lm-dp-day.on{background:var(--brand,#1d4ed8);color:#fff;font-weight:700}
  .lm-dp-day.today:not(.on)::after{content:'';position:absolute;left:50%;bottom:4px;width:3px;height:3px;margin-left:-1.5px;border-radius:50%;background:var(--brand,#1d4ed8)}
  .lm-dp-quick{display:flex;gap:4px;margin-top:7px}
  .lm-dp-quick button{flex:1;height:26px;border:1px solid var(--line);border-radius:7px;background:#fff;font:500 11.5px inherit;font-family:inherit;color:var(--slate);cursor:pointer}
  .lm-dp-quick button:hover:not([disabled]){border-color:var(--brand,#1d4ed8);color:var(--brand,#1d4ed8)}
  .lm-dp-quick button[disabled]{opacity:.35;cursor:default}
  .lm-dp-says{border-top:1px solid var(--line);background:#f8fafc;padding:9px 12px;font-size:11.5px;color:var(--slate)}
  .lm-dp-says b{color:var(--ink)}
  .lm-dp-foot{display:flex;align-items:center;gap:10px;border-top:1px solid var(--line);padding:9px 12px}
  .lm-dp-clear{border:0;background:transparent;font:12px inherit;font-family:inherit;color:var(--slate);cursor:pointer}
  .lm-dp-done{margin-left:auto;height:31px;padding:0 17px;border:0;border-radius:8px;background:var(--brand,#1d4ed8);color:#fff;font:600 12px inherit;font-family:inherit;cursor:pointer}
  `;
  document.head.appendChild(st);
}

/* ---------------------------------------------------------------- date picker */
window.lmPickDate=function(inp){
  document.querySelectorAll('.lm-dp').forEach(x=>x.remove());
  const min=inp.dataset.min||'';
  let sel=inp.dataset.iso||'';
  const base=new Date((sel||min||lmToday())+'T12:00:00');
  let y=base.getFullYear(), m=base.getMonth();
  const pop=document.createElement('div'); pop.className='lm-dp';
  const MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const draw=function(){
    const first=new Date(y,m,1), start=(first.getDay()+6)%7, days=new Date(y,m+1,0).getDate(), today=lmToday();
    let g='';
    for(let i=0;i<start;i++){ const d=new Date(y,m,1-start+i); g+='<button class="lm-dp-day pad" disabled>'+d.getDate()+'</button>'; }
    for(let d=1;d<=days;d++){
      const iso=lmIso(new Date(y,m,d)), off=min&&iso<min;
      g+='<button class="lm-dp-day'+(iso===sel?' on':'')+(iso===today?' today':'')+'" data-d="'+iso+'"'+(off?' disabled':'')+'>'+d+'</button>';
    }
    const q=function(lbl,iso){ return '<button data-d="'+iso+'"'+(min&&iso<min?' disabled':'')+'>'+lbl+'</button>'; };
    pop.innerHTML='<div class="lm-dp-main"><div class="lm-dp-head"><button class="lm-dp-nav" data-nav="-1"><i class="fa-solid fa-chevron-left"></i></button>'
      +'<div class="lm-dp-title">'+MON[m]+' '+y+'</div><button class="lm-dp-nav" data-nav="1"><i class="fa-solid fa-chevron-right"></i></button></div>'
      +'<div class="lm-dp-dow"><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span></div>'
      +'<div class="lm-dp-grid">'+g+'</div>'
      +'<div class="lm-dp-quick">'+q('Today',today)+q('Tomorrow',lmAddDays(today,1))+q('In a week',lmAddDays(today,7))+'</div></div>'
      +'<div class="lm-dp-says">'+(sel?'<b>'+new Date(sel+'T12:00:00').toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})+'</b>':'Pick a date')
      +(min?'<div>'+(min===today?'Not before today':'Not before '+lmDmy(min))+'</div>':'')+'</div>'
      +'<div class="lm-dp-foot"><button class="lm-dp-clear">Clear</button><button class="lm-dp-done"'+(sel?'':' disabled style="opacity:.45"')+'>Done</button></div>';
  };
  const close=function(){ pop.remove(); document.removeEventListener('mousedown',outside,true); };
  const outside=function(e){ if(!pop.contains(e.target)&&e.target!==inp) close(); };
  pop.addEventListener('click',function(e){
    const b=e.target.closest('button'); if(!b||b.disabled) return;
    e.preventDefault();
    if(b.dataset.nav){ m+=Number(b.dataset.nav); if(m<0){m=11;y--;} if(m>11){m=0;y++;} draw(); return; }
    if(b.dataset.d){ sel=b.dataset.d; const d=new Date(sel+'T12:00:00'); y=d.getFullYear(); m=d.getMonth(); draw(); return; }
    if(b.classList.contains('lm-dp-clear')){ inp.dataset.iso=''; inp.value=''; inp.dispatchEvent(new Event('change')); close(); return; }
    if(b.classList.contains('lm-dp-done')&&sel){ inp.dataset.iso=sel; inp.value=lmDmy(sel); inp.classList.remove('lm-bad'); inp.dispatchEvent(new Event('change')); close(); }
  });
  draw(); document.body.appendChild(pop);
  const r=inp.getBoundingClientRect(), h=pop.offsetHeight;
  pop.style.left=Math.max(8,Math.min(r.left,window.innerWidth-308))+'px';
  pop.style.top=((r.bottom+6+h>window.innerHeight)?Math.max(8,r.top-h-6):(r.bottom+6))+'px';
  setTimeout(()=>document.addEventListener('mousedown',outside,true),0);
};
function lmDateInput(id,iso,opt){
  opt=opt||{};
  return '<input id="'+id+'" class="lm-in lm-date" readonly placeholder="dd/mm/yyyy" value="'+esc(lmDmy(iso))+'" data-iso="'+esc(iso||'')+'"'
    +(opt.min?' data-min="'+esc(opt.min)+'"':'')+' onclick="lmPickDate(this)">';
}
function lmVal(id){ const e=$(id); if(!e) return ''; if(e.classList.contains('lm-date')) return e.dataset.iso||''; return String(e.value||'').trim(); }

/* ---------------------------------------------------------------- dropdown that remembers new values */
function lmCombo(id,val,list,ph){
  return '<div class="lm-combo" id="'+id+'_box"><input id="'+id+'" class="lm-in" autocomplete="off" value="'+esc(val||'')+'" placeholder="'+esc(ph||'Choose or type')+'"'
    +' onfocus="lmComboOpen(\''+id+'\')" oninput="lmComboOpen(\''+id+'\')">'
    +'<div class="lm-combo-list">'+list.map(x=>'<div class="lm-combo-opt" data-v="'+esc(x)+'" onmousedown="lmComboPick(\''+id+'\',this)">'+esc(x)+'</div>').join('')
    +'<div class="lm-combo-new" style="display:none">New - it will be added to the list when you save</div></div></div>';
}
window.lmComboOpen=function(id){
  const box=$(id+'_box'), inp=$(id); if(!box||!inp) return;
  document.querySelectorAll('.lm-combo.open').forEach(x=>{ if(x!==box) x.classList.remove('open'); });
  box.classList.add('open');
  const q=inp.value.trim().toLowerCase(); let any=false, exact=false;
  box.querySelectorAll('.lm-combo-opt').forEach(o=>{ const v=o.dataset.v.toLowerCase(); const show=!q||v.indexOf(q)!==-1; o.style.display=show?'':'none'; if(show)any=true; if(v===q)exact=true; });
  const nw=box.querySelector('.lm-combo-new'); if(nw) nw.style.display=(q&&!exact)?'':'none';
};
window.lmComboPick=function(id,o){ const inp=$(id); if(inp){ inp.value=o.dataset.v; inp.classList.remove('lm-bad'); } const box=$(id+'_box'); if(box) box.classList.remove('open'); };
if(!window._lmComboWired){ window._lmComboWired=true;
  document.addEventListener('mousedown',function(e){ if(!(e.target.closest&&e.target.closest('.lm-combo,.lm-pp'))) document.querySelectorAll('.lm-combo.open,.lm-pp.open').forEach(x=>x.classList.remove('open')); });
}
/* PEOPLE, PICKED BY FACE. A list of names with their initials circle, a search box at the top, and
   the chosen person shown the same way on the closed field. byEmail: the value kept is the email
   (Action People, a hearing's Person); otherwise the name (Incharge, as cases have always stored it). */
function lmPeopleSelect(id,val,list,byEmail){
  const match=list.find(p=>byEmail?String(p.email).toLowerCase()===String(val||'').toLowerCase():p.name===val);
  const shownName=match?match.name:(val?(byEmail?lmName(val):val):'');
  window._lmPp=window._lmPp||{}; window._lmPp[id]={list,byEmail};
  return '<div class="lm-pp" id="'+id+'_box"><input type="hidden" id="'+id+'" data-pp="1" value="'+esc(val||'')+'">'
    +'<button type="button" class="lm-in lm-pp-btn" id="'+id+'_btn" onclick="lmPpOpen(\''+id+'\')">'+lmPpFace(shownName)+'</button>'
    +'<div class="lm-pp-list"><div class="lm-pp-qw"><i class="fa-solid fa-magnifying-glass"></i><input class="lm-pp-q" placeholder="Search people" oninput="lmPpFilter(\''+id+'\',this.value)"></div>'
    +'<div class="lm-pp-opts">'+list.map((p,i)=>'<div class="lm-pp-opt'+(match===p?' on':'')+'" data-i="'+i+'" data-k="'+esc((p.name+' '+p.email).toLowerCase())+'" onmousedown="lmPpPick(\''+id+'\','+i+')">'
      +avatar(p.name)+'<span class="lm-pp-txt"><span class="lm-pp-nm">'+esc(p.name)+'</span><span class="lm-pp-em">'+esc(p.email)+'</span></span>'
      +(match===p?'<i class="fa-solid fa-check lm-pp-tick"></i>':'')+'</div>').join('')
    +(list.length?'':'<div class="lm-pp-none">Nobody to choose yet</div>')+'</div></div></div>';
}
function lmPpFace(name){
  if(!name) return '<span class="lm-pp-ph">Choose a person</span><i class="fa-solid fa-chevron-down lm-pp-caret"></i>';
  return avatar(name)+'<span class="lm-pp-nm">'+esc(name)+'</span><i class="fa-solid fa-chevron-down lm-pp-caret"></i>';
}
window.lmPpOpen=function(id){
  const box=$(id+'_box'); if(!box) return;
  const was=box.classList.contains('open');
  document.querySelectorAll('.lm-pp.open,.lm-combo.open').forEach(x=>x.classList.remove('open'));
  if(was) return;
  box.classList.add('open');
  const q=box.querySelector('.lm-pp-q'); if(q){ q.value=''; lmPpFilter(id,''); setTimeout(()=>{ try{q.focus();}catch(e){} },0); }
};
window.lmPpFilter=function(id,q){
  const box=$(id+'_box'); if(!box) return; q=String(q||'').toLowerCase().trim();
  box.querySelectorAll('.lm-pp-opt').forEach(o=>{ o.style.display=(!q||o.dataset.k.indexOf(q)!==-1)?'':'none'; });
};
window.lmPpPick=function(id,i){
  const cfg=(window._lmPp||{})[id]; if(!cfg) return; const p=cfg.list[i]; if(!p) return;
  const inp=$(id); if(inp) inp.value=cfg.byEmail?p.email:p.name;
  const btn=$(id+'_btn'); if(btn){ btn.innerHTML=lmPpFace(p.name); btn.classList.remove('lm-bad'); }
  const box=$(id+'_box'); if(!box) return;
  box.classList.remove('open');
  box.querySelectorAll('.lm-pp-opt').forEach(o=>{ const on=Number(o.dataset.i)===i; o.classList.toggle('on',on);
    const t=o.querySelector('.lm-pp-tick'); if(t&&!on) t.remove(); if(on&&!t) o.insertAdjacentHTML('beforeend','<i class="fa-solid fa-check lm-pp-tick"></i>'); });
};
function lmListSelect(id,val,list){
  const has=list.indexOf(val)!==-1;
  return '<select id="'+id+'" class="lm-in"><option value="">Choose…</option>'+(!has&&val?'<option selected>'+esc(val)+'</option>':'')
    +list.map(x=>'<option'+(x===val?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select>';
}
function lmField(label,html,opt){
  opt=opt||{};
  return '<div class="lm-f'+(opt.full?' full':'')+'"><label>'+esc(label)+(opt.req?'<span class="rq">*</span>':'')+(opt.optional?'<span class="op">optional</span>':'')+'</label>'+html+'</div>';
}
function lmCard(n,title,color,body,note){
  return '<div class="lm-card"><div class="lm-chead"><div class="lm-cnum" style="background:'+color+'">'+n+'</div><div class="lm-ctitle">'+esc(title)+'</div>'
    +(note?'<div class="lm-cnote">'+note+'</div>':'')+'</div><div class="lm-cbody">'+body+'</div></div>';
}
// Fields left empty are outlined, the first is brought into view, and the caller is told which.
function lmRequire(ids){
  const miss=[];
  ids.forEach(function(p){ let e=$(p[0]); const v=lmVal(p[0]); if(e&&e.dataset&&e.dataset.pp) e=$(p[0]+'_btn'); if(e) e.classList.toggle('lm-bad',!v); if(!v) miss.push(p[1]); });
  if(miss.length){ const first=document.querySelector('.lm-bad'); if(first) first.scrollIntoView({block:'center',behavior:'smooth'}); }
  return miss;
}
async function lmRememberList(table,val){
  val=String(val||'').trim(); if(!val) return;
  const list=table==='mis_case_types'?LM.types:LM.courts;
  if(list.some(x=>x.toLowerCase()===val.toLowerCase())) return;
  try{ await sb.from(table).upsert({name:val},{onConflict:'name',ignoreDuplicates:true}); list.push(val); }catch(e){}
}
function lmBackBar(title,sub,extra){
  return '<div class="lm-phead"><button class="lm-back" onclick="lmGoBack()"><i class="fa-solid fa-arrow-left"></i> Back</button>'
    +'<div class="lm-ptitle">'+title+(sub?'<div class="lm-psub">'+sub+'</div>':'')+'</div>'+(extra||'')+'</div>';
}
// Back to wherever the page was opened from; a page opened on its own (a pasted link) goes to the table.
window.lmGoBack=function(){ if(window.history.length>1) history.back(); else navTo('legal/mis'); };

/* ---------------------------------------------------------------- THE TABLE */
function lmWidths(){
  let saved={}; try{ saved=JSON.parse(localStorage.getItem('lmColW:'+(state.email||''))||'{}')||{}; }catch(e){}
  return LM_COLS.map(c=>Math.min(LM_COL_MAX,Math.max(LM_COL_MIN,Number(saved[c.k])||c.w)));
}
function lmSaveWidth(k,w){
  try{ const key='lmColW:'+(state.email||''); const s=JSON.parse(localStorage.getItem(key)||'{}')||{}; s[k]=Math.round(w); localStorage.setItem(key,JSON.stringify(s)); }catch(e){}
}
function lmCellHtml(c,r,s){
  const mute='<span class="lm-mute">—</span>';
  switch(c.k){
    case 'title': return '<div class="lm-t1" title="'+esc(String(r.cause_title||'')+(r.case_brief?'\n\n'+r.case_brief:''))+'">'+esc(String(r.cause_title||'').replace(/\s+/g,' ').trim()||'Untitled case')+'</div>'
      +(r.case_no?'<div class="lm-t2" title="'+esc(r.case_no)+'">'+esc(r.case_no)+'</div>':'');
    case 'type': return r.case_type?'<div class="lm-cell" style="font-weight:600">'+esc(r.case_type)+'</div>':'<span class="lm-mute">Not set</span>';
    case 'court': return r.court?'<div class="lm-cell" title="'+esc(r.court)+'">'+esc(r.court)+'</div>':mute;
    case 'hearing': return '<button class="lm-datebtn '+(s.hearing?'h':'none')+'" onclick="event.stopPropagation();navTo(\'legal/mis/hearing/'+r.id+'\')" title="Hearing history">'
      +'<i class="fa-solid fa-gavel" style="font-size:10px"></i> '+(s.hearing?lmDmy(s.hearing):'Add')+'</button>';
    // Location IS the File No. - the rack and shelf the case's papers sit in (2 Nov 2026), as on the live MIS
    case 'location': { const f=lmFileNo(r.file_no); return f?'<div class="lm-cell"><i class="fa-solid fa-box-archive" style="color:#94a3b8;margin-right:5px"></i>'+esc(f)+'</div>':mute; }
    case 'cnr': return r.cnr_no?'<div class="lm-cell" style="white-space:nowrap">'+esc(r.cnr_no)+'</div>':mute;
    case 'incharge': return (r.pc_in_charge&&r.pc_in_charge!=='NA')?'<div class="lm-cell">'+esc(r.pc_in_charge)+'</div>':mute;
    case 'advocate': return r.advocate_incharge?'<div class="lm-cell">'+esc(r.advocate_incharge)+'</div>':mute;
    /* The action, and the way into its history: its wording, with its date and whether it is done
       underneath. Clicking it opens the case's Action page. */
    case 'action': {
      // Only actions given in this system - the old MIS's "action needed" text is not carried over (2 Nov 2026)
      const d=s.adate, txt=s.cur?s.cur.action:'';
      return '<div class="lm-acell" onclick="event.stopPropagation();navTo(\'legal/mis/action/'+r.id+'\')" title="Action history">'
        +(txt?'<div class="lm-cell"'+(s.open?' style="font-weight:650;color:#92400e"':'')+'>'+esc(txt)+'</div>':'<button class="lm-btn primary lm-addact"><i class="fa-solid fa-plus"></i> Add action</button>')
        +(d?'<div class="lm-t2"><i class="fa-solid fa-'+(s.done?'circle-check" style="color:#16a34a':'bolt" style="color:#d97706')+'"></i> '+lmDmy(d)
          +(s.cur?' · '+esc(lmName(s.cur.person)):'')+(s.done?' · done':'')+'</div>':'')
        +'</div>';
    }
  }
  return mute;
}
// Date of Filing is DD/MM/YYYY text on the live MIS ("NA" where unknown) - to and from the date picker's ISO.
function lmDofIso(v){ const m=String(v||'').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m?m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'):''; }
function lmDofText(iso){ return iso?lmDmy(iso):null; }
// File numbers came in from a spreadsheet as "160.0" - shown and edited as "160".
function lmFileNo(v){ return String(v==null?'':v).trim().replace(/^(\d+)\.0$/,'$1'); }
function lmRowHtml(r,s,grp){
  const disposed=!!r.completed_at;
  return '<tr data-id="'+r.id+'" data-grp="'+grp+'" class="'+(grp==='near'?'lm-near':'')+(disposed?' lm-disposed':'')+(LM.sel.has(r.id)?' lm-on':'')+'"'
    +' onclick="if(!event.target.closest(\'.lm-nogo\'))navTo(\'legal/mis/case/'+r.id+'\')">'
    +'<td class="lm-first lm-nogo" onclick="event.stopPropagation()"><input type="checkbox" class="lm-cb" data-id="'+r.id+'"'+(LM.sel.has(r.id)?' checked':'')+' onchange="lmSelect(this)">'
    +'<i class="fa-solid fa-grip-vertical lm-grip" data-id="'+r.id+'" title="'+(disposed?'Slide left to reopen this case':'Drag up or down to reorder · slide left to dispose')+'"></i></td>'
    +LM_COLS.map(c=>'<td>'+lmCellHtml(c,r,s)+'</td>').join('')
    +'<td class="lm-upcell lm-nogo" onclick="event.stopPropagation()">'+lmUpBtn(r.id)+'</td></tr>';
}
// The cloud opens this case's folder in Legal Documents (5 Nov 2026, Ayush: "to open the case folder, not
// upload"). A case with no folder yet has nothing to open, so there it still starts one with the first upload.
function lmUpBtn(id){
  const n=LM.docCounts[id]||0, fid=LM.docVault[id];
  if(fid) return '<button class="lm-upbtn has" title="Open this case’s folder ('+n+' file'+(n===1?'':'s')+')" onclick="navTo(\'legal/cat/'+fid+'\')">'
    +'<i class="fa-solid fa-cloud"></i>'+(n?'<span class="n">'+n+'</span>':'')+'</button>';
  return '<button class="lm-upbtn" title="No folder yet - upload the first files to make one" onclick="lmRowUpload('+id+')"><i class="fa-solid fa-cloud-arrow-up"></i></button>';
}
async function lmLoadDocCounts(){
  const [{data:fo},{data:fi}]=await Promise.all([sb.from(MIST('mis_case_folders')).select('id,case_id,doc_folder_id'),sb.from(MIST('mis_case_files')).select('folder_id')]);
  const caseOf={}; LM.docFolders={}; LM.docCounts={}; LM.docVault={};
  (fo||[]).forEach(f=>{ caseOf[f.id]=f.case_id; LM.docFolders[f.case_id]=f.id; if(f.doc_folder_id) LM.docVault[f.case_id]=f.doc_folder_id; });
  (fi||[]).forEach(f=>{ const c=caseOf[f.folder_id]; if(c!=null) LM.docCounts[c]=(LM.docCounts[c]||0)+1; });
}
window.lmRowUpload=function(id){ window._lmHasFolder=!!LM.docFolders[id]; lmAddFiles(id); };
/* LEGAL 2 (5 Nov 2026): this reshaped MIS shows only on the Legal 2 page (legal2.html). The original
   Legal page keeps the MIS it had - legalMISOld in 10-legal-mis.js - and every legalMIS() call there
   lands back on it through this check. */
async function legalMIS(opened){
  if(PAGE!=='legal2') return legalMISOld();
  setCrumb(['Legal 2','MIS']);
  lmStyles();
  const hAct=$('legalHeadActions'); if(hAct) hAct.innerHTML='';
  const body=$('legalBody'); if(!body) return;
  loader(body);
  try{ await Promise.all([lmLoadLists(), lmLoadAll(), lmLoadDocCounts()]); }
  catch(e){ body.innerHTML='<div class="lm-empty">Could not load the cases: '+esc((e&&e.message)||String(e))+'</div>'; return; }
  window._misRows=LM.rows;   // the causelist reads this
  lmRenderTable();
  if(opened) lmOverduePopup();
}
/* HEARING DATES THAT HAVE PASSED (2 Nov 2026). The first time Legal > MIS is opened each day (5 Nov 2026 -
   every time was too often), the open cases whose newest
   hearing date is behind today - nobody has put in the next one - are listed in a popup, longest overdue
   first, each a click away from its Hearings page. From 7 days overdue, everyone in the Legal department
   (not Administration) is also emailed every day until it is updated - see customer-invite
   "legal_hearing_overdue". */
function lmOverdueList(){
  const today=lmToday();
  return LM.rows.filter(r=>!r.completed_at).map(r=>{ const s=r._s||lmCaseState(r); return {r,h:s.hearing}; })
    .filter(x=>x.h&&x.h<today).map(x=>Object.assign(x,{days:lmDiff(today,x.h)})).sort((a,b)=>b.days-a.days);
}
function lmOverduePopup(){
  const list=lmOverdueList(); if(!list.length) return;
  const key='lmOverdueSeen:'+(state.email||''), day=lmToday();
  try{ if(localStorage.getItem(key)===day) return; localStorage.setItem(key,day); }catch(_e){}
  const week=list.filter(x=>x.days>=7).length;
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-calendar-xmark" style="color:#b91c1c"></i> Hearing dates that have passed</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="overflow-x:hidden;box-sizing:border-box;max-width:100%">'
      +'<div style="font-size:13px;color:var(--slate);margin-bottom:12px"><b style="color:var(--ink)">'+list.length+' open case'+(list.length===1?'':'s')+'</b> still show a hearing date that has gone by. Put in the next hearing date for each.'
        +(week?' <b style="color:#b91c1c">'+week+' are 7 days or more overdue</b> - the Legal team is emailed about those every day until they are updated.':'')+'</div>'
      +'<div style="max-height:min(60vh,520px);overflow-y:auto;overflow-x:hidden;border:1px solid var(--line);border-radius:12px">'
      +list.map(x=>'<div onclick="closeModal();navTo(\'legal/mis/hearing/'+x.r.id+'\')" style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--line-2,#eef1f6);cursor:pointer'+(x.days>=7?';background:#fef2f2':'')+'">'
        +'<div style="min-width:0;flex:1"><div style="font-weight:650;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(String(x.r.cause_title||'').replace(/\s+/g,' '))+'</div>'
          +'<div style="font-size:12px;color:var(--slate)">'+esc([x.r.case_no,x.r.court].filter(Boolean).join(' · '))+'</div></div>'
        +'<div style="text-align:right;white-space:nowrap"><div style="font-weight:700;color:'+(x.days>=7?'#b91c1c':'#b45309')+'">'+lmDmy(x.h)+'</div>'
          +'<div style="font-size:11.5px;color:var(--slate)">'+x.days+' day'+(x.days===1?'':'s')+' ago</div></div>'
        +'<i class="fa-solid fa-chevron-right" style="color:#94a3b8"></i></div>').join('')
      +'</div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>','md');
}
function lmOrder(){
  const today=lmToday(), until=lmAddDays(today,LM_NEAR_DAYS);
  const near=[], rest=[], gone=[];
  LM.rows.forEach(function(r){
    const s=lmCaseState(r); r._s=s;
    if(r.completed_at){ gone.push(r); return; }
    const soon=[s.hearing, s.open?s.adate:null].filter(d=>d&&d>=today&&d<=until).sort()[0]||null;
    r._soon=soon;
    (soon?near:rest).push(r);
  });
  // Both groups keep the order they were arranged in with the 6-dot handle.
  near.sort((a,b)=>((a.sort_rank==null?a.id:a.sort_rank)-(b.sort_rank==null?b.id:b.sort_rank))||a._soon.localeCompare(b._soon));
  rest.sort((a,b)=>((a.sort_rank==null?a.id:a.sort_rank)-(b.sort_rank==null?b.id:b.sort_rank))||(a.id-b.id));
  gone.sort((a,b)=>String(b.completed_at||'').localeCompare(String(a.completed_at||''))||(b.id-a.id));
  return {near,rest,gone};
}
function lmRenderTable(){
  const body=$('legalBody'); if(!body) return;
  const o=lmOrder(), W=lmWidths();
  const total=LM.rows.length;
  const grpRow=function(label,n){ return '<tr class="lm-group"><td colspan="'+(LM_COLS.length+2)+'">'+label+' · '+n+'</td></tr>'; };
  const typeOpts=['<option value="">All case types</option>'].concat(LM.types.map(t=>'<option'+(LM.typeFilter===t?' selected':'')+'>'+esc(t)+'</option>'))
    .concat(['<option value="__none"'+(LM.typeFilter==='__none'?' selected':'')+'>Type not set</option>']);
  body.innerHTML=
    '<div class="lm-bar" id="lmBar">'
      +'<div class="lm-left">'
        +'<button class="lm-btn primary" onclick="navTo(\'legal/mis/case/new\')"><i class="fa-solid fa-plus"></i> Add Case</button>'
        +'<button class="lm-btn danger" id="lmDelBtn" onclick="lmDeleteSel()" disabled><i class="fa-solid fa-trash"></i> Delete</button>'
        +'<span class="lm-count" id="lmCount">'+total+' cases</span>'
        +(MIS_IS_TEST?'<span class="lm-test" title="This copy of JainE is running on your computer, so it uses the test tables - nothing here touches the live cases">TEST DATA</span>':'')
      +'</div>'
      +'<div class="lm-right">'
        +'<select class="lm-sel" id="lmType" onchange="LM.typeFilter=this.value;misFilter()">'+typeOpts.join('')+'</select>'
        +'<div class="mis-rangemenu" id="misRangeMenu" style="position:relative">'
          +'<button type="button" class="lm-btn" onclick="misRangeToggle()"><i class="fa-solid '+misRangeDef()[2]+'" style="color:var(--brand)"></i> '+esc(misRangeDef()[1])+' <i class="fa-solid fa-chevron-down" style="font-size:9px;color:var(--slate)"></i></button>'
          +'<div class="mis-range-list" style="display:none;position:absolute;top:calc(100% + 6px);left:0;min-width:210px;z-index:80;background:#fff;border:1px solid var(--line);border-radius:11px;padding:6px;box-shadow:0 14px 34px rgba(15,23,42,.18)">'
            +MIS_RANGES.map(r=>'<button type="button" class="lm-btn" style="width:100%;border:0;justify-content:flex-start;height:34px;'+(MIS_RANGE===r[0]?'background:#eef2ff;color:var(--brand)':'')+'" onclick="misRangePick(\''+r[0]+'\')"><i class="fa-solid '+r[2]+'"></i> '+esc(r[1])+'</button>').join('')
          +'</div></div>'
        +(MIS_RANGE==='custom'?'<span style="display:flex;gap:6px;align-items:center"><input type="date" id="misFrom" class="lm-in" style="height:36px;width:140px" value="'+esc(MIS_FROM)+'" onchange="MIS_FROM=this.value;misDateFromChange()"><span class="lm-count">to</span><input type="date" id="misTo" class="lm-in" style="height:36px;width:140px" value="'+esc(MIS_TO)+'" onchange="MIS_TO=this.value;misDateToChange()"></span>':'')
        +'<button class="lm-btn" onclick="lmViewCauselist()" title="Open the causelist for this date range in an editor"><i class="fa-solid fa-eye"></i> View</button>'
        +'<div class="lm-search"><i class="fa-solid fa-magnifying-glass"></i><input id="lmQ" placeholder="Search cases" oninput="misFilter()"></div>'
      +'</div>'
    +'</div>'
    +'<div class="lm-wrap" id="lmWrap"><table id="lmTbl"><colgroup><col style="width:64px">'+W.map(w=>'<col style="width:'+w+'px">').join('')+'<col style="width:70px"></colgroup>'
      +'<thead><tr class="lm-colrow"><th><input type="checkbox" class="lm-cb" id="lmAll" onchange="lmSelectAll(this)"></th>'
        +LM_COLS.map((c,ix)=>'<th style="position:sticky'+(ix&&LM_COLS[ix-1].sec!==c.sec?';border-left:1px solid var(--line)':'')+'" title="'+esc(c.l)+'">'+esc(c.l)+'<span class="lm-rz" onpointerdown="lmResize(event,'+ix+')"></span></th>').join('')
        +'<th class="lm-upth" title="Case files">Files</th></tr></thead>'
      +'<tbody id="lmBody">'
        +(o.near.length?grpRow('Coming up in the next '+LM_NEAR_DAYS+' days',o.near.length)+o.near.map(r=>lmRowHtml(r,r._s,'near')).join(''):'')
        +(o.rest.length?grpRow('Not coming up soon',o.rest.length)+o.rest.map(r=>lmRowHtml(r,r._s,'rest')).join(''):'')
        +(o.gone.length?grpRow('Disposed',o.gone.length)+o.gone.map(r=>lmRowHtml(r,r._s,'gone')).join(''):'')
        +(!total?'<tr><td colspan="'+(LM_COLS.length+2)+'"><div class="lm-empty">No cases yet - add the first one.</div></td></tr>':'')
      +'</tbody></table></div>';
  const menu=$('misRangeMenu');
  if(menu){ const list=menu.querySelector('.mis-range-list'); const obs=new MutationObserver(()=>{ list.style.display=menu.classList.contains('open')?'block':'none'; }); obs.observe(menu,{attributes:true,attributeFilter:['class']}); }
  lmWireGrips();
  misFilter();
}
// The search, the case-type filter and the date range, applied together. On the original Legal page
// the original MIS's own filter runs instead (see legalMIS above).
const misFilterOld=window.misFilter;
window.misFilter=function(){
  if(PAGE!=='legal2') return misFilterOld.apply(this,arguments);
  const q=String(($('lmQ')||{}).value||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const w=misRangeDates();
  let shown=0;
  document.querySelectorAll('#lmBody tr[data-id]').forEach(function(tr){
    const r=LM.rows.find(x=>x.id===Number(tr.dataset.id)); if(!r) return;
    const s=r._s||lmCaseState(r);
    let ok=true;
    if(LM.typeFilter==='__none') ok=!r.case_type; else if(LM.typeFilter) ok=r.case_type===LM.typeFilter;
    if(ok&&w){ const d=[s.hearing,s.adate].filter(Boolean); ok=d.some(x=>x>=w.from&&x<=w.to); }
    if(ok&&q.length){
      const blob=[r.cause_title,r.case_no,r.case_type,r.court,lmFileNo(r.file_no),r.cnr_no,r.pc_in_charge,r.advocate_incharge,r.case_brief,
        s.cur&&s.cur.action,s.cur&&lmName(s.cur.person),lmDmy(s.hearing),lmDmy(s.adate)].join(' ').toLowerCase();
      ok=q.every(t=>blob.indexOf(t)!==-1);
    }
    tr.style.display=ok?'':'none'; if(ok) shown++;
  });
  document.querySelectorAll('#lmBody tr.lm-group').forEach(function(g){
    let n=0, x=g.nextElementSibling; while(x&&!x.classList.contains('lm-group')){ if(x.style.display!=='none') n++; x=x.nextElementSibling; }
    g.style.display=n?'':'none'; const td=g.firstElementChild; if(td) td.textContent=td.textContent.replace(/ · \d+$/,' · '+n);
  });
  const c=$('lmCount'); if(c) c.textContent=shown===LM.rows.length?(shown+' cases'):(shown+' of '+LM.rows.length+' cases');
};
window.lmSelect=function(cb){
  const id=Number(cb.dataset.id); if(cb.checked) LM.sel.add(id); else LM.sel.delete(id);
  const tr=cb.closest('tr'); if(tr) tr.classList.toggle('lm-on',cb.checked);
  const b=$('lmDelBtn'); if(b){ b.disabled=!LM.sel.size; b.innerHTML='<i class="fa-solid fa-trash"></i> Delete'+(LM.sel.size>1?' ('+LM.sel.size+')':''); }
};
window.lmSelectAll=function(cb){
  document.querySelectorAll('#lmBody tr[data-id]').forEach(function(tr){ if(tr.style.display==='none') return; const x=tr.querySelector('.lm-cb'); if(x){ x.checked=cb.checked; lmSelect(x); } });
};
window.lmDeleteSel=async function(){
  const ids=[...LM.sel]; if(!ids.length) return;
  const names=ids.map(id=>{ const r=LM.rows.find(x=>x.id===id); return r?String(r.cause_title||r.case_no||('Case '+id)).replace(/\s+/g,' ').slice(0,70):''; });
  if(!await confirmDialog('Delete '+(ids.length===1?'this case':ids.length+' cases')+'?\n\n'+names.join('\n')+'\n\nIts hearings, actions and any open action task go with it. This cannot be undone.')) return;
  let bad=0;
  for(const id of ids){ const {error}=await sb.rpc('legal_mis_delete_case',{p_case:id,p_test:MIS_IS_TEST}); if(error){ bad++; console.error(error); } }
  LM.sel.clear();
  toast(bad?('Deleted '+(ids.length-bad)+', '+bad+' could not be deleted'):(ids.length===1?'Case deleted':ids.length+' cases deleted'),bad?'warn':'ok');
  legalMIS();
};
// Column widths, dragged at the header edge and remembered for this person on this browser.
window.lmResize=function(e,ix){
  e.preventDefault(); e.stopPropagation();
  const col=document.querySelectorAll('#lmTbl col')[ix+1]; if(!col) return;
  const start=e.clientX, w0=col.getBoundingClientRect().width||parseInt(col.style.width,10)||120;
  const h=e.target; h.classList.add('on');
  const move=function(ev){ col.style.width=Math.min(LM_COL_MAX,Math.max(LM_COL_MIN,w0+ev.clientX-start))+'px'; };
  const up=function(){ document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); h.classList.remove('on'); lmSaveWidth(LM_COLS[ix].k,parseInt(col.style.width,10)); };
  document.addEventListener('pointermove',move); document.addEventListener('pointerup',up);
};
/* The 6-dot handle: slide left to dispose (or reopen); drag up or down to put the cases in the order
   they matter. Both the cases coming up and the rest can be arranged, each within its own group -
   a drag never carries a case from one group into the other. Disposed cases are not arranged. */
function lmWireGrips(){
  document.querySelectorAll('#lmBody .lm-grip').forEach(function(g){
    g.addEventListener('pointerdown',function(e){
      if(e.button!==undefined&&e.button!==0) return;
      e.preventDefault(); e.stopPropagation();
      const tr=g.closest('tr'); if(!tr) return;
      const grp=tr.dataset.grp, sx=e.clientX, sy=e.clientY, wrap=$('lmWrap');
      let mode=null, dx=0;
      const move=function(ev){
        dx=ev.clientX-sx; const dy=ev.clientY-sy;
        if(!mode){
          if(Math.abs(dx)<6&&Math.abs(dy)<6) return;
          mode=(Math.abs(dx)>Math.abs(dy))?'swipe':(grp==='gone'?'none':'drag');
          if(mode==='drag'){ tr.classList.add('lm-dragging'); document.body.style.cursor='grabbing'; document.body.style.userSelect='none'; }
        }
        if(mode==='swipe'&&dx<0){ tr.style.transition='none'; tr.style.transform='translateX('+Math.max(dx,-90)+'px)'; }
        if(mode==='drag'){
          ev.preventDefault();
          // the rows of the same group, and where the pointer sits among them
          const rows=[...document.querySelectorAll('#lmBody tr[data-grp="'+grp+'"]')].filter(x=>x!==tr&&x.style.display!=='none');
          let before=null;
          for(const x of rows){ const r=x.getBoundingClientRect(); if(ev.clientY<r.top+r.height/2){ before=x; break; } }
          if(before){ if(tr.nextElementSibling!==before) before.parentNode.insertBefore(tr,before); }
          else if(rows.length){ const last=rows[rows.length-1]; if(last.nextElementSibling!==tr) last.parentNode.insertBefore(tr,last.nextSibling); }
          // near the top or bottom of the table, keep scrolling
          if(wrap){ const wr=wrap.getBoundingClientRect(); if(ev.clientY<wr.top+60) wrap.scrollTop-=14; else if(ev.clientY>wr.bottom-40) wrap.scrollTop+=14; }
        }
      };
      const up=async function(){
        document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); document.removeEventListener('pointercancel',up);
        document.body.style.cursor=''; document.body.style.userSelect='';
        tr.style.transition='transform .15s'; tr.style.transform=''; tr.classList.remove('lm-dragging');
        if(mode==='swipe'&&dx<-44) await lmDisposeToggle(Number(tr.dataset.id));
        if(mode==='drag') await lmSaveOrder(grp);
      };
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up); document.addEventListener('pointercancel',up);
    });
  });
}
async function lmSaveOrder(grp){
  const ids=[...document.querySelectorAll('#lmBody tr[data-grp="'+(grp||'rest')+'"]')].map(t=>Number(t.dataset.id));
  const ranks=ids.map(id=>(LM.rows.find(r=>r.id===id)||{}).sort_rank).filter(x=>x!=null).sort((a,b)=>a-b);
  const jobs=[];
  ids.forEach(function(id,i){
    const r=LM.rows.find(x=>x.id===id); if(!r) return;
    const want=(ranks.length===ids.length)?ranks[i]:(i+1)*10;
    if(r.sort_rank!==want){ r.sort_rank=want; jobs.push(sb.from(MIST('mis_cases')).update({sort_rank:want}).eq('id',id)); }
  });
  if(!jobs.length) return;
  const res=await Promise.all(jobs);
  if(res.some(x=>x.error)) toast('The new order could not all be saved - refresh and try again','warn'); else toast('Order saved','ok');
}
async function lmDisposeToggle(id){
  const r=LM.rows.find(x=>x.id===id); if(!r) return;
  const dispose=!r.completed_at, s=r._s||lmCaseState(r);
  if(dispose&&s.open){ toast('This case still has an open action - "'+String(s.cur.action).slice(0,50)+'". Its task has to be completed first.','warn'); return; }
  const {error}=await sb.from(MIST('mis_cases')).update({completed_at:dispose?lmToday():null}).eq('id',id);
  if(error){ toast('Could not update: '+error.message,'err'); return; }
  toast(dispose?'Case disposed':'Case reopened','ok');
  r.completed_at=dispose?lmToday():null;
  lmRenderTable();
}

/* ---------------------------------------------------------------- the causelist, in an editor */
window.lmViewCauselist=async function(){
  // The causelist still reads its old fields: status is the latest hearing's stage, the action is the open one.
  window._misRows=LM.rows.map(function(r){
    const s=r._s||lmCaseState(r), h=s.hs[0];
    return Object.assign({},r,{status:(h&&h.stage)||r.status||'',action_needed:s.open?s.cur.action:''});
  });
  const tab=window.open('','_blank');
  if(!tab){ toast('Your browser blocked the new tab','err'); return; }
  const built=misBuildCauselist();
  if(!built){ tab.close(); return; }
  const doc=String(built.html);
  const bar='<div id="lmEdBar" contenteditable="false" style="position:sticky;top:0;z-index:10;display:flex;gap:8px;align-items:center;padding:10px 16px;background:#0f172a;color:#fff;font:600 13px Segoe UI,Arial,sans-serif">'
    +'<span style="margin-right:auto">CAUSELIST - '+esc(built.tabName)+' · click anywhere in it to edit - changes are saved to the MIS on Download</span>'
    +'<span id="lmEdMsg" style="font-weight:500;color:#a5b4fc"></span>'
    +'<button onclick="lmWord()" style="height:32px;padding:0 14px;border:0;border-radius:8px;background:#2563eb;color:#fff;font:600 12.5px inherit;cursor:pointer">Download Word</button>'
    +'<button onclick="lmBar.style.display=\'none\';print();lmBar.style.display=\'flex\'" style="height:32px;padding:0 14px;border:0;border-radius:8px;background:#fff;color:#0f172a;font:600 12.5px inherit;cursor:pointer">Print / Save as PDF</button></div>';
  /* EDITS GO BACK INTO THE MIS (2 Nov 2026). Each cell remembers what it said when the causelist opened;
     on Download Word, every cell that now says something else is handed to the MIS tab (lmCauselistApply)
     and saved there before the file downloads. */
  const script='<script>var lmBar=document.getElementById("lmEdBar");document.getElementById("lmEdArea").contentEditable="true";'
    +'var lmCells=[].slice.call(document.querySelectorAll("td[data-f]"));lmCells.forEach(function(c){c.dataset.o=c.innerText.trim();});'
    +'function lmSave(done){var ch=lmCells.filter(function(c){return c.innerText.trim()!==c.dataset.o;}).map(function(c){return {id:Number(c.parentNode.dataset.id),f:c.dataset.f,v:c.innerText.trim()};});'
    +'if(!ch.length){done();return;}var m=document.getElementById("lmEdMsg");'
    +'if(!window.opener||!window.opener.lmCauselistApply){m.textContent="The MIS tab is closed - changes are in the file only";done();return;}'
    +'m.textContent="Saving "+ch.length+" change"+(ch.length===1?"":"s")+" to the MIS…";'
    +'window.opener.lmCauselistApply(ch).then(function(r){m.textContent=r.saved+" change"+(r.saved===1?"":"s")+" saved to the MIS"+(r.skipped.length?" · not saved: "+r.skipped.join("; "):"");'
    +'lmCells.forEach(function(c){c.dataset.o=c.innerText.trim();});done();},function(e){m.textContent="Could not save to the MIS: "+e;done();});}'
    +'function lmWord(){lmSave(function(){var h="<html><head><meta charset=\\"utf-8\\"></head><body>"+document.getElementById("lmEdArea").innerHTML+"</body></html>";'
    +'var a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\\ufeff",h],{type:"application/msword"}));a.download="CAUSTLIST - '+String(built.tabName).replace(/"/g,'')+'.doc";document.body.appendChild(a);a.click();setTimeout(function(){a.remove();},1000);});}<\/script>';
  const withEditor=/<body[^>]*>/i.test(doc)
    ? doc.replace(/<body([^>]*)>/i,'<body$1>'+bar+'<div id="lmEdArea">').replace(/<\/body>/i,'</div>'+script+'</body>')
    : bar+'<div id="lmEdArea">'+doc+'</div>'+script;
  tab.document.open(); tab.document.write(withEditor); tab.document.close();
  try{ usageQueue('legal.mis.view_causelist','view', usbCauselistMeta(built)); }catch(_e){}
};

/* What the causelist editor hands back on Download: [{id, f, v}] for every cell that was changed.
   Case Type / Case Details / Case No. / Advocate / Court are the case's own fields; DATE and STATUS are the
   latest hearing's date and stage (a new hearing when the case has none yet); ACTION NEEDED is the open
   action (and so its task). An action changed on a case with no open action, or a date that is not
   DD/MM/YYYY, is reported back and not saved. */
window.lmCauselistApply=async function(changes){
  const out={saved:0,skipped:[]};
  const caseField={case_type:'case_type',cause_title:'cause_title',case_no:'case_no',advocate_incharge:'advocate_incharge',court:'court'};
  const by={}; (changes||[]).forEach(c=>{ (by[c.id]=by[c.id]||[]).push(c); });
  for(const id of Object.keys(by).map(Number)){
    const r=LM.rows.find(x=>x.id===id); if(!r){ out.skipped.push('a case no longer in the MIS'); continue; }
    const nm=String(r.cause_title||'case').replace(/\s+/g,' ').slice(0,40), s=r._s||lmCaseState(r), h=s.hs[0];
    const upd={}, hu={};
    for(const c of by[id]){
      if(caseField[c.f]){ upd[caseField[c.f]]=c.v||null; continue; }
      if(c.f==='date'){
        const m=String(c.v).match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
        if(!m){ out.skipped.push(nm+' - date "'+c.v+'" is not DD/MM/YYYY'); continue; }
        hu.hearing_date=m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'); continue;
      }
      if(c.f==='status'){ hu.stage=c.v||null; continue; }
      if(c.f==='action'){
        if(!s.open||!s.cur){ out.skipped.push(nm+' - no open action to change'); continue; }
        const {error}=await sb.rpc('legal_mis_update_action',{p_id:s.cur.id,p_action:c.v,p_date:s.adate,p_person:s.cur.person,p_test:MIS_IS_TEST});
        if(error) out.skipped.push(nm+' - action: '+error.message); else out.saved++;
      }
    }
    if(Object.keys(upd).length){
      const {error}=await sb.from(MIST('mis_cases')).update(Object.assign(upd,{updated_at:new Date().toISOString()})).eq('id',id);
      if(error) out.skipped.push(nm+' - '+error.message); else out.saved+=Object.keys(upd).length-1;
    }
    if(Object.keys(hu).length){
      const q=h?sb.from(MIST('mis_hearings')).update(Object.assign({},hu,{updated_at:new Date().toISOString()})).eq('id',h.id)
               :sb.from(MIST('mis_hearings')).insert(Object.assign({case_id:id,remarks:'From the causelist',created_by:state.email},hu));
      const {error}=await q;
      if(error) out.skipped.push(nm+' - hearing: '+error.message); else out.saved+=Object.keys(hu).length;
    }
  }
  try{ await legalMIS(); }catch(_e){}
  try{ usageQueue('legal.mis.causelist_saved','edit',{changes:String(out.saved)}); }catch(_e){}
  return out;
};

/* ---------------------------------------------------------------- case files */
// Choosing where a case's papers go: Litigation or Projects in the Legal vault, any folder below,
// or a new one made there and then.
const LMF={pick:null,staged:[]};
async function lmFolderKids(parentId){
  let q=sb.schema('doc').from('folders').select('id,name,parent_id').eq('department','Legal').order('name');
  q=parentId==null?q.is('parent_id',null):q.eq('parent_id',parentId);
  const {data}=await q; return data||[];
}
window.lmFolderPicker=async function(onPick){
  window._lmFpOnPick=onPick;
  window._lmFpPath=[];   // [{id,name}] from the root down
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-folder-tree"></i> Where should the case files go?</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" id="lmFpBody" style="width:min(94vw,560px)"><div class="loader"><div class="spin"></div></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="lmFpUse" onclick="lmFpUse()" disabled><i class="fa-solid fa-check"></i> Use this folder</button></div>','md');
  lmFpDraw();
};
async function lmFpDraw(){
  const b=$('lmFpBody'); if(!b) return;
  const path=window._lmFpPath, here=path[path.length-1]||null;
  let kids=[];
  if(!here) kids=(await lmFolderKids(null)).filter(f=>f.name==='Litigation'||f.name==='Projects');
  else if(here.id) kids=await lmFolderKids(here.id);
  window._lmFpKids=kids;
  b.innerHTML='<div class="lm-fp-crumb"><a onclick="window._lmFpPath=[];lmFpDraw()">All</a>'
      +path.map((p,i)=>' <span style="color:var(--slate)">›</span> <a onclick="window._lmFpPath=window._lmFpPath.slice(0,'+(i+1)+');lmFpDraw()">'+esc(p.name)+'</a>').join('')+'</div>'
    +'<div class="lm-fp-list">'+(kids.length?kids.map((k,ki)=>'<div class="lm-fp-item" onclick="window._lmFpPath.push(window._lmFpKids['+ki+']);lmFpDraw()"><i class="fa-solid fa-folder"></i> '+esc(k.name)+'<i class="fa-solid fa-chevron-right" style="margin-left:auto;color:var(--slate);font-size:11px"></i></div>').join('')
      :'<div class="lm-empty" style="border:0">'+(here?'No folders inside - use this one, or make a new one below':'')+'</div>')+'</div>'
    +(here?'<div style="display:flex;gap:8px;margin-top:12px"><input id="lmFpNew" class="lm-in" placeholder="New folder name (e.g. the case title)"><button class="btn" onclick="lmFpMake()"><i class="fa-solid fa-folder-plus"></i> Make folder</button></div>'
      +'<div style="font-size:12px;color:var(--slate);margin-top:10px">Files will go into: <b style="color:#1e3a8a">'+path.map(p=>esc(p.name)).join(' › ')+'</b></div>'
      :'<div style="font-size:12px;color:var(--slate);margin-top:10px">Start in Litigation or Projects.</div>');
  const use=$('lmFpUse'); if(use) use.disabled=!(here&&path.length>=2);
}
window.lmFpMake=async function(){
  const nm=String(($('lmFpNew')||{}).value||'').trim(); if(!nm){ toast('Give the folder a name','warn'); return; }
  const path=window._lmFpPath, here=path[path.length-1];
  if(MIS_IS_TEST||!here.id){ path.push({id:null,name:nm}); lmFpDraw(); return; }   // the test copy never adds to the real vault
  const {data:hit}=await sb.schema('doc').from('folders').select('id').eq('department','Legal').eq('parent_id',here.id).ilike('name',nm).maybeSingle();
  if(hit){ path.push({id:hit.id,name:nm}); lmFpDraw(); return; }
  const {data,error}=await sb.schema('doc').from('folders').insert({department:'Legal',name:nm,parent_id:here.id,created_by:state.email}).select('id').single();
  if(error){ toast('Could not make the folder: '+error.message,'err'); return; }
  path.push({id:data.id,name:nm}); lmFpDraw();
};
window.lmFpUse=function(){ const p=window._lmFpPath.slice(); closeModal(); if(window._lmFpOnPick) window._lmFpOnPick(p); };
function lmSeg(s){ return String(s||'').replace(/[^\w.\- ]/g,'-').replace(/\s+/g,'-').replace(/-{2,}/g,'-').replace(/^[-.]+|[-.]+$/g,'')||'x'; }
// Puts files into a case's folder, making the folder record the first time.
async function lmUploadFiles(caseId,path,files,onProg){
  let {data:folder}=await sb.from(MIST('mis_case_folders')).select('*').eq('case_id',caseId).maybeSingle();
  if(!folder){
    const last=path[path.length-1]||{};
    const prefix=(MIS_IS_TEST?'legal-test/':'legal/')+path.map(p=>lmSeg(p.name)).join('/');
    const {data:ins,error}=await sb.from(MIST('mis_case_folders')).insert({case_id:caseId,sub_category:path.slice(0,-1).map(p=>p.name).join(' / ')||path[0].name,
      folder_name:last.name,storage_prefix:prefix,created_by:state.email,doc_folder_id:MIS_IS_TEST?null:(last.id||null)}).select('*').single();
    if(error) throw error; folder=ins;
  }
  const catText=[folder.sub_category,folder.folder_name].filter(Boolean).join(' / ');
  let n=0;
  for(const f of files){
    if(onProg) onProg('Uploading '+(n+1)+' of '+files.length+' - '+f.name);
    const key=folder.storage_prefix+'/'+lmSeg(f.name);
    const {data,error}=await uploadFileToS3(key,f); if(error) throw error;
    const stored=String(data&&data.path||('s3:'+key));
    const {error:e2}=await sb.from(MIST('mis_case_files')).insert({folder_id:folder.id,file_name:f.name,storage_key:stored.replace(/^s3:/,''),store:'s3',
      size_bytes:f.size,content_type:f.type||'application/octet-stream',uploaded_at:new Date().toISOString(),created_by:state.email});
    if(e2) throw e2;
    if(!MIS_IS_TEST&&folder.doc_folder_id){
      await sb.schema('doc').from('documents').insert({title:f.name,department:'Legal',category:catText,folder_id:folder.doc_folder_id,
        storage_path:stored.indexOf('s3:')===0?stored:('s3:'+key),file_name:f.name,file_size:f.size,file_type:f.type||'application/octet-stream',
        status:'Active',visibility:'Internal',uploaded_by:state.email});
    }
    n++;
  }
  return n;
}
window.lmDeleteFile=async function(fileId,caseId){
  const {data:f}=await sb.from(MIST('mis_case_files')).select('*').eq('id',fileId).maybeSingle(); if(!f) return;
  if(!await confirmDialog('Delete "'+f.file_name+'" from this case?')) return;
  const {error}=await sb.from(MIST('mis_case_files')).delete().eq('id',fileId);
  if(error){ toast('Could not delete: '+error.message,'err'); return; }
  if(!MIS_IS_TEST){ try{ await sb.schema('doc').from('documents').delete().eq('storage_path','s3:'+f.storage_key); }catch(e){} }
  toast('File deleted','ok');
  lmDrawFiles(caseId);
};
/* UNLINKING A CASE'S FOLDER (6-7 Nov 2026).
   A case keeps the folder its first files went into, and "Add files" goes straight back there, so a
   folder picked by mistake - or one whose files were all deleted - could never be let go of. Unlink
   lets it go, and it is offered whether or not files are still in it: asked for on 7 Nov, unlinking
   a folder that still holds files DELETES those files (from the case, from Documents and from the
   file store), after a confirmation that says how many. The matching Documents folder in the Legal
   vault is deleted too once it is empty (no other documents, no folders inside, no other case using
   it); otherwise it is left in place and the message says why. Next time files are added, the case
   asks where they should go again. */
window.lmRemoveFolder=async function(caseId){
  const {folders,files}=await lmLoadDocs(caseId);
  const fo=folders[0]; if(!fo) return;
  const where=[fo.sub_category,fo.folder_name].filter(Boolean).join(' › ');
  const n=files.length;
  if(!await confirmDialog(n
      ? 'Unlink the folder "'+where+'" from this case? The '+n+' file'+(n===1?'':'s')+' in it will be DELETED - from this case, from Documents and from storage. This cannot be undone.'
      : 'Unlink the folder "'+where+'" from this case? It has no files. Next time you add files, you will be asked where they should go.',
      {title:'Unlink folder',icon:'fa-link-slash',okLabel:n?'Unlink and delete '+n+' file'+(n===1?'':'s'):'Unlink',danger:true})) return;

  // 1) The files, one by one, so a refusal is counted rather than hidden.
  let deleted=0; const failed=[];
  for(const f of files){
    const {data:g,error:fe}=await sb.from(MIST('mis_case_files')).delete().eq('id',f.id).select('id');
    if(fe||!g||!g.length){ failed.push(f.file_name); continue; }
    deleted++;
    if(!MIS_IS_TEST){
      try{ await sb.schema('doc').from('documents').delete().eq('storage_path','s3:'+f.storage_key); }catch(_e){}
      try{ if(f.store==='s3'||!f.store) await s3Delete('s3:'+f.storage_key); }catch(_e){}
    }
  }
  if(failed.length){
    toast('Not unlinked: '+failed.length+' file'+(failed.length===1?'':'s')+' could not be deleted ('+failed.slice(0,3).join(', ')+(failed.length>3?'…':'')+')'+(deleted?'. '+deleted+' were deleted.':''),'err');
    lmDrawFiles(caseId); return;
  }

  // 2) The Documents folder, only if nothing else is in it.
  let vault=null, vaultNote='';
  if(!MIS_IS_TEST&&fo.doc_folder_id){
    const [{count:docs},{count:kids},{count:others}]=await Promise.all([
      sb.schema('doc').from('documents').select('id',{count:'exact',head:true}).eq('folder_id',fo.doc_folder_id),
      sb.schema('doc').from('folders').select('id',{count:'exact',head:true}).eq('parent_id',fo.doc_folder_id),
      sb.from(MIST('mis_case_folders')).select('id',{count:'exact',head:true}).eq('doc_folder_id',fo.doc_folder_id).neq('id',fo.id)]);
    if(!docs&&!kids&&!others) vault=fo.doc_folder_id;
    else vaultNote=' The folder in Documents still holds '+[docs?docs+' other document(s)':'',kids?kids+' folder(s)':'',others?'another case':''].filter(Boolean).join(', ')+', so it stays there.';
  }

  // 3) The link itself.
  const {data:gone,error}=await sb.from(MIST('mis_case_folders')).delete().eq('id',fo.id).select('id');
  if(error||!gone||!gone.length){ toast((deleted?deleted+' file(s) deleted, but ':'')+'the folder could not be unlinked: '+((error&&error.message)||'you may not have permission'),'err'); lmDrawFiles(caseId); return; }
  let msg='Folder unlinked'+(deleted?' and '+deleted+' file'+(deleted===1?'':'s')+' deleted':'');
  let warn=false;
  if(vault){
    const {data:vg,error:ve}=await sb.schema('doc').from('folders').delete().eq('id',vault).select('id');
    if(ve||!vg||!vg.length){ msg+=' - the empty folder in Documents could not be deleted ('+((ve&&ve.message)||'no permission')+')'; warn=true; }
    else msg+='; the empty folder was removed from Documents';
  }else msg+='.'+vaultNote;
  if(LM.docFolders) delete LM.docFolders[caseId];
  if(LM.docVault) delete LM.docVault[caseId];
  toast(msg,warn?'warn':'ok');
  try{ usageQueue('legal.mis.case_folder_removed','delete',{case_id:String(caseId),files_deleted:String(deleted)}); }catch(_e){}
  lmDrawFiles(caseId);
};
function lmBytes(n){ n=Number(n)||0; return n>1048576?((n/1048576).toFixed(1)+' MB'):(n>1024?Math.round(n/1024)+' KB':n+' B'); }
async function lmDrawFiles(caseId){
  const host=$('lmFilesHost'); if(!host) return;
  if(!caseId){
    host.innerHTML=(LMF.pick?'<div class="lm-path"><i class="fa-solid fa-folder-open"></i> Into <b>'+LMF.pick.map(p=>esc(p.name)).join(' › ')+'</b></div>':'')
      +(LMF.staged.length?'<div class="lm-files">'+LMF.staged.map((f,i)=>'<div class="lm-file"><i class="fa-solid fa-file" style="color:#64748b"></i><span class="nm" style="cursor:default">'+esc(f.name)+'</span><span class="sz">'+lmBytes(f.size)+'</span><button class="x" onclick="LMF.staged.splice('+i+',1);lmDrawFiles()"><i class="fa-solid fa-xmark"></i></button></div>').join('')+'</div>'
        :'<div class="lm-empty">No files chosen yet</div>');
    return;
  }
  host.innerHTML='<div class="loader"><div class="spin"></div></div>';
  const {folders,files}=await lmLoadDocs(caseId);
  const fo=folders[0];
  host.innerHTML=(fo?'<div class="lm-path" style="display:flex;align-items:center;gap:10px"><span style="flex:1;min-width:0"><i class="fa-solid fa-folder-open"></i> In <b>'+esc([fo.sub_category,fo.folder_name].filter(Boolean).join(' › '))+'</b></span>'
      +'<button class="btn btn-sm" style="flex:none" title="Unlink this folder from the case'+(files.length?' - its files will be deleted':'')+'" onclick="lmRemoveFolder('+caseId+')"><i class="fa-solid fa-link-slash"></i> Unlink folder</button></div>':'')
    +(files.length?'<div class="lm-files">'+files.map(f=>'<div class="lm-file"><i class="fa-solid fa-file'+(/\.pdf$/i.test(f.file_name)?'-pdf':'')+'" style="color:#dc2626"></i>'
        +'<span class="nm" onclick="s3OpenSigned(\'s3:'+esc(f.storage_key)+'\',\''+esc(String(f.file_name).replace(/'/g,''))+'\')">'+esc(f.file_name)+'</span>'
        +'<span class="sz">'+lmBytes(f.size_bytes)+'</span><button class="x" title="Delete this file" onclick="lmDeleteFile('+f.id+','+caseId+')"><i class="fa-solid fa-trash"></i></button></div>').join('')+'</div>'
      :'<div class="lm-empty">No files filed for this case yet</div>');
  window._lmHasFolder=!!fo;
}
window.lmAddFiles=function(caseId){
  const go=function(path){
    const inp=document.createElement('input'); inp.type='file'; inp.multiple=true;
    inp.onchange=async function(){
      const files=[...(inp.files||[])]; if(!files.length) return;
      if(!caseId){ LMF.pick=path; LMF.staged=LMF.staged.concat(files); lmDrawFiles(); return; }
      const host=$('lmFilesHost'); if(host) host.insertAdjacentHTML('afterbegin','<div class="lm-path" id="lmUpProg">Uploading…</div>');
      try{ const n=await lmUploadFiles(caseId,path||[],files,t=>{ const p=$('lmUpProg'); if(p) p.textContent=t; }); toast(n+' file'+(n===1?'':'s')+' added','ok'); }
      catch(e){ toast('Upload failed: '+((e&&e.message)||e),'err'); }
      lmDrawFiles(caseId);
      if(!$('lmFilesHost')&&$('lmTbl')){ try{ await lmLoadDocCounts(); lmRenderTable(); }catch(_e){} }   // from the table's cloud
    };
    inp.click();
  };
  if(caseId&&window._lmHasFolder) return go(null);
  if(!caseId&&LMF.pick) return go(LMF.pick);
  lmFolderPicker(go);
};

/* ---------------------------------------------------------------- THE CASE PAGE */
async function misCasePage(idArg){
  lmStyles();
  const isNew=(idArg==='new'), id=isNew?null:Number(idArg);
  const body=$('legalBody'); if(!body) return;
  const hAct=$('legalHeadActions'); if(hAct) hAct.innerHTML='';
  loader(body);
  try{ await lmLoadLists(); if(!isNew) await lmLoadAll(id); }catch(e){ body.innerHTML='<div class="lm-empty">Could not load: '+esc((e&&e.message)||e)+'</div>'; return; }
  const r=isNew?{}:(LM.rows.find(x=>x.id===id)||null);
  if(!isNew&&!r){ body.innerHTML='<div class="lm-page">'+lmBackBar('Case not found')+'<div class="lm-empty">This case no longer exists.</div></div>'; return; }
  setCrumb(['Legal','MIS',isNew?'New case':String(r.cause_title||'Case').slice(0,40)]);
  if(isNew){ LMF.pick=null; LMF.staged=[]; }
  const s=isNew?null:lmCaseState(r);
  const today=lmToday();
  const sec1=lmCard(1,'Case','#1e3a8a','<div class="lm-grid">'
      +lmField('Case Title','<input id="lmCaseTitle" class="lm-in" value="'+esc(r.cause_title||'')+'" placeholder="e.g. Prabir Hazra vs Jain Group Projects Pvt Ltd">',{req:true,full:true})
      +lmField('Case Type',lmCombo('lmCaseType',r.case_type||'',LM.types,'Choose or type a new one'),{req:true})
      +lmField('Case No.','<input id="lmCaseNo" class="lm-in" value="'+esc(r.case_no||'')+'">',{req:true})
      +lmField('Court Name',lmCombo('lmCourt',r.court||'',LM.courts,'Choose or type a new one'),{req:true,full:true})
      +lmField('Case Brief','<textarea id="lmBrief" class="lm-in" rows="3" placeholder="A few lines on what the case is about">'+esc(r.case_brief||'')+'</textarea>',{optional:true,full:true})
    +'</div>');
  const legal=lmLegalPeople();
  // Date of Filing, beside the Hearing Date, kept as DD/MM/YYYY like the live MIS's own entries (2 Nov 2026)
  const dofField=lmField('Date of Filing',lmDateInput('lmFiling',lmDofIso(r.date_of_filing)),{optional:true});
  const hearingField=isNew
    ? lmField('Hearing Date',lmDateInput('lmHearDate','',{min:today}),{req:true})+dofField
      // Remarks are required on every NEW hearing, including a new case's first one (2 Nov 2026).
      // Hearings brought in from the old MIS keep their "NA" stage and blank remarks.
      +lmField('Hearing Remarks','<textarea id="lmHearRem" class="lm-in" rows="2" placeholder="What happened, or what is expected, at this hearing"></textarea>',{req:true,full:true})
    : lmField('Hearing Date','<div class="lm-ro" style="display:flex;align-items:center;gap:10px"><b>'+(s.hearing?lmDmy(s.hearing):'Not set')+'</b>'
        +(s.hs[0]&&s.hs[0].stage?'<span class="lm-stage">'+esc(s.hs[0].stage)+'</span>':'')
        +'<a style="margin-left:auto;font-size:12.5px;font-weight:600;color:var(--brand);cursor:pointer" onclick="navTo(\'legal/mis/hearing/'+id+'\')">'+(s.hs.length?'Add / change':'Add a hearing')+' <i class="fa-solid fa-arrow-right"></i></a></div>')+dofField;
  const sec2=lmCard(2,'Hearing','#64748b','<div class="lm-grid">'
      +hearingField
      +lmField('Location (File No.)','<input id="lmLocation" class="lm-in" value="'+esc(lmFileNo(r.file_no))+'" placeholder="Rack / shelf file number, e.g. 160">',{req:isNew})
      +lmField('CNR No.','<input id="lmCnr" class="lm-in" value="'+esc(r.cnr_no||'')+'">',{req:isNew})
      +lmField('Incharge',lmPeopleSelect('lmIncharge',(r.pc_in_charge&&r.pc_in_charge!=='NA')?r.pc_in_charge:'',legal,false),{req:isNew})
      +lmField('Advocate',lmListSelect('lmAdvocate',r.advocate_incharge||'',LM.advocates),{req:isNew,full:true})
    +'</div>'
    +(isNew?'':lmHearingHistoryHtml(s.hs,true)));
  const sec3=lmCard(3,'Action','#b45309',isNew?lmActionFormHtml('lmA',today):lmActionListHtml(r,s,'case'));
  const sec4=lmCard(4,'Case Files','#0f766e','<div id="lmFilesHost"></div>'
      +'<button class="lm-btn" style="margin-top:12px" onclick="lmAddFiles('+(isNew?'null':id)+')"><i class="fa-solid fa-cloud-arrow-up"></i> Upload case files</button>',
      isNew?'<span style="color:#dc2626;font-weight:600">Required</span>':'');
  const missingOld=!isNew?[!r.case_type&&'Case Type',!(LM.actions[id]||[]).length&&'an Action'].filter(Boolean):[];
  body.innerHTML='<div class="lm-page">'
    +lmBackBar(isNew?'New case':esc(String(r.cause_title||'Case').replace(/\s+/g,' ')),
        isNew?'Fill in the case, its first hearing and the first action, and attach its files':esc([r.case_no,r.case_type,r.completed_at?'Disposed':''].filter(Boolean).join(' · ')))
    +sec1+sec2+sec3+sec4
    +'<div class="lm-foot">'+(missingOld.length?'<span class="lm-miss"><i class="fa-solid fa-circle-exclamation"></i> Still missing: '+missingOld.join(', ')+'</span>':'')
      +'<button class="lm-btn" onclick="lmGoBack()">Cancel</button><button class="lm-btn primary" id="lmSaveBtn" onclick="lmSaveCase('+(isNew?'null':id)+')"><i class="fa-solid fa-check"></i> Save</button></div>'
  +'</div>';
  lmDrawFiles(isNew?null:id);
}
function lmActionFormHtml(px,today,vals){
  vals=vals||{};
  return '<div class="lm-grid">'
    +lmField('Action Date',lmDateInput(px+'Date',vals.date||'',{min:today}),{req:true})
    +lmField('Action People',lmPeopleSelect(px+'Person',vals.person||'',lmActionPeople(),true),{req:true})
    +lmField('Action','<input id="'+px+'Text" class="lm-in" value="'+esc(vals.action||'')+'" placeholder="What has to be done - this becomes the task\u2019s title">',{req:true,full:true})
    +lmField('Action Remarks','<textarea id="'+px+'Rem" class="lm-in" rows="3" placeholder="Shown in the task\u2019s Updates & Feedback">'+esc(vals.remarks||'')+'</textarea>',{req:true,full:true})
  +'</div>';
}
function lmHearingHistoryHtml(hs,compact){
  if(!hs.length) return compact?'<div class="lm-empty" style="margin-top:14px">No hearing recorded yet</div>':'';
  return '<div style="margin-top:16px"><div style="font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--slate);margin-bottom:9px">Hearing history</div>'
    +hs.map((h,i)=>'<div class="lm-hcard'+(i===0?' lm-cur':'')+'"><div class="lm-hrow"><span class="lm-hdate">'+lmDmy(h.hearing_date)+'</span>'
      +(h.stage?'<span class="lm-stage">'+esc(h.stage)+'</span>':'<span class="lm-hmeta">Stage not given</span>')
      +'<span class="lm-hmeta" style="margin-left:auto"><i class="fa-solid fa-user"></i> '+esc(lmName(h.person))+'</span></div>'
      +(h.remarks?'<div class="lm-hrem">'+esc(h.remarks)+'</div>':'')+'</div>').join('')+'</div>';
}
function lmActionRemarks(a){ return (LM.comments[a.task_id]||[]).map(c=>c.body); }
function lmActionCardHtml(a,i,editable){
  const t=LM.tasks[a.task_id], done=lmTaskDone(t), date=String((t&&t.due_date)||a.action_date).slice(0,10);
  const doneDay=done?String(t.completed_at).slice(0,10):null;
  const pts=done?lmPoints(date,String(a.created_at).slice(0,10),lmIso(new Date(t.completed_at))):null;
  const rem=lmActionRemarks(a);
  const head='<div class="lm-hrow"><span class="lm-atext">'+esc(a.action)+'</span>'
    +'<span class="lm-status '+(done?'c':'p')+'">'+(done?'Completed':'Pending')+'</span>'+(done?lmPtsChip(pts):'')
    +(done?'<span class="lm-hmeta" style="font-size:11.5px">on '+lmDmy(doneDay)+'</span>':'')
    +'<span class="lm-hmeta" style="margin-left:auto"><i class="fa-regular fa-calendar"></i> '+lmDmy(date)+' · <i class="fa-solid fa-user"></i> '+esc(lmName(a.person))+'</span></div>';
  const remHtml=rem.length?'<div class="lm-hrem" style="color:var(--ink-2,#334155)">'+rem.map(x=>esc(x)).join('<br>')+'</div>':'';
  if(editable&&!done&&t){
    return '<div class="lm-acard lm-cur"><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><span class="lm-status p">Pending</span><span class="lm-hmeta">Open action - change it here and its task changes too</span></div>'
      +'<div class="lm-grid">'
        +lmField('Action Date',lmDateInput('lmCurDate',date,{min:lmToday()<date?lmToday():date}),{req:true})
        +lmField('Action People',lmPeopleSelect('lmCurPerson',a.person,lmActionPeople(),true),{req:true})
        +lmField('Action','<input id="lmCurText" class="lm-in" value="'+esc(a.action)+'">',{req:true,full:true})
      +'</div>'
      +'<input type="hidden" id="lmCurId" value="'+a.id+'">'
      +(rem.length?'<div style="margin-top:12px"><div class="lm-f"><label>Action Remarks</label></div>'+remHtml+'</div>':'')+'</div>';
  }
  return '<div class="lm-acard'+(done?' done':'')+(i===0?' lm-cur':'')+'">'+head+remHtml+'</div>';
}
function lmActionListHtml(r,s,where){
  const canAdd=!s.open;
  return '<div id="lmAddHost">'
      +'<div class="lm-addbar'+(canAdd?'':' off')+'" onclick="'+(canAdd?'lmShowAddAction('+r.id+',\''+where+'\')':'toast(\'The current action has to be completed (its task) before the next one is added\',\'warn\')')+'">'
        +'<i class="fa-solid fa-plus"></i> Add action'+(canAdd?'':' <span style="font-weight:500">- after the current one is completed</span>')+'</div></div>'
    +(s.as.length?s.as.map((a,i)=>lmActionCardHtml(a,i,where==='case'&&i===0)).join('')
      :'<div class="lm-empty">No action yet</div>');
}
window.lmShowAddAction=function(caseId,where){
  const host=$('lmAddHost'); if(!host) return;
  host.innerHTML='<div class="lm-acard lm-anew"><div style="font-weight:700;margin-bottom:12px"><i class="fa-solid fa-plus" style="color:#1e3a8a"></i> New action</div>'
    +lmActionFormHtml('lmN',lmToday())
    +'<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button class="lm-btn" onclick="'+(where==='case'?'misCasePage('+caseId+')':'misActionPage('+caseId+')')+'">Cancel</button>'
    +'<button class="lm-btn primary" onclick="lmAddAction('+caseId+',\''+where+'\',this)"><i class="fa-solid fa-paper-plane"></i> Add action</button></div></div>';
};
window.lmAddAction=async function(caseId,where,btn){
  const miss=lmRequire([['lmNDate','Action Date'],['lmNPerson','Action People'],['lmNText','Action'],['lmNRem','Action Remarks']]);
  if(miss.length){ toast('Still needed: '+miss.join(', '),'warn'); return; }
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Adding…'; }
  const {error}=await sb.rpc('legal_mis_add_action',{p_case:caseId,p_action:lmVal('lmNText'),p_date:lmVal('lmNDate'),p_person:lmVal('lmNPerson'),p_remarks:lmVal('lmNRem'),p_test:MIS_IS_TEST});
  if(error){ toast(error.message,'err'); if(btn){ btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Add action'; } return; }
  toast('Action added - a task has gone to '+lmName(lmVal('lmNPerson')),'ok');
  if(where==='case') misCasePage(caseId); else misActionPage(caseId);
};
window.lmSaveCase=async function(id){
  const isNew=!id;
  const today=lmToday();
  const req=[['lmCaseTitle','Case Title'],['lmCaseType','Case Type'],['lmCaseNo','Case No.'],['lmCourt','Court Name']];
  if(isNew) req.push(['lmHearDate','Hearing Date'],['lmHearRem','Hearing Remarks'],['lmLocation','Location'],['lmCnr','CNR No.'],['lmIncharge','Incharge'],['lmAdvocate','Advocate'],
    ['lmADate','Action Date'],['lmAPerson','Action People'],['lmAText','Action'],['lmARem','Action Remarks']);
  const miss=lmRequire(req);
  if(isNew&&!LMF.staged.length) miss.push('Case files');
  if(miss.length){ toast('Still needed: '+miss.join(', '),'warn'); return; }
  if(isNew&&lmVal('lmHearDate')<today){ toast('The Hearing Date cannot be in the past','warn'); return; }
  const btn=$('lmSaveBtn'); if(btn){ btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…'; }
  const restore=function(){ if(btn){ btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-check"></i> Save'; } };
  const row={cause_title:lmVal('lmCaseTitle'),case_type:lmVal('lmCaseType'),case_no:lmVal('lmCaseNo'),court:lmVal('lmCourt'),case_brief:lmVal('lmBrief')||null,
    file_no:lmVal('lmLocation')||null,cnr_no:lmVal('lmCnr')||null,pc_in_charge:lmVal('lmIncharge')||null,advocate_incharge:lmVal('lmAdvocate')||null};
  // a filing date picked here is saved; a left-blank one keeps whatever the case had ("NA" included)
  if(lmVal('lmFiling')) row.date_of_filing=lmDofText(lmVal('lmFiling'));
  try{
    await lmRememberList('mis_case_types',row.case_type); await lmRememberList('mis_courts',row.court);
    if(isNew){
      const maxRank=Math.max(0,...LM.rows.map(r=>Number(r.sort_rank)||0));
      Object.assign(row,{created_by:state.email,sort_rank:maxRank+10,case_next_date:lmVal('lmHearDate')});
      const {data:ins,error}=await sb.from(MIST('mis_cases')).insert(row).select('id').single();
      if(error) throw error;
      const cid=ins.id;
      const {error:he}=await sb.from(MIST('mis_hearings')).insert({case_id:cid,hearing_date:lmVal('lmHearDate'),person:state.email,remarks:lmVal('lmHearRem'),created_by:state.email});
      if(he) throw he;
      const {error:ae}=await sb.rpc('legal_mis_add_action',{p_case:cid,p_action:lmVal('lmAText'),p_date:lmVal('lmADate'),p_person:lmVal('lmAPerson'),p_remarks:lmVal('lmARem'),p_test:MIS_IS_TEST});
      if(ae) throw new Error('The case was saved, but the action was not: '+ae.message);
      try{ await lmUploadFiles(cid,LMF.pick||[],LMF.staged,t=>{ if(btn) btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> '+esc(t); }); }
      catch(ue){ throw new Error('The case was saved, but the files did not upload: '+((ue&&ue.message)||ue)); }
      LMF.staged=[]; LMF.pick=null;
      toast('Case added','ok');
      navTo('legal/mis');
      return;
    }
    const {error}=await sb.from(MIST('mis_cases')).update(row).eq('id',id);
    if(error) throw error;
    const curId=$('lmCurId');
    if(curId){
      const a=(LM.actions[id]||[]).find(x=>x.id===Number(curId.value));
      const nd=lmVal('lmCurDate'), np=lmVal('lmCurPerson'), nt=lmVal('lmCurText');
      const t=a&&LM.tasks[a.task_id];
      const oldDate=a?String((t&&t.due_date)||a.action_date).slice(0,10):'';
      if(a&&(nd!==oldDate||np.toLowerCase()!==String(a.person).toLowerCase()||nt!==a.action)){
        if(!nd||!np||!nt){ restore(); toast('The open action needs its date, person and wording','warn'); return; }
        const {error:ue}=await sb.rpc('legal_mis_update_action',{p_id:a.id,p_action:nt,p_date:nd,p_person:np,p_test:MIS_IS_TEST});
        if(ue) throw ue;
      }
    }
    toast('Case saved','ok');
    misCasePage(id);
  }catch(e){ restore(); toast((e&&e.message)||String(e),'err'); }
};

/* ---------------------------------------------------------------- THE HEARING PAGE */
async function misHearingPage(id){
  lmStyles();
  const body=$('legalBody'); if(!body) return;
  const hAct=$('legalHeadActions'); if(hAct) hAct.innerHTML='';
  loader(body);
  try{ await lmLoadLists(); await lmLoadAll(id); }catch(e){ body.innerHTML='<div class="lm-empty">Could not load: '+esc((e&&e.message)||e)+'</div>'; return; }
  const r=LM.rows.find(x=>x.id===id);
  if(!r){ body.innerHTML='<div class="lm-page">'+lmBackBar('Case not found')+'</div>'; return; }
  setCrumb(['Legal','MIS','Hearings']);
  const hs=LM.hearings[id]||[], legal=lmLegalPeople(), today=lmToday();
  body.innerHTML='<div class="lm-page">'
    +lmBackBar('<i class="fa-solid fa-gavel" style="color:#8b5cf6"></i> Hearings',esc(String(r.cause_title||'').replace(/\s+/g,' '))+(r.case_no?' · '+esc(r.case_no):''),
      '<button class="lm-btn" onclick="navTo(\'legal/mis/case/'+id+'\')"><i class="fa-solid fa-folder-open"></i> Open case</button>')
    +(r.case_brief?'<div class="lm-brief"><b>Case Brief</b>'+esc(r.case_brief)+'</div>':'')
    +'<div class="lm-hcard new"><div style="font-weight:700;margin-bottom:12px;color:var(--ink)"><i class="fa-solid fa-plus" style="color:var(--brand)"></i> Add a hearing date</div>'
      +'<div class="lm-grid">'
        +lmField('Hearing Date',lmDateInput('lmHDate','',{min:today}),{req:true})
        +lmField('Person',lmPeopleSelect('lmHPerson','',legal,true),{req:true})
        +lmField('Stage',lmListSelect('lmHStage','',LM_STAGES),{req:true,full:true})
        +lmField('Remarks','<textarea id="lmHRem" class="lm-in" rows="2" placeholder="What happened, or what is expected, at this hearing"></textarea>',{req:true,full:true})
      +'</div><div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="lm-btn primary" onclick="lmAddHearing('+id+',this)"><i class="fa-solid fa-plus"></i> Add hearing</button></div></div>'
    +(hs.length?hs.map((h,i)=>lmHearingCard(h,id,i===0)).join(''):'<div class="lm-empty">No hearings recorded yet</div>')
  +'</div>';
}
// One past hearing: its date as a small calendar block, who it is assigned to with their circle,
// the stage, and the remarks beneath.
function lmHearingCard(h,caseId,current){
  const d=new Date(String(h.hearing_date).slice(0,10)+'T12:00:00');
  const past=String(h.hearing_date).slice(0,10)<lmToday();
  const who=lmName(h.person);
  return '<div class="lm-hcard lm-hcard2'+(current?' lm-cur':(past?' past':''))+'" id="lmH'+h.id+'">'
    +'<div class="lm-hcal"><span class="m">'+d.toLocaleDateString('en-IN',{month:'short'})+'</span><span class="d">'+d.getDate()+'</span><span class="y">'+d.getFullYear()+'</span></div>'
    +'<div class="lm-hbody">'
      +'<div class="lm-hrow"><span class="lm-hdate">'+d.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})+'</span>'
        +(h.stage?'<span class="lm-stage">'+esc(h.stage)+'</span>':'<span class="lm-hmeta">Stage not given</span>')
        +'<button class="lm-btn" style="margin-left:auto;height:30px;font-size:12px" onclick="lmEditHearing('+h.id+','+caseId+')"><i class="fa-solid fa-pen"></i> Edit</button></div>'
      +'<div class="lm-hwho"><span class="lm-hwho-l">Assigned to</span>'+(h.person?avatar(who)+'<b>'+esc(who)+'</b>':'<span class="lm-hmeta">nobody yet</span>')+'</div>'
      +(h.remarks?'<div class="lm-hrem">'+esc(h.remarks)+'</div>':'')
    +'</div></div>';
}
window.lmAddHearing=async function(caseId,btn){
  const miss=lmRequire([['lmHDate','Hearing Date'],['lmHStage','Stage'],['lmHPerson','Person'],['lmHRem','Remarks']]);
  if(miss.length){ toast('Still needed: '+miss.join(', '),'warn'); return; }
  if(lmVal('lmHDate')<lmToday()){ toast('A new hearing date cannot be in the past','warn'); return; }
  if(btn) btn.disabled=true;
  const {error}=await sb.from(MIST('mis_hearings')).insert({case_id:caseId,hearing_date:lmVal('lmHDate'),stage:lmVal('lmHStage'),person:lmVal('lmHPerson'),remarks:lmVal('lmHRem'),created_by:state.email});
  if(error){ toast(error.message,'err'); if(btn) btn.disabled=false; return; }
  toast('Hearing added - it is now the case\u2019s Hearing Date','ok');
  misHearingPage(caseId);
};
window.lmEditHearing=function(hid,caseId){
  const h=(LM.hearings[caseId]||[]).find(x=>x.id===hid); const box=$('lmH'+hid); if(!h||!box) return;
  // The read view lays the card out side by side; the form needs the card's full width.
  box.classList.remove('lm-hcard2','past'); box.style.display='block';
  box.innerHTML='<div style="font-weight:700;margin-bottom:12px"><i class="fa-solid fa-pen" style="color:var(--brand)"></i> Edit this hearing</div>'+'<div class="lm-grid">'
      +lmField('Hearing Date',lmDateInput('lmE'+hid+'D',h.hearing_date),{req:true})
      +lmField('Person',lmPeopleSelect('lmE'+hid+'P',h.person||'',lmLegalPeople(),true),{req:true})
      +lmField('Stage',lmListSelect('lmE'+hid+'S',h.stage&&h.stage!=='NA'?h.stage:'',LM_STAGES),{req:true,full:true})
      /* Remarks stay required once a hearing has them. A hearing brought in from the old MIS with blank
         remarks (2 Nov 2026) may be saved blank - the new rule is for hearings added from now on. */
      +lmField('Remarks','<textarea id="lmE'+hid+'R" class="lm-in" rows="2">'+esc(h.remarks||'')+'</textarea>',(h.remarks&&String(h.remarks).trim())?{req:true,full:true}:{optional:true,full:true})
    +'</div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="lm-btn" onclick="misHearingPage('+caseId+')">Cancel</button>'
    +'<button class="lm-btn primary" onclick="lmSaveHearing('+hid+','+caseId+',this)"><i class="fa-solid fa-check"></i> Save</button></div>';
};
window.lmSaveHearing=async function(hid,caseId,btn){
  const p='lmE'+hid;
  const h0=(LM.hearings[caseId]||[]).find(x=>x.id===hid)||{};
  const need=[[p+'D','Hearing Date'],[p+'S','Stage'],[p+'P','Person']];
  if(h0.remarks&&String(h0.remarks).trim()) need.push([p+'R','Remarks']);   // see lmEditHearing
  const miss=lmRequire(need);
  if(miss.length){ toast('Still needed: '+miss.join(', '),'warn'); return; }
  if(btn) btn.disabled=true;
  const {error}=await sb.from(MIST('mis_hearings')).update({hearing_date:lmVal(p+'D'),stage:lmVal(p+'S'),person:lmVal(p+'P'),remarks:lmVal(p+'R'),updated_at:new Date().toISOString()}).eq('id',hid);
  if(error){ toast(error.message,'err'); if(btn) btn.disabled=false; return; }
  toast('Hearing updated','ok'); misHearingPage(caseId);
};

/* ---------------------------------------------------------------- THE ACTION PAGE */
async function misActionPage(id){
  lmStyles();
  const body=$('legalBody'); if(!body) return;
  const hAct=$('legalHeadActions'); if(hAct) hAct.innerHTML='';
  loader(body);
  try{ await lmLoadLists(); await lmLoadAll(id); }catch(e){ body.innerHTML='<div class="lm-empty">Could not load: '+esc((e&&e.message)||e)+'</div>'; return; }
  const r=LM.rows.find(x=>x.id===id);
  if(!r){ body.innerHTML='<div class="lm-page">'+lmBackBar('Case not found')+'</div>'; return; }
  setCrumb(['Legal','MIS','Actions']);
  const s=lmCaseState(r);
  const total=s.as.reduce((a,x)=>{ const t=LM.tasks[x.task_id]; if(!lmTaskDone(t)) return a;
    const p=lmPoints(String(t.due_date||x.action_date).slice(0,10),String(x.created_at).slice(0,10),lmIso(new Date(t.completed_at))); return a+(p||0); },0);
  body.innerHTML='<div class="lm-page">'
    +lmBackBar('<i class="fa-solid fa-bolt" style="color:#b45309"></i> Action Dates',esc(String(r.cause_title||'').replace(/\s+/g,' '))+(r.case_no?' · '+esc(r.case_no):''),
      '<span class="lm-hmeta">Score so far</span>'+lmPtsChip(total)+'<button class="lm-btn" onclick="navTo(\'legal/mis/case/'+id+'\')"><i class="fa-solid fa-folder-open"></i> Open case</button>')
    +(r.case_brief?'<div class="lm-brief"><b>Case Brief</b>'+esc(r.case_brief)+'</div>':'')
    +lmActionListHtml(r,s,'action')
    +'<div class="lm-hmeta" style="margin-top:14px;line-height:1.6"><b>How an action scores</b> (when its task is completed): after the Action Date <b>-1</b> · on the day or one day before <b>0</b> · earlier <b>+1</b> · seven or more days early <b>+2</b> (only when the action was given at least seven days).</div>'
  +'</div>';
}

/* ---------------------------------------------------------------- THE MIS SCORE */
async function legalScoreboardMIS(){
  const host=$('legalSbHost'); if(!host) return;
  loader(host);
  try{ LM.people=await getPeople(); }catch(e){}
  const {data,error}=await sb.rpc('legal_mis_scoreboard',{p_test:MIS_IS_TEST});
  if(error){ host.innerHTML='<div class="lm-empty">Could not load the scores: '+esc(error.message)+'</div>'; return; }
  const rows=data||[];
  lmStyles();
  host.innerHTML='<div class="card card-pad" style="margin-bottom:14px;font-size:13px;color:var(--slate);line-height:1.6">'
      +'Each MIS action scores the person it was given to when its task is completed, against the Action Date: '
      +'after the date <b>-1</b> · on the day or one day before <b>0</b> · earlier <b>+1</b> · seven or more days early <b>+2</b> (only when the action was given at least seven days).'
      +(MIS_IS_TEST?' <span class="lm-test">TEST DATA</span>':'')+'</div>'
    +(rows.length?'<div class="card" style="overflow:auto"><table class="tbl" style="width:100%"><thead><tr><th>#</th><th>Person</th><th>Actions</th><th>Completed</th><th>Pending</th><th>Score</th></tr></thead><tbody>'
      +rows.map((x,i)=>'<tr><td>'+(i+1)+'</td><td style="font-weight:600">'+esc(lmName(x.person))+'</td><td>'+x.assigned+'</td><td>'+x.completed+'</td><td>'+x.pending+'</td><td>'+lmPtsChip(x.score)+'</td></tr>').join('')
      +'</tbody></table></div>':'<div class="lm-empty">No actions have been given yet. Scores appear here once actions are added in MIS and their tasks are completed.</div>');
}
