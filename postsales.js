/* ============================ POST SALES — SETUP (Stage 1) ============================
   Project → Towers → Floors → Flats, PLC types (tagged on a tower's flat POSITION), floor rise (FRC),
   other charges (EDC etc.), parking types, construction stages and standard payment plans.
   Spec: docs/post-sales-spec.md §1. Tables: supabase/migrations/20261001120000_postsales_setup.sql.

   Loaded on demand by nexus-core.js (PAGE_EXTRA_SCRIPT.postsales) and directly by postsales.html, so it
   can run twice in one tab - everything is assigned onto window and the guard below skips a re-run.
   Route: postsales/setup/<projectId>/<section>[/<towerId>]. */
(function(){
if(window.__PSS_LOADED) return;
window.__PSS_LOADED=true;

const PS=()=>sb.schema('postsales');
const SECTIONS=[['project','Project & GST'],['towers','Towers & Flats'],['plc','PLC'],['charges','Charges'],['parking','Parking'],['stages','Stages'],['plans','Payment Plans'],['banks','Bank Accounts']];
const BASIS_LBL={per_sqft:'Per sq ft',fixed:'Fixed',pct_unit:'% of unit price'};
const STATUS_LBL={available:'Available',booked:'Booked',registered:'Registered',possession:'Possession',blocked:'Blocked'};
const TRIGGER_LBL={individual:'Individual',tower:'Tower level',floor:'Floor level'};
const S={projects:[],pid:null,sec:'project',towerId:null,setup:null,towers:[],positions:[],plcs:[],posPlcs:[],floors:[],flats:[],charges:[],parking:[],stages:[],plans:[],milestones:[],banks:[],portalUnits:0};

const num=v=>{const n=Number(v);return isFinite(n)?n:0;};
const val=id=>{const e=$(id);return e?String(e.value).trim():'';};
const numOrNull=id=>{const v=val(id);return v===''?null:Number(v);};
const intOrNull=id=>{const v=val(id);return v===''?null:parseInt(v,10);};
const inr=n=>{const v=Math.round(num(n));return v<0?'−'+custInr(-v):custInr(v);};
const rate=n=>(n==null||n==='')?'—':'₹'+num(n).toLocaleString('en-IN',{maximumFractionDigits:2});
const pct=n=>num(n).toLocaleString('en-IN',{maximumFractionDigits:3})+'%';
const ordinal=n=>{if(n===0)return 'Ground';const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);};
const go=(sec,tid)=>navTo('postsales/setup/'+S.pid+'/'+sec+(tid?'/'+tid:''));
const soft=()=>({deleted_at:new Date().toISOString(),deleted_by:state.email});
function fail(error,what){ if(error){ toast((what||'Save failed')+': '+error.message,'err'); return true; } return false; }

// Floor rise per sq ft for a floor of a tower: ₹20 from the 3rd floor → 3rd 20, 4th 40, 5th 60.
function frcFor(tower,floorNo){
  if(!tower||!num(tower.frc_rate)||tower.frc_start_floor==null) return 0;
  return Math.max(0,floorNo-tower.frc_start_floor+1)*num(tower.frc_rate);
}
function plcIdsFor(positionId){ return S.posPlcs.filter(x=>x.position_id===positionId).map(x=>x.plc_type_id); }
function plcRateFor(positionId){ const ids=plcIdsFor(positionId); return S.plcs.filter(p=>ids.includes(p.id)).reduce((s,p)=>s+num(p.rate),0); }

function css(){
  if($('pssCss')) return;
  const st=document.createElement('style'); st.id='pssCss';
  st.textContent=`
  .pss-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
  .pss-top select{height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font-size:13.5px;font-family:inherit;background:var(--bg-card,#fff);color:var(--ink);min-width:260px;max-width:100%}
  .pss-code{font-size:12px;font-weight:700;padding:3px 9px;border-radius:6px;background:#f5f3ff;color:#6d28d9}
  .pss-subs{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 16px}
  .pss-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .pss-hint{font-size:12.5px;color:var(--slate);margin:2px 0 12px}
  .pss-banner{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 14px;border:1px solid #ddd6fe;background:#faf5ff;border-radius:10px;margin-bottom:14px;font-size:13px}
  .pss-banner .grow{flex:1;min-width:220px}
  .pss-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
  .pss-card{border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--bg-card,#fff);cursor:pointer}
  .pss-card:hover{border-color:#c4b5fd}
  .pss-card h4{margin:0 0 6px;font-size:14px}
  .pss-card .m{font-size:12.5px;color:var(--slate)}
  .pss-grid{overflow:auto;border:1px solid var(--line);border-radius:10px;max-height:70vh}
  .pss-grid table{border-collapse:separate;border-spacing:0;font-size:12px;min-width:100%}
  .pss-grid th{position:sticky;top:0;background:var(--bg-card,#fff);z-index:1;padding:8px;border-bottom:1px solid var(--line);font-size:11px;color:var(--slate);text-transform:uppercase;letter-spacing:.4px}
  .pss-grid td{padding:4px;border-bottom:1px solid var(--line);text-align:center}
  .pss-grid td.fl{position:sticky;left:0;background:var(--bg-card,#fff);font-weight:700;padding:6px 10px;text-align:left;white-space:nowrap}
  .pss-flat{display:block;min-width:74px;padding:6px 4px;border-radius:7px;cursor:pointer;border:1px solid transparent;line-height:1.25}
  .pss-flat b{display:block;font-size:12.5px}
  .pss-flat span{font-size:10.5px;opacity:.8}
  .pss-flat.available{background:#ecfdf5;color:#065f46;border-color:#a7f3d0}
  .pss-flat.booked{background:#eff6ff;color:#1e40af;border-color:#bfdbfe}
  .pss-flat.registered{background:#f5f3ff;color:#5b21b6;border-color:#ddd6fe}
  .pss-flat.possession{background:#f1f5f9;color:#334155;border-color:#cbd5e1}
  .pss-flat.blocked{background:#fef2f2;color:#991b1b;border-color:#fecaca}
  .pss-legend{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;margin:10px 0}
  .pss-legend .pss-flat{display:inline-block;min-width:0;padding:2px 9px;cursor:default}
  .pss-ms{width:100%;border-collapse:collapse;font-size:12.5px}
  .pss-ms th{font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--slate);text-align:left;padding:6px 5px;border-bottom:1px solid var(--line);white-space:nowrap}
  .pss-ms td{padding:4px 5px;border-bottom:1px solid var(--line);vertical-align:middle}
  .pss-ms input,.pss-ms select{width:100%;border:1px solid var(--line);border-radius:6px;padding:6px 7px;font-size:12.5px;font-family:inherit;background:var(--bg-card,#fff);color:var(--ink)}
  .pss-ms input[type=checkbox]{width:auto}
  .pss-ms .n{width:78px}
  .pss-ms select[onchange*="trigger_type"]{min-width:118px}
  .pss-up{text-transform:uppercase}
  .pss-up::placeholder{text-transform:none}
  .pss-ms tfoot td{font-weight:700;border-top:2px solid var(--line)}
  .pss-bad{color:#b91c1c}.pss-ok{color:#15803d}
  .pss-plc-pick{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
  .pss-break{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
  .pss-break td{padding:6px 4px;border-bottom:1px solid var(--line)}
  .pss-break tr.t td{font-weight:700;border-top:2px solid var(--line)}
  @media (max-width:640px){ .pss-top select{min-width:0;width:100%} .frm .two{grid-template-columns:1fr} }

  /* ---- shared look for every Post Sales tab (.ps-root is set on each tab's host) ---- */
  .ps-root{--ps-brand:#6d28d9;--ps-brand-50:#f5f3ff}
  .ps-root a{color:var(--ps-brand);font-weight:600;text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:1px}
  .ps-root a:hover{text-decoration-thickness:2px}
  .ps-root .btn{border:1px solid #cbd5e1;box-shadow:0 1px 1.5px rgba(15,23,42,.06);font-weight:600;min-height:34px;display:inline-flex;align-items:center;gap:7px}
  .ps-root .btn-primary{border-color:transparent}
  .ps-root .btn-danger{border-color:transparent}
  .ps-root .btn-ghost{border-color:transparent;box-shadow:none}
  .ps-root .btn-sm{min-height:30px}
  .ps-root .tag{cursor:default;border-radius:6px;font-weight:600}
  .ps-root .tag[onclick]{cursor:pointer;text-decoration:underline;text-underline-offset:2px}
  .ps-root .toolbar{gap:10px;margin-bottom:14px}
  .ps-root .sec-title{font-size:15.5px}
  .ps-root .pss-hint{line-height:1.5}
  .ps-root table.tbl tr[onclick],.ps-root .psb-tbl tr[onclick]{cursor:pointer}
  .ps-root table.tbl tr[onclick]:hover td,.ps-root .psb-tbl tr[onclick]:hover td{background:var(--ps-brand-50)}
  .ps-root table.tbl tr[onclick] td:first-child b,.ps-root .psb-tbl tr[onclick] td:first-child b{color:var(--ps-brand)}
  .ps-root table.tbl tr[onclick] td:last-child::after,.ps-root .psb-tbl tr[onclick] td:last-child::after{content:'\\203A';color:#a78bfa;font-weight:700;font-size:18px;margin-left:10px;line-height:1}
  .ps-root .kpis{gap:12px}
  .ps-nav{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px;padding:4px;border:1px solid var(--line);border-radius:10px;background:var(--bg-card,#fff);width:max-content;max-width:100%}
  .ps-nav span{padding:7px 14px;border-radius:7px;font-size:13px;font-weight:600;color:#475569;cursor:pointer;display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
  .ps-nav span.on{background:var(--ps-brand);color:#fff}
  .ps-nav span:not(.on):hover{background:var(--ps-brand-50);color:var(--ps-brand)}
  .ps-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:14px}
  .ps-action{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--bg-card,#fff);display:flex;gap:12px;align-items:flex-start}
  .ps-action i.ic{width:34px;height:34px;border-radius:9px;background:var(--ps-brand-50);color:var(--ps-brand);display:inline-flex;align-items:center;justify-content:center;flex:none;font-size:15px}
  .ps-action .tx{flex:1;min-width:0}
  .ps-action .tx b{display:block;font-size:13.5px;margin-bottom:2px}
  .ps-action .tx div{font-size:12.5px;color:var(--slate);line-height:1.45;margin-bottom:10px}
  .ps-filters{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--bg-card,#fff);margin-bottom:14px}
  .ps-filters>*{flex:1 1 180px;min-width:0}
  .ps-filters select,.ps-filters input[type=date]{height:38px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font-size:13.5px;font-family:inherit;background:var(--bg-card,#fff);color:var(--ink);width:100%}
  .ps-filters .mu-sw{flex:2 1 240px}
  .ps-filters .mu-sw input{height:38px}
  .ps-filters label.fl{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;color:var(--slate);text-transform:uppercase;letter-spacing:.3px}
  .ps-filters label.fl .mu-sw{flex:none;width:100%}
  .ps-filters label.fl select{width:100%;max-width:none}
  .ps-root table.tbl td:first-child{font-weight:600}
  .ps-cards{display:none}
  .ps-card{border:1px solid var(--line);border-radius:12px;background:var(--bg-card,#fff);padding:12px 14px;margin-bottom:10px;cursor:pointer;position:relative}
  .ps-card:active{background:var(--ps-brand-50)}
  .ps-card .r1{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
  .ps-card .r1 b{color:var(--ps-brand);font-size:13.5px;word-break:break-all}
  .ps-card .r1 .amt{font-weight:700;font-size:14px;white-space:nowrap;font-variant-numeric:tabular-nums}
  .ps-card .r2{font-size:13px;margin-top:4px;color:var(--ink)}
  .ps-card .r3{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:12px;color:var(--slate);margin-top:8px;padding-right:16px}
  .ps-card::after{content:'\\203A';position:absolute;right:12px;bottom:10px;color:#a78bfa;font-size:20px;font-weight:700}
  .ps-more{display:flex;justify-content:center;gap:10px;align-items:center;margin:12px 0;font-size:12.5px;color:var(--slate)}
  @media (max-width:640px){ .ps-tablewrap{display:none} .ps-cards{display:block} }
  .ps-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
  .ps-head .t{flex:1 1 240px;min-width:0}
  .ps-head .t .sec-title{margin:0}
  .ps-head .acts{display:flex;gap:8px;flex-wrap:wrap}
  @media (max-width:720px){
    .ps-root .toolbar>select,.ps-root .toolbar>input,.ps-root .toolbar>.mu-sw,.ps-root .toolbar>label{flex:1 1 100%;max-width:none!important;width:100%}
    .ps-root .toolbar>.sec-title,.ps-root .toolbar>div[style*="flex:1"]{flex:1 1 100%}
    .ps-root .toolbar>.btn{flex:1 1 auto;justify-content:center}
    .ps-root .toolbar>.btn-ghost.btn-sm{flex:0 0 auto}
    .ps-root .kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px}
    .ps-root .kpi{padding:12px}
    .ps-root .kpi .val{font-size:18px;word-break:break-word}
    .ps-root .psb-sec{padding:14px 12px;border-radius:10px}
    .ps-root .psb-sec h3{flex-wrap:wrap;gap:8px}
    .ps-root .psb-grid{grid-template-columns:1fr}
    .ps-root .psb-span2{grid-column:auto}
    .ps-root .psb-bar{flex-wrap:wrap}
    .ps-root .psb-bar .btn{flex:1 1 auto;justify-content:center}
    .ps-root .psb-facts{gap:6px 14px;font-size:12.5px}
    .ps-root table.tbl{font-size:12.5px}
    .ps-root table.tbl th,.ps-root table.tbl td{padding:9px 10px}
    .ps-root .psb-sum{grid-template-columns:repeat(2,minmax(0,1fr))}
    .ps-head .acts{width:100%}
    .ps-head .acts .btn{flex:1 1 auto;justify-content:center}
    .ps-nav{width:100%}
    .ps-nav span{flex:1 1 auto;justify-content:center}
    .ps-filters{padding:10px}
    .ps-filters>*{flex:1 1 100%}
    .pss-cards{grid-template-columns:1fr}
    .pss-banner{font-size:12.5px}
  }
  `;
  document.head.appendChild(st);
}

/* ---------------- data ---------------- */
async function loadProjects(){
  const {data,error}=await sb.schema('cust').from('projects').select('id,name').is('deleted_at',null).order('name');
  if(error) toast('Could not load projects: '+error.message,'err');
  S.projects=data||[];
}
async function loadProject(pid){
  const q=t=>PS().from(t).select('*').eq('project_id',pid);
  const [setup,towers,plcs,charges,parking,stages,plans,units,banks]=await Promise.all([
    PS().from('project_setup').select('*').eq('project_id',pid).maybeSingle(),
    q('towers').is('deleted_at',null).order('sort_order').order('name'),
    q('plc_types').is('deleted_at',null).order('sort_order').order('name'),
    q('charges').is('deleted_at',null).order('sort_order').order('id'),
    q('parking_types').is('deleted_at',null).order('sort_order').order('id'),
    q('stages').is('deleted_at',null).order('sort_order').order('id'),
    q('payment_plans').is('deleted_at',null).order('sort_order').order('id'),
    sb.schema('cust').from('units').select('id',{count:'exact',head:true}).eq('project_id',pid).is('deleted_at',null),
    PS().from('bank_accounts').select('*').or('project_id.eq.'+pid+',project_id.is.null').is('deleted_at',null).order('id')
  ]);
  [setup,towers,plcs,charges,parking,stages,plans,banks].forEach(r=>{ if(r.error) toast('Could not load setup: '+r.error.message,'err'); });
  S.banks=banks.data||[];
  S.setup=setup.data||null; S.towers=towers.data||[]; S.plcs=plcs.data||[]; S.charges=charges.data||[];
  S.parking=parking.data||[]; S.stages=stages.data||[]; S.plans=plans.data||[]; S.portalUnits=units.count||0;
  const tids=S.towers.map(t=>t.id), planIds=S.plans.map(p=>p.id);
  const none=[-1];
  const [pos,floors,flats,ms]=await Promise.all([
    PS().from('tower_positions').select('*').in('tower_id',tids.length?tids:none).order('sort_order').order('code'),
    PS().from('floors').select('*').in('tower_id',tids.length?tids:none).order('floor_no'),
    PS().from('flats').select('*').in('tower_id',tids.length?tids:none).is('deleted_at',null),
    PS().from('plan_milestones').select('*').in('plan_id',planIds.length?planIds:none).order('seq')
  ]);
  S.positions=pos.data||[]; S.floors=floors.data||[]; S.flats=flats.data||[]; S.milestones=ms.data||[];
  const posIds=S.positions.map(p=>p.id);
  const pp=await PS().from('position_plcs').select('*').in('position_id',posIds.length?posIds:none);
  S.posPlcs=pp.data||[];
}

/* ---------------- shell ---------------- */
// Every save re-renders via route(), and a second render can start while the first is still awaiting
// its queries - only the newest one may touch the page, or the older one writes into elements the newer
// one has already replaced.
let RENDER_SEQ=0;
window.pssRender=async function(host,seg){
  host.classList.add('ps-root');
  css();
  seg=seg||[];
  const mine=++RENDER_SEQ, stale=()=>mine!==RENDER_SEQ||!host.isConnected;
  loader(host);
  if(!S.projects.length) await loadProjects();
  if(stale()) return;
  const pid=parseInt(seg[0],10);
  S.pid=S.projects.some(p=>p.id===pid)?pid:null;
  S.sec=SECTIONS.some(s=>s[0]===seg[1])?seg[1]:'project';
  S.towerId=parseInt(seg[2],10)||null;
  const opts='<option value="">Choose a project…</option>'+S.projects.map(p=>'<option value="'+p.id+'"'+(p.id===S.pid?' selected':'')+'>'+esc(p.name)+'</option>').join('');
  const top='<div class="pss-top"><select onchange="pssPickProject(this.value)">'+opts+'</select><span id="pssCodeBadge"></span></div>';
  if(!S.pid){ host.innerHTML=top+'<div id="pssOverview"></div>'; await renderOverview(); return; }
  await loadProject(S.pid);
  if(stale()) return;
  host.innerHTML=top
    +'<div class="pss-subs">'+SECTIONS.map(s=>'<span class="chip'+(s[0]===S.sec?' active':'')+'" onclick="pssGo(\''+s[0]+'\')">'+esc(s[1])+'</span>').join('')+'</div>'
    +'<div id="pssSec"></div>';
  $('pssCodeBadge').innerHTML=S.setup?'<span class="pss-code">'+esc(S.setup.code)+'</span>':'<span class="tag t-amber">Not set up yet</span>';
  const sec=$('pssSec');
  if(S.sec!=='project'&&!S.setup){ sec.innerHTML='<div class="pss-banner"><i class="fa-solid fa-circle-info"></i><div class="grow">Give this project a short code and its GST rates first - every document number uses the code.</div><button class="btn btn-primary btn-sm" onclick="pssGo(\'project\')">Set up project</button></div>'; return; }
  if(S.sec==='project') renderProjectSec(sec);
  else if(S.sec==='towers') (S.towerId?renderTowerDetail(sec):renderTowers(sec));
  else if(S.sec==='plc') renderPlc(sec);
  else if(S.sec==='charges') renderCharges(sec);
  else if(S.sec==='parking') renderParking(sec);
  else if(S.sec==='stages') renderStages(sec);
  else if(S.sec==='banks') renderBanks(sec);
  else renderPlans(sec);
};
window.pssPickProject=function(id){ navTo('postsales/setup'+(id?'/'+id+'/'+(S.sec||'project'):'')); };
window.pssGo=function(sec){ go(sec); };

async function renderOverview(){
  const host=$('pssOverview'); if(!host) return;
  const [setups,towers,flats]=await Promise.all([
    PS().from('project_setup').select('project_id,code'),
    PS().from('towers').select('id,project_id').is('deleted_at',null),
    PS().from('flats').select('tower_id,status').is('deleted_at',null)
  ]);
  const codeBy={};(setups.data||[]).forEach(s=>codeBy[s.project_id]=s.code);
  const towerProj={};(towers.data||[]).forEach(t=>towerProj[t.id]=t.project_id);
  const stat={};(flats.data||[]).forEach(f=>{const p=towerProj[f.tower_id];if(!p)return;stat[p]=stat[p]||{n:0,a:0};stat[p].n++;if(f.status==='available')stat[p].a++;});
  const tCount={};(towers.data||[]).forEach(t=>tCount[t.project_id]=(tCount[t.project_id]||0)+1);
  host.innerHTML='<div class="pss-hint">Pick a project to set up its towers, flats, PLC, floor rise, charges, parking and payment plans.</div>'
    +'<div class="pss-cards">'+S.projects.map(p=>{
      const st=stat[p.id];
      return '<div class="pss-card" onclick="pssPickProject('+p.id+')"><h4>'+esc(p.name)+'</h4>'
        +'<div class="m">'+(codeBy[p.id]?'<span class="pss-code">'+esc(codeBy[p.id])+'</span> ':'<span class="tag t-amber">Not set up</span> ')
        +(tCount[p.id]||0)+' tower'+(tCount[p.id]===1?'':'s')+(st?' · '+st.n+' flats · '+st.a+' available':'')+'</div></div>';
    }).join('')+'</div>';
}

/* ---------------- Project & GST ---------------- */
function renderProjectSec(host){
  const s=S.setup||{code:'',unit_gst_rate:5,plc_gst_rate:5,frc_gst_rate:5};
  const proj=S.projects.find(p=>p.id===S.pid);
  host.innerHTML='<div class="card" style="max-width:640px;padding:18px 20px"><div class="sec-title">'+esc(proj?proj.name:'')+'</div>'
    +'<div class="pss-hint">The code starts every document number for this project - receipts DG/MR/26-27/0001, invoices DG/INV/26-27/0001.</div>'
    +'<div class="frm"><label>Project code</label><input id="pssCode" maxlength="8" value="'+esc(s.code||'')+'" placeholder="e.g. DG" class="pss-up" style="max-width:200px">'
    +'<div class="sec-title" style="margin-top:18px">GST rates (%)</div>'
    +'<div class="two"><div><label>Unit price</label><input id="pssGstUnit" type="number" step="0.01" value="'+esc(s.unit_gst_rate)+'"></div>'
    +'<div><label>PLC</label><input id="pssGstPlc" type="number" step="0.01" value="'+esc(s.plc_gst_rate)+'"></div></div>'
    +'<div class="two"><div><label>Floor rise (FRC)</label><input id="pssGstFrc" type="number" step="0.01" value="'+esc(s.frc_gst_rate)+'"></div><div></div></div>'
    +'<label>Company name on receipts and invoices</label><input id="pssCompany" value="'+esc(s.company_name||'')+'" placeholder="e.g. Dream Gateway Hotels Ltd.">'
    +'<div class="pss-hint" style="margin-top:10px">Parking and each charge carry their own GST rate, set in those sections.</div>'
    +'<button class="btn btn-primary" style="margin-top:6px" onclick="pssSaveProject()"><i class="fa-solid fa-floppy-disk"></i> Save</button></div></div>';
}
window.pssSaveProject=async function(){
  const code=val('pssCode').toUpperCase();
  if(!/^[A-Z0-9]{1,8}$/.test(code)){ toast('Use 1-8 letters or digits for the code, e.g. DG','err'); return; }
  const row={project_id:S.pid,code,unit_gst_rate:num(val('pssGstUnit')),plc_gst_rate:num(val('pssGstPlc')),frc_gst_rate:num(val('pssGstFrc')),company_name:val('pssCompany')||null,updated_at:new Date().toISOString(),updated_by:state.email};
  const {error}=await PS().from('project_setup').upsert(row,{onConflict:'project_id'});
  if(error&&/project_setup_code_uq/.test(error.message)){ toast('Another project already uses the code '+code,'err'); return; }
  if(fail(error)) return;
  toast('Project saved','ok'); route();
};

/* ---------------- Towers ---------------- */
function towerStats(tid){
  const f=S.flats.filter(x=>x.tower_id===tid);
  return {n:f.length,a:f.filter(x=>x.status==='available').length,b:f.filter(x=>x.status!=='available'&&x.status!=='blocked').length};
}
function renderTowers(host){
  const banner=(!S.towers.length&&S.portalUnits)
    ?'<div class="pss-banner"><i class="fa-solid fa-wand-magic-sparkles" style="color:#7c3aed"></i><div class="grow"><b>'+S.portalUnits+' bookings</b> for this project are already in the Customer Portal. Build the towers, flat positions and flats from them - floor and position come from each unit code (5A = 5th floor, flat A), areas from the bookings, and booked flats are marked booked. You can edit everything afterwards.</div><button class="btn btn-primary btn-sm" onclick="pssFromPortal()"><i class="fa-solid fa-wand-magic-sparkles"></i> Build from portal data</button></div>':'';
  const rows=S.towers.map(t=>{
    const st=towerStats(t.id), np=S.positions.filter(p=>p.tower_id===t.id).length;
    return '<tr><td><a href="javascript:void 0" onclick="pssGo2(\'towers\','+t.id+')"><b>'+esc(t.name)+'</b></a>'+(t.portal_tower&&t.portal_tower.toLowerCase()!==t.name.toLowerCase()?'<div class="pss-hint" style="margin:0">Portal: '+esc(t.portal_tower)+'</div>':'')+'</td>'
      +'<td>'+esc(ordinal(t.floor_from))+' – '+esc(ordinal(t.floor_to))+'</td><td class="pss-num">'+np+'</td><td class="pss-num">'+st.n+'</td>'
      +'<td class="pss-num"><span class="tag t-green">'+st.a+'</span> <span class="tag t-blue">'+st.b+'</span></td>'
      +'<td class="pss-num">'+rate(t.base_rate)+'</td>'
      +'<td>'+(num(t.frc_rate)&&t.frc_start_floor!=null?rate(t.frc_rate)+'/floor from '+esc(ordinal(t.frc_start_floor)):'—')+'</td>'
      +'<td style="white-space:nowrap"><button class="btn btn-sm" onclick="pssGo2(\'towers\','+t.id+')"><i class="fa-solid fa-table-cells"></i> Open</button> <button class="btn btn-sm btn-ghost" title="Edit" onclick="pssTowerModal('+t.id+')"><i class="fa-solid fa-pen"></i></button> <button class="btn btn-sm btn-ghost" title="Delete" onclick="pssTowerDelete('+t.id+')"><i class="fa-solid fa-trash"></i></button></td></tr>';
  }).join('');
  host.innerHTML=banner
    +'<div class="toolbar"><div class="sec-title" style="margin:0;flex:1">Towers</div><button class="btn btn-primary" onclick="pssTowerModal()"><i class="fa-solid fa-plus"></i> New tower</button></div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Tower</th><th>Floors</th><th class="pss-num">Positions</th><th class="pss-num">Flats</th><th class="pss-num">Available / Booked</th><th class="pss-num">List rate /sq ft</th><th>Floor rise (FRC)</th><th></th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="8"><div class="empty"><i class="fa-solid fa-building"></i><div>No towers yet</div></div></td></tr>')+'</tbody></table></div></div>';
}
window.pssGo2=function(sec,id){ go(sec,id); };
window.pssFromPortal=async function(){
  const {data,error}=await PS().rpc('setup_from_portal',{p_project_id:S.pid});
  if(fail(error,'Could not build from portal data')) return;
  const sk=(data&&data.skipped)||[];
  toast((data.towers_created||0)+' towers and '+(data.flats_total||0)+' flats created'+(sk.length?' · '+sk.length+' unit codes skipped':''),'ok');
  if(sk.length) openModal('<div class="modal-head"><h3>Units to add by hand</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body"><div class="pss-hint">These unit codes don\'t follow the floor + position pattern (e.g. 5A), so they weren\'t placed on a floor. Add them as flats on the right tower and floor.</div><div style="max-height:50vh;overflow:auto;font-size:13px">'+sk.map(x=>'<div>'+esc(x)+'</div>').join('')+'</div></div><div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">OK</button></div>');
  route();
};
window.pssTowerModal=function(id){
  const t=id?S.towers.find(x=>x.id===id):null;
  openModal('<div class="modal-head"><h3>'+(t?'Edit tower':'New tower')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm">'
    +'<div class="two"><div><label>Tower / block name</label><input id="pssTName" value="'+esc(t?t.name:'')+'" placeholder="Block A1"></div>'
    +'<div><label>Name in Customer Portal (optional)</label><input id="pssTPortal" value="'+esc(t&&t.portal_tower||'')+'" placeholder="BLOCK A1"></div></div>'
    +'<div class="two"><div><label>Lowest floor with flats</label><input id="pssTFrom" type="number" value="'+(t?t.floor_from:1)+'"></div>'
    +'<div><label>Top floor</label><input id="pssTTo" type="number" value="'+(t?t.floor_to:'')+'" placeholder="e.g. 7"></div></div>'
    +'<div class="pss-hint" style="margin-top:6px">Use 0 for the ground floor.</div>'
    +'<label>List rate per sq ft (super built-up)</label><input id="pssTRate" type="number" step="0.01" value="'+(t&&t.base_rate!=null?t.base_rate:'')+'" placeholder="e.g. 5399">'
    +'<div class="sec-title" style="margin-top:18px">Floor rise (FRC)</div>'
    +'<div class="two"><div><label>Rate per sq ft per floor</label><input id="pssTFrc" type="number" step="0.01" value="'+(t?num(t.frc_rate)||'':'')+'" placeholder="e.g. 20"></div>'
    +'<div><label>Starting from floor</label><input id="pssTFrcStart" type="number" value="'+(t&&t.frc_start_floor!=null?t.frc_start_floor:'')+'" placeholder="e.g. 3"></div></div>'
    +'<div class="pss-hint" style="margin-top:6px" id="pssTFrcEg"></div>'
    +'</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pssTowerSave('+(t?t.id:'null')+')">Save</button></div>');
  const eg=()=>{const r=num(val('pssTFrc')),s=intOrNull('pssTFrcStart');$('pssTFrcEg').textContent=(r&&s!=null)?('e.g. '+[0,1,2].map(i=>ordinal(s+i)+' floor ₹'+(r*(i+1)).toLocaleString('en-IN')+'/sq ft').join(' · ')):'';};
  ['pssTFrc','pssTFrcStart'].forEach(i=>$(i).addEventListener('input',eg)); eg();
};
window.pssTowerSave=async function(id){
  const name=val('pssTName'), from=intOrNull('pssTFrom'), to=intOrNull('pssTTo');
  if(!name){ toast('Enter the tower name','err'); return; }
  if(from==null||to==null||to<from){ toast('Enter the lowest and top floor (top ≥ lowest)','err'); return; }
  const row={name,portal_tower:val('pssTPortal')||null,floor_from:from,floor_to:to,base_rate:numOrNull('pssTRate'),frc_rate:num(val('pssTFrc')),frc_start_floor:intOrNull('pssTFrcStart'),updated_at:new Date().toISOString()};
  const {error}=id?await PS().from('towers').update(row).eq('id',id):await PS().from('towers').insert({...row,project_id:S.pid,sort_order:S.towers.length});
  if(error&&/towers_project_name_uq/.test(error.message)){ toast('This project already has a tower called '+name,'err'); return; }
  if(fail(error)) return;
  closeModal(); toast('Tower saved','ok'); route();
};
window.pssTowerDelete=async function(id){
  const t=S.towers.find(x=>x.id===id), st=towerStats(id);
  if(st.b){ toast(t.name+' has '+st.b+' booked flats - it can\'t be deleted','err'); return; }
  if(!await confirmDialog('Delete '+t.name+' and its '+st.n+' flats?')) return;
  const {error}=await PS().from('towers').update(soft()).eq('id',id);
  if(fail(error,'Delete failed')) return;
  await PS().from('flats').update(soft()).eq('tower_id',id).is('deleted_at',null);
  toast('Tower deleted','ok'); go('towers');
};

/* ---------------- Tower detail: positions + flats grid ---------------- */
function renderTowerDetail(host){
  const t=S.towers.find(x=>x.id===S.towerId);
  if(!t){ host.innerHTML='<div class="empty"><div>Tower not found</div></div>'; return; }
  const pos=S.positions.filter(p=>p.tower_id===t.id);
  const plcName=id=>{const p=S.plcs.find(x=>x.id===id);return p?p.name:'';};
  const posRows=pos.map(p=>'<tr><td><b>'+esc(p.code)+'</b></td><td>'+esc(p.bhk||'—')+'</td><td class="pss-num">'+(p.sba_sqft!=null?num(p.sba_sqft):'—')+'</td><td class="pss-num">'+(p.built_up_sqft!=null?num(p.built_up_sqft):'—')+'</td><td class="pss-num">'+(p.carpet_sqft!=null?num(p.carpet_sqft):'—')+'</td>'
    +'<td>'+(plcIdsFor(p.id).map(i=>'<span class="tag t-purple">'+esc(plcName(i))+'</span>').join(' ')||'<span style="color:var(--slate)">—</span>')+'</td>'
    +'<td class="pss-num">'+(plcRateFor(p.id)?rate(plcRateFor(p.id)):'—')+'</td>'
    +'<td style="white-space:nowrap"><button class="btn btn-sm btn-ghost" title="Edit" onclick="pssPosModal('+p.id+')"><i class="fa-solid fa-pen"></i></button> <button class="btn btn-sm btn-ghost" title="Delete" onclick="pssPosDelete('+p.id+')"><i class="fa-solid fa-trash"></i></button></td></tr>').join('');
  const st=towerStats(t.id);
  host.innerHTML='<div class="toolbar"><button class="btn btn-sm btn-ghost" onclick="pssGo(\'towers\')"><i class="fa-solid fa-arrow-left"></i> Towers</button><div class="sec-title" style="margin:0;flex:1">'+esc(t.name)+'</div><button class="btn btn-sm" onclick="pssTowerModal('+t.id+')"><i class="fa-solid fa-pen"></i> Edit tower</button></div>'
    +mKpis([['Floors',ordinal(t.floor_from)+' – '+ordinal(t.floor_to),(t.floor_to-t.floor_from+1)+' floors'],['Flats',String(st.n),st.a+' available · '+st.b+' booked'],['List rate',t.base_rate!=null?rate(t.base_rate):'—','per sq ft'],['Floor rise',num(t.frc_rate)&&t.frc_start_floor!=null?rate(t.frc_rate):'—',t.frc_start_floor!=null&&num(t.frc_rate)?'per floor from '+ordinal(t.frc_start_floor):'not set']])
    +'<div class="toolbar" style="margin-top:16px"><div style="flex:1"><div class="sec-title" style="margin:0">Flat positions on a typical floor</div><div class="pss-hint" style="margin:0">PLC is tagged here - every flat in that position on every floor carries it.</div></div><button class="btn" onclick="pssPosModal()"><i class="fa-solid fa-plus"></i> Add position</button><button class="btn btn-primary" onclick="pssGenerate('+t.id+')"><i class="fa-solid fa-layer-group"></i> Generate floors &amp; flats</button></div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Position</th><th>BHK</th><th class="pss-num">Super built-up</th><th class="pss-num">Built-up</th><th class="pss-num">Carpet</th><th>PLC</th><th class="pss-num">PLC /sq ft</th><th></th></tr></thead><tbody>'
    +(posRows||'<tr><td colspan="8"><div class="empty" style="padding:24px"><div>Add the flat positions of a typical floor (A, B, C …)</div></div></td></tr>')+'</tbody></table></div></div>'
    +'<div class="sec-title" style="margin-top:20px">Flats</div>'
    +'<div class="pss-legend">'+Object.keys(STATUS_LBL).map(k=>'<span class="pss-flat '+k+'">'+STATUS_LBL[k]+'</span>').join('')+'</div>'
    +flatGrid(t);
}
function flatGrid(t){
  const floors=S.floors.filter(f=>f.tower_id===t.id).sort((a,b)=>b.floor_no-a.floor_no);
  const flats=S.flats.filter(f=>f.tower_id===t.id);
  if(!flats.length) return '<div class="empty" style="padding:24px"><div>No flats yet - add positions, then Generate floors &amp; flats.</div></div>';
  const posCodes=S.positions.filter(p=>p.tower_id===t.id).map(p=>p.code.toUpperCase());
  // Positions in the layout first, then any one-off flat codes (added by hand) that aren't.
  const suffix=f=>{const fl=S.floors.find(x=>x.id===f.floor_id);const c=f.flat_code.toUpperCase();return fl&&c.startsWith(String(fl.floor_no))?c.slice(String(fl.floor_no).length):c;};
  const extra=[...new Set(flats.map(suffix))].filter(c=>!posCodes.includes(c)).sort();
  const cols=posCodes.concat(extra);
  return '<div class="pss-grid"><table><thead><tr><th style="left:0;z-index:2">Floor</th>'+cols.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'
    +floors.map(fl=>'<tr><td class="fl">'+esc(fl.label||ordinal(fl.floor_no))+'</td>'+cols.map(c=>{
      const f=flats.find(x=>x.floor_id===fl.id&&suffix(x)===c);
      return '<td>'+(f?'<span class="pss-flat '+f.status+'" onclick="pssFlatModal('+f.id+')" title="'+esc(STATUS_LBL[f.status])+'"><b>'+esc(f.flat_code)+'</b><span>'+(f.sba_sqft!=null?num(f.sba_sqft)+' sq ft':'—')+'</span></span>':'')+'</td>';
    }).join('')+'</tr>').join('')
    +'</tbody></table></div>'
    +'<div style="margin-top:10px"><button class="btn btn-sm" onclick="pssFlatModal(null)"><i class="fa-solid fa-plus"></i> Add a one-off flat</button></div>';
}
window.pssGenerate=async function(tid){
  if(!S.positions.some(p=>p.tower_id===tid)){ toast('Add at least one flat position first','err'); return; }
  const {data,error}=await PS().rpc('generate_tower_flats',{p_tower_id:tid});
  if(fail(error,'Could not generate flats')) return;
  toast(data?data+' new flats created':'Every floor already has all its flats','ok'); route();
};
window.pssPosModal=function(id){
  const p=id?S.positions.find(x=>x.id===id):null, sel=p?plcIdsFor(p.id):[];
  openModal('<div class="modal-head"><h3>'+(p?'Edit position '+esc(p.code):'Add flat position')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm"><div class="two"><div><label>Position</label><input id="pssPCode" maxlength="6" value="'+esc(p?p.code:'')+'" placeholder="C" class="pss-up"></div><div><label>BHK</label><input id="pssPBhk" value="'+esc(p&&p.bhk||'')+'" placeholder="2BHK"></div></div>'
    +'<label>Super built-up area (sq ft)</label><input id="pssPSba" type="number" step="0.01" value="'+(p&&p.sba_sqft!=null?p.sba_sqft:'')+'">'
    +'<div class="two"><div><label>Built-up (sq ft)</label><input id="pssPBu" type="number" step="0.01" value="'+(p&&p.built_up_sqft!=null?p.built_up_sqft:'')+'"></div><div><label>Carpet (sq ft)</label><input id="pssPCa" type="number" step="0.01" value="'+(p&&p.carpet_sqft!=null?p.carpet_sqft:'')+'"></div></div>'
    +'<label>PLC</label>'+(S.plcs.length?'<div class="pss-plc-pick">'+S.plcs.map(x=>'<label class="chip'+(sel.includes(x.id)?' active':'')+'" style="margin:0;font-weight:500"><input type="checkbox" class="pssPlcBox" value="'+x.id+'"'+(sel.includes(x.id)?' checked':'')+' style="width:auto;margin:0" onchange="this.parentNode.classList.toggle(\'active\',this.checked)"> '+esc(x.name)+' · '+rate(x.rate)+'</label>').join('')+'</div>':'<div class="pss-hint">No PLC types yet - add them in the PLC section.</div>')
    +(p?'<div class="pss-hint" style="margin-top:10px">Changed areas apply to new flats. Tick "Also update existing available flats" to copy them onto flats already generated.</div><label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="pssPApply" style="width:auto"> Also update existing available flats in this position</label>':'')
    +'</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pssPosSave('+(p?p.id:'null')+')">Save</button></div>');
};
window.pssPosSave=async function(id){
  const code=val('pssPCode').toUpperCase();
  if(!/^[A-Z][A-Z0-9]{0,5}$/.test(code)){ toast('Position should start with a letter, e.g. A, C or E2','err'); return; }
  const row={code,bhk:val('pssPBhk')||null,sba_sqft:numOrNull('pssPSba'),built_up_sqft:numOrNull('pssPBu'),carpet_sqft:numOrNull('pssPCa')};
  let pid=id, error;
  if(id){ ({error}=await PS().from('tower_positions').update(row).eq('id',id)); }
  else{ const r=await PS().from('tower_positions').insert({...row,tower_id:S.towerId,sort_order:S.positions.filter(p=>p.tower_id===S.towerId).length}).select('id').single(); error=r.error; pid=r.data&&r.data.id; }
  if(error&&/tower_positions_code_uq/.test(error.message)){ toast('Position '+code+' already exists in this tower','err'); return; }
  if(fail(error)) return;
  const picked=[...document.querySelectorAll('.pssPlcBox:checked')].map(x=>Number(x.value));
  const del=await PS().from('position_plcs').delete().eq('position_id',pid);
  if(fail(del.error,'Could not save PLC')) return;
  if(picked.length){ const ins=await PS().from('position_plcs').insert(picked.map(x=>({position_id:pid,plc_type_id:x}))); if(fail(ins.error,'Could not save PLC')) return; }
  if(id&&$('pssPApply')&&$('pssPApply').checked){
    await PS().from('flats').update({bhk:row.bhk,sba_sqft:row.sba_sqft,built_up_sqft:row.built_up_sqft,carpet_sqft:row.carpet_sqft,updated_at:new Date().toISOString()}).eq('position_id',id).eq('status','available').is('deleted_at',null);
  }
  closeModal(); toast('Position saved','ok'); route();
};
window.pssPosDelete=async function(id){
  const p=S.positions.find(x=>x.id===id), fl=S.flats.filter(f=>f.position_id===id);
  if(fl.some(f=>f.status!=='available'&&f.status!=='blocked')){ toast('Position '+p.code+' has booked flats - it can\'t be deleted','err'); return; }
  if(!await confirmDialog('Delete position '+p.code+(fl.length?' and its '+fl.length+' flats':'')+'?')) return;
  if(fl.length){ const r=await PS().from('flats').update(soft()).eq('position_id',id).is('deleted_at',null); if(fail(r.error,'Delete failed')) return; }
  const {error}=await PS().from('tower_positions').delete().eq('id',id);
  if(fail(error,'Delete failed')) return;
  toast('Position deleted','ok'); route();
};

// Indicative price of a flat at the tower's list rate - the real one is built at booking.
function priceBreak(f,t){
  const fl=S.floors.find(x=>x.id===f.floor_id), sba=num(f.sba_sqft), g=S.setup||{};
  const lines=[];
  const unit=num(t.base_rate)*sba, plcR=f.position_id?plcRateFor(f.position_id):0, plc=plcR*sba, frcR=fl?frcFor(t,fl.floor_no):0, frc=frcR*sba;
  lines.push(['Unit price','₹'+num(t.base_rate).toLocaleString('en-IN')+' × '+sba,unit,num(g.unit_gst_rate)]);
  if(plc) lines.push(['PLC',rate(plcR)+' × '+sba,plc,num(g.plc_gst_rate)]);
  if(frc) lines.push(['Floor rise',rate(frcR)+' × '+sba,frc,num(g.frc_gst_rate)]);
  S.charges.filter(c=>c.charge_group==='edc').forEach(c=>{
    const amt=c.basis==='per_sqft'?num(c.rate)*sba:c.basis==='fixed'?num(c.rate):unit*num(c.rate)/100;
    if(amt) lines.push([c.name,c.basis==='per_sqft'?rate(c.rate)+' × '+sba:c.basis==='fixed'?'Fixed':pct(c.rate)+' of unit',amt,num(c.gst_rate)]);
  });
  let tot=0,gst=0;
  const rows=lines.map(l=>{const tx=l[2]*l[3]/100;tot+=l[2];gst+=tx;return '<tr><td>'+esc(l[0])+'<div class="pss-hint" style="margin:0">'+esc(l[1])+' · GST '+l[3]+'%</div></td><td class="pss-num">'+inr(l[2])+'</td><td class="pss-num">'+inr(tx)+'</td></tr>';}).join('');
  return '<table class="pss-break"><tr><td style="color:var(--slate);font-size:11.5px">At list rate, before parking/discount</td><td class="pss-num" style="color:var(--slate);font-size:11.5px">Amount</td><td class="pss-num" style="color:var(--slate);font-size:11.5px">GST</td></tr>'+rows+'<tr class="t"><td>Total</td><td class="pss-num">'+inr(tot)+'</td><td class="pss-num">'+inr(gst)+'</td></tr><tr class="t"><td>Gross</td><td></td><td class="pss-num">'+inr(tot+gst)+'</td></tr></table>';
}
window.pssFlatModal=function(id){
  const t=S.towers.find(x=>x.id===S.towerId), f=id?S.flats.find(x=>x.id===id):null;
  const floors=S.floors.filter(x=>x.tower_id===t.id).sort((a,b)=>a.floor_no-b.floor_no);
  const pos=S.positions.filter(p=>p.tower_id===t.id);
  const statusOpts=Object.keys(STATUS_LBL).map(k=>'<option value="'+k+'"'+(f&&f.status===k?' selected':'')+'>'+STATUS_LBL[k]+'</option>').join('');
  const locked=f&&f.status!=='available'&&f.status!=='blocked';
  openModal('<div class="modal-head"><h3>'+(f?esc(t.name)+' - '+esc(f.flat_code):'Add a flat to '+esc(t.name))+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm">'
    +(f?'':'<div class="two"><div><label>Floor</label><select id="pssFFloor">'+floors.map(x=>'<option value="'+x.id+'">'+esc(x.label||ordinal(x.floor_no))+'</option>').join('')+'</select></div><div><label>Flat code</label><input id="pssFCode" placeholder="e.g. 13-14A"></div></div>'
      +'<label>Position (for PLC)</label><select id="pssFPos"><option value="">— none —</option>'+pos.map(p=>'<option value="'+p.id+'">'+esc(p.code)+'</option>').join('')+'</select>')
    +'<div class="two"><div><label>BHK</label><input id="pssFBhk" value="'+esc(f&&f.bhk||'')+'"></div><div><label>Status</label><select id="pssFStatus"'+(locked?' disabled title="Set by bookings"':'')+'>'+statusOpts+'</select></div></div>'
    +'<label>Super built-up area (sq ft)</label><input id="pssFSba" type="number" step="0.01" value="'+(f&&f.sba_sqft!=null?f.sba_sqft:'')+'">'
    +'<div class="two"><div><label>Built-up (sq ft)</label><input id="pssFBu" type="number" step="0.01" value="'+(f&&f.built_up_sqft!=null?f.built_up_sqft:'')+'"></div><div><label>Carpet (sq ft)</label><input id="pssFCa" type="number" step="0.01" value="'+(f&&f.carpet_sqft!=null?f.carpet_sqft:'')+'"></div></div>'
    +'<label>Remarks</label><input id="pssFRem" value="'+esc(f&&f.remarks||'')+'">'
    +(f&&t.base_rate!=null?'<div class="sec-title" style="margin-top:18px">Indicative price</div>'+priceBreak(f,t):'')
    +'</div><div class="modal-foot">'+(f&&!locked?'<button class="btn btn-ghost" style="margin-right:auto" onclick="pssFlatDelete('+f.id+')"><i class="fa-solid fa-trash"></i> Delete</button>':'')+'<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pssFlatSave('+(f?f.id:'null')+')">Save</button></div>');
};
window.pssFlatSave=async function(id){
  const row={bhk:val('pssFBhk')||null,sba_sqft:numOrNull('pssFSba'),built_up_sqft:numOrNull('pssFBu'),carpet_sqft:numOrNull('pssFCa'),remarks:val('pssFRem')||null,updated_at:new Date().toISOString()};
  if(!$('pssFStatus').disabled) row.status=val('pssFStatus');
  let error;
  if(id){ ({error}=await PS().from('flats').update(row).eq('id',id)); }
  else{
    const code=val('pssFCode').toUpperCase();
    if(!code){ toast('Enter the flat code','err'); return; }
    ({error}=await PS().from('flats').insert({...row,status:row.status||'available',tower_id:S.towerId,floor_id:Number(val('pssFFloor')),position_id:val('pssFPos')?Number(val('pssFPos')):null,flat_code:code}));
    if(error&&/flats_tower_code_uq/.test(error.message)){ toast('Flat '+code+' already exists in this tower','err'); return; }
  }
  if(fail(error)) return;
  closeModal(); toast('Flat saved','ok'); route();
};
window.pssFlatDelete=async function(id){
  const f=S.flats.find(x=>x.id===id);
  if(!await confirmDialog('Delete flat '+f.flat_code+'?')) return;
  const {error}=await PS().from('flats').update(soft()).eq('id',id);
  if(fail(error,'Delete failed')) return;
  toast('Flat deleted','ok'); route();
};

/* ---------------- Simple lists: PLC, Charges, Parking, Stages ---------------- */
function listCard(title,hint,addLabel,addFn,heads,rows,extraBtn){
  return '<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">'+esc(title)+'</div><div class="pss-hint" style="margin:0">'+hint+'</div></div>'+(extraBtn||'')+'<button class="btn btn-primary" onclick="'+addFn+'"><i class="fa-solid fa-plus"></i> '+esc(addLabel)+'</button></div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+heads.map(h=>'<th'+(h[1]?' class="pss-num"':'')+'>'+esc(h[0])+'</th>').join('')+'<th></th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="'+(heads.length+1)+'"><div class="empty" style="padding:24px"><div>Nothing added yet</div></div></td></tr>')+'</tbody></table></div></div>';
}
const actBtns=(edit,del)=>'<td style="white-space:nowrap;text-align:right"><button class="btn btn-sm btn-ghost" title="Edit" onclick="'+edit+'"><i class="fa-solid fa-pen"></i></button> <button class="btn btn-sm btn-ghost" title="Delete" onclick="'+del+'"><i class="fa-solid fa-trash"></i></button></td>';
function simpleModal(title,body,saveFn){
  openModal('<div class="modal-head"><h3>'+esc(title)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm">'+body+'</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="'+saveFn+'">Save</button></div>');
}
async function saveRow(table,id,row,okMsg){
  const {error}=id?await PS().from(table).update(row).eq('id',id):await PS().from(table).insert({...row,project_id:S.pid});
  if(fail(error)) return false;
  closeModal(); toast(okMsg,'ok'); route(); return true;
}
async function softDelete(table,id,label,after){
  if(!await confirmDialog('Delete '+label+'?')) return;
  const {error}=await PS().from(table).update(soft()).eq('id',id);
  if(fail(error,'Delete failed')) return;
  if(after) await after();
  toast('Deleted','ok'); route();
}

function renderPlc(host){
  const used=id=>{const pos=S.posPlcs.filter(x=>x.plc_type_id===id).map(x=>x.position_id);return S.positions.filter(p=>pos.includes(p.id)).map(p=>{const t=S.towers.find(x=>x.id===p.tower_id);return (t?t.name+' ':'')+p.code;});};
  const rows=S.plcs.map(p=>{const u=used(p.id);return '<tr><td><b>'+esc(p.name)+'</b></td><td class="pss-num">'+rate(p.rate)+'</td><td>'+(u.length?esc(u.join(', ')):'<span style="color:var(--slate)">Not tagged on any position yet</span>')+'</td>'+actBtns('pssPlcModal('+p.id+')','pssPlcDelete('+p.id+')')+'</tr>';}).join('');
  host.innerHTML=listCard('PLC types','Rate per sq ft of super built-up area. Tag them on flat positions inside each tower. GST: '+esc(S.setup.plc_gst_rate)+'% (Project &amp; GST).','Add PLC type','pssPlcModal()',[['PLC'],['Rate /sq ft',1],['Tagged on']],rows);
}
window.pssPlcModal=function(id){
  const p=id?S.plcs.find(x=>x.id===id):null;
  simpleModal(p?'Edit PLC type':'Add PLC type','<label>Name</label><input id="pssLName" value="'+esc(p?p.name:'')+'" placeholder="South Facing"><label>Rate per sq ft</label><input id="pssLRate" type="number" step="0.01" value="'+(p?p.rate:'')+'">','pssPlcSave('+(p?p.id:'null')+')');
};
window.pssPlcSave=async function(id){
  const name=val('pssLName'); if(!name){ toast('Enter a name','err'); return; }
  await saveRow('plc_types',id,{name,rate:num(val('pssLRate')),...(id?{}:{sort_order:S.plcs.length})},'PLC type saved');
};
window.pssPlcDelete=function(id){ const p=S.plcs.find(x=>x.id===id); softDelete('plc_types',id,'PLC type '+p.name+(S.posPlcs.some(x=>x.plc_type_id===id)?' (it will be removed from every position)':''),()=>PS().from('position_plcs').delete().eq('plc_type_id',id)); };

function cleanChargeName(s){
  return String(s||'').replace(/\s+at\s+ADJUSTABLE\s+at\s*/ig,' ').replace(/_\d+\s*$/,'').replace(/\s+/g,' ').trim()
    .toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
}
function renderCharges(host){
  const rows=S.charges.map(c=>'<tr><td><b>'+esc(c.name)+'</b></td><td>'+(c.charge_group==='edc'?'<span class="tag t-blue">EDC</span>':'<span class="tag t-gray">Other</span>')+'</td><td>'+esc(BASIS_LBL[c.basis])+'</td><td class="pss-num">'+(c.basis==='pct_unit'?pct(c.rate):rate(c.rate))+'</td><td class="pss-num">'+pct(c.gst_rate)+'</td>'+actBtns('pssChargeModal('+c.id+')','pssChargeDelete('+c.id+')')+'</tr>').join('');
  const extra=S.portalUnits?'<button class="btn" onclick="pssChargesFromPortal()"><i class="fa-solid fa-wand-magic-sparkles"></i> Suggest from portal cost sheets</button>':'';
  host.innerHTML=listCard('Other charges','EDC charges are on every cost sheet and are split across the payment-plan milestones by each milestone\'s EDC %. "Other" charges (e.g. extra work) stay off the standard cost sheet and are billed on their own when raised.','Add charge','pssChargeModal()',[['Charge'],['Group'],['Basis'],['Rate',1],['GST',1]],rows,extra);
}
window.pssChargeModal=function(id,preset){
  const c=id?S.charges.find(x=>x.id===id):(preset||null);
  const opt=(o,v)=>Object.keys(o).map(k=>'<option value="'+k+'"'+(v===k?' selected':'')+'>'+esc(o[k])+'</option>').join('');
  simpleModal(id?'Edit charge':'Add charge','<label>Name</label><input id="pssCName" value="'+esc(c?c.name:'')+'" placeholder="Club Membership">'
    +'<div class="two"><div><label>Group</label><select id="pssCGroup">'+opt({edc:'EDC (split by milestone)',other:'Other'},c?c.charge_group:'edc')+'</select></div><div><label>Basis</label><select id="pssCBasis">'+opt(BASIS_LBL,c?c.basis:'per_sqft')+'</select></div></div>'
    +'<div class="two"><div><label>Rate (₹ per sq ft, ₹ fixed, or %)</label><input id="pssCRate" type="number" step="0.01" value="'+(c&&c.rate!=null?c.rate:'')+'"></div><div><label>GST %</label><input id="pssCGst" type="number" step="0.01" value="'+(c&&c.gst_rate!=null?c.gst_rate:18)+'"></div></div>','pssChargeSave('+(id||'null')+')');
};
window.pssChargeSave=async function(id){
  const name=val('pssCName'); if(!name){ toast('Enter a name','err'); return; }
  await saveRow('charges',id,{name,charge_group:val('pssCGroup'),basis:val('pssCBasis'),rate:num(val('pssCRate')),gst_rate:num(val('pssCGst')),...(id?{}:{sort_order:S.charges.length})},'Charge saved');
};
window.pssChargeDelete=function(id){ const c=S.charges.find(x=>x.id===id); softDelete('charges',id,'charge '+c.name); };
window.pssChargesFromPortal=async function(){
  const units=await sb.schema('cust').from('units').select('id').eq('project_id',S.pid).is('deleted_at',null);
  const ids=(units.data||[]).map(u=>u.id);
  if(!ids.length){ toast('No portal bookings for this project','warn'); return; }
  const {data,error}=await sb.schema('cust').from('cost_sheet_items').select('component').in('unit_id',ids.slice(0,500)).is('deleted_at',null).eq('is_current',true);
  if(fail(error,'Could not read portal cost sheets')) return;
  const skip=/^(unit cost|plc|flc|frc|vehicle parking|car parking|parking|cheque dishonou?red)/i;
  const have=new Set(S.charges.map(c=>c.name.toLowerCase()));
  const names=[...new Set((data||[]).map(r=>cleanChargeName(r.component)))].filter(n=>n&&!skip.test(n)&&!have.has(n.toLowerCase())).sort();
  if(!names.length){ toast('Every charge on the portal cost sheets is already here','ok'); return; }
  openModal('<div class="modal-head"><h3>Charges on this project\'s cost sheets</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body"><div class="pss-hint">Found on the Farvision cost sheets already in the Customer Portal (unit cost, PLC, floor rise and parking are set up elsewhere, so they\'re left out). Tick the ones to add - they\'re added as EDC, per sq ft, 18% GST with a zero rate, so open each one afterwards and enter its rate.</div>'
    +'<div style="display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow:auto">'+names.map(n=>'<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" class="pssSugBox" value="'+esc(n)+'" checked> '+esc(n)+'</label>').join('')+'</div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pssChargesAddPicked()">Add ticked</button></div>');
};
window.pssChargesAddPicked=async function(){
  const picked=[...document.querySelectorAll('.pssSugBox:checked')].map(x=>x.value);
  if(!picked.length){ closeModal(); return; }
  const {error}=await PS().from('charges').insert(picked.map((n,i)=>({project_id:S.pid,name:n,charge_group:'edc',basis:'per_sqft',rate:0,gst_rate:18,sort_order:S.charges.length+i})));
  if(fail(error)) return;
  closeModal(); toast(picked.length+' charges added - enter their rates','ok'); route();
};

function renderParking(host){
  const rows=S.parking.map(p=>'<tr><td><b>'+esc(p.name)+'</b></td><td class="pss-num">'+inr(p.price)+'</td><td class="pss-num">'+pct(p.gst_rate)+'</td>'+actBtns('pssParkModal('+p.id+')','pssParkDelete('+p.id+')')+'</tr>').join('');
  host.innerHTML=listCard('Car parking types','Price per parking space. A booking picks a type and a count - parking is a charge on the cost sheet only, no slot allotment.','Add parking type','pssParkModal()',[['Type'],['Price per space',1],['GST',1]],rows);
}
window.pssParkModal=function(id){
  const p=id?S.parking.find(x=>x.id===id):null;
  simpleModal(p?'Edit parking type':'Add parking type','<label>Type</label><input id="pssKName" value="'+esc(p?p.name:'')+'" placeholder="Covered"><div class="two"><div><label>Price per space (₹)</label><input id="pssKPrice" type="number" step="0.01" value="'+(p?p.price:'')+'"></div><div><label>GST %</label><input id="pssKGst" type="number" step="0.01" value="'+(p?p.gst_rate:5)+'"></div></div>','pssParkSave('+(p?p.id:'null')+')');
};
window.pssParkSave=async function(id){
  const name=val('pssKName'); if(!name){ toast('Enter a type','err'); return; }
  await saveRow('parking_types',id,{name,price:num(val('pssKPrice')),gst_rate:num(val('pssKGst')),...(id?{}:{sort_order:S.parking.length})},'Parking type saved');
};
window.pssParkDelete=function(id){ const p=S.parking.find(x=>x.id===id); softDelete('parking_types',id,'parking type '+p.name); };

function renderStages(host){
  const rows=S.stages.map(s=>'<tr><td><b>'+esc(s.name)+'</b></td><td>'+(s.level==='tower'?'<span class="tag t-blue">Tower level</span>':'<span class="tag t-purple">Floor level</span>')+'</td><td style="color:var(--slate);font-size:12.5px">'+(s.level==='tower'?'Completing it for a tower invoices every booked flat in that tower':'Completing it for a floor invoices every booked flat on that floor')+'</td>'+actBtns('pssStageModal('+s.id+')','pssStageDelete('+s.id+')')+'</tr>').join('');
  const extra='<button class="btn" onclick="pssStagesQuick()"><i class="fa-solid fa-wand-magic-sparkles"></i> Add typical stages</button>';
  host.innerHTML=listCard('Construction stages','Construction-linked milestones in a payment plan wait on one of these. Marking a stage complete (Stage 4) raises the invoices in bulk.','Add stage','pssStageModal()',[['Stage'],['Level'],['Raises invoices for']],rows,extra);
}
window.pssStageModal=function(id){
  const s=id?S.stages.find(x=>x.id===id):null;
  simpleModal(s?'Edit stage':'Add stage','<label>Name</label><input id="pssGName" value="'+esc(s?s.name:'')+'" placeholder="On Commencement of 3rd Floor Slab"><label>Level</label><select id="pssGLevel"><option value="tower"'+(s&&s.level==='tower'?' selected':'')+'>Tower level - foundation, floor casting/slab, roof</option><option value="floor"'+(s&&s.level==='floor'?' selected':'')+'>Floor level - brickwork, flooring, POP</option></select>','pssStageSave('+(s?s.id:'null')+')');
};
window.pssStageSave=async function(id){
  const name=val('pssGName'); if(!name){ toast('Enter a name','err'); return; }
  await saveRow('stages',id,{name,level:val('pssGLevel'),...(id?{}:{sort_order:S.stages.length})},'Stage saved');
};
window.pssStageDelete=function(id){
  if(S.milestones.some(m=>m.stage_id===id)){ toast('A payment plan uses this stage - change that milestone first','err'); return; }
  const s=S.stages.find(x=>x.id===id); softDelete('stages',id,'stage '+s.name);
};
window.pssStagesQuick=function(){
  const top=S.towers.reduce((m,t)=>Math.max(m,t.floor_to),0)||7;
  const have=new Set(S.stages.map(s=>s.name.toLowerCase()));
  const sug=[['On Commencement of Foundation','tower']];
  for(let i=1;i<=top;i++) sug.push(['On Commencement of '+ordinal(i)+' Floor Slab','tower']);
  sug.push(['On Commencement of Roof Casting','tower'],['On Commencement of Brickwork','floor'],['On Commencement of Flooring','floor'],['On Commencement of POP','floor'],['On Notice of Possession','tower']);
  const list=sug.filter(s=>!have.has(s[0].toLowerCase()));
  if(!list.length){ toast('All typical stages are already here','ok'); return; }
  openModal('<div class="modal-head"><h3>Add typical stages</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body"><div class="pss-hint">Untick any this project doesn\'t use. Names can be edited afterwards.</div><div style="display:flex;flex-direction:column;gap:6px;max-height:55vh;overflow:auto">'
    +list.map((s,i)=>'<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" class="pssStgBox" data-i="'+i+'" checked> '+esc(s[0])+' <span class="tag '+(s[1]==='tower'?'t-blue':'t-purple')+'">'+(s[1]==='tower'?'Tower':'Floor')+'</span></label>').join('')+'</div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="pssStgAdd">Add ticked</button></div>');
  $('pssStgAdd').onclick=async function(){
    const rows=[...document.querySelectorAll('.pssStgBox:checked')].map((b,k)=>{const s=list[Number(b.dataset.i)];return {project_id:S.pid,name:s[0],level:s[1],sort_order:S.stages.length+k};});
    if(!rows.length){ closeModal(); return; }
    const {error}=await PS().from('stages').insert(rows);
    if(fail(error)) return;
    closeModal(); toast(rows.length+' stages added','ok'); route();
  };
};

/* ---------------- Bank accounts (where receipts are deposited) ---------------- */
function renderBanks(host){
  const rows=S.banks.map(b=>'<tr><td><b>'+esc(b.name)+'</b>'+(b.project_id?'':' <span class="tag t-gray">All projects</span>')+'</td><td>'+esc(b.bank_name||'—')+'</td><td>'+esc(b.account_no||'—')+'</td><td>'+esc(b.ifsc||'—')+'</td><td>'+(b.active?'<span class="tag t-green">Active</span>':'<span class="tag t-gray">Inactive</span>')+'</td>'+actBtns('pssBankModal('+b.id+')','pssBankDelete('+b.id+')')+'</tr>').join('');
  host.innerHTML=listCard('Bank accounts','The deposit account picked on every receipt. Adjustment entries Farvision posts as receipts (TDS receivable, discount allowed) are listed here too.','Add account','pssBankModal()',[['Account'],['Bank'],['Account no.'],['IFSC'],['Status']],rows);
}
window.pssBankModal=function(id){
  const b=id?S.banks.find(x=>x.id===id):null;
  simpleModal(b?'Edit bank account':'Add bank account','<label>Name shown on receipts</label><input id="pssBName" value="'+esc(b?b.name:'')+'" placeholder="Yes Bank - 2053">'
    +'<div class="two"><div><label>Bank</label><input id="pssBBank" value="'+esc(b&&b.bank_name||'')+'"></div><div><label>Account no.</label><input id="pssBNo" value="'+esc(b&&b.account_no||'')+'"></div></div>'
    +'<div class="two"><div><label>IFSC</label><input id="pssBIfsc" class="pss-up" value="'+esc(b&&b.ifsc||'')+'"></div><div><label>Use on</label><select id="pssBScope"><option value="p"'+(!b||b.project_id?' selected':'')+'>This project only</option><option value="all"'+(b&&!b.project_id?' selected':'')+'>All projects</option></select></div></div>'
    +'<label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="pssBActive" style="width:auto"'+(!b||b.active?' checked':'')+'> Active</label>','pssBankSave('+(b?b.id:'null')+')');
};
window.pssBankSave=async function(id){
  const name=val('pssBName'); if(!name){ toast('Enter a name','err'); return; }
  const row={name,bank_name:val('pssBBank')||null,account_no:val('pssBNo')||null,ifsc:val('pssBIfsc').toUpperCase()||null,active:$('pssBActive').checked,project_id:val('pssBScope')==='all'?null:S.pid};
  const {error}=id?await PS().from('bank_accounts').update(row).eq('id',id):await PS().from('bank_accounts').insert(row);
  if(fail(error)) return;
  closeModal(); toast('Bank account saved','ok'); route();
};
window.pssBankDelete=function(id){ const b=S.banks.find(x=>x.id===id); softDelete('bank_accounts',id,'bank account '+b.name); };

/* ---------------- Payment plans ---------------- */
function planTotals(ms){
  return ms.reduce((s,m)=>({u:s.u+num(m.unit_pct),e:s.e+num(m.edc_pct),p:s.p+num(m.parking_pct),f:s.f+num(m.fixed_amount)}),{u:0,e:0,p:0,f:0});
}
const near=(a,b)=>Math.abs(a-b)<0.001;
function renderPlans(host){
  const rows=S.plans.map(p=>{
    const ms=S.milestones.filter(m=>m.plan_id===p.id), t=planTotals(ms);
    const chk=(v,lbl)=>'<span class="'+(near(v,100)?'pss-ok':'pss-bad')+'">'+lbl+' '+pct(v)+'</span>';
    return '<tr><td><b>'+esc(p.name)+'</b>'+(p.description?'<div class="pss-hint" style="margin:0">'+esc(p.description)+'</div>':'')+'</td><td class="pss-num">'+ms.length+'</td>'
      +'<td style="white-space:nowrap;font-size:12.5px">'+chk(t.u,'Unit')+' · '+chk(t.e,'EDC')+' · '+chk(t.p,'Parking')+(t.f?' · Booking '+inr(t.f):'')+'</td>'
      +'<td>'+(p.active?'<span class="tag t-green">Active</span>':'<span class="tag t-gray">Inactive</span>')+'</td>'
      +'<td style="white-space:nowrap;text-align:right"><button class="btn btn-sm" onclick="pssPlanModal('+p.id+')"><i class="fa-solid fa-pen"></i> Edit</button> <button class="btn btn-sm btn-ghost" title="Duplicate" onclick="pssPlanDup('+p.id+')"><i class="fa-solid fa-copy"></i></button> <button class="btn btn-sm btn-ghost" title="Delete" onclick="pssPlanDelete('+p.id+')"><i class="fa-solid fa-trash"></i></button></td></tr>';
  }).join('');
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Standard payment plans</div><div class="pss-hint" style="margin:0">Usually 3-4 per project. At booking one is picked; any edit there turns it into a non-standard plan for that booking only. Unit, EDC and parking % should each add up to 100%.</div></div><button class="btn btn-primary" onclick="pssPlanModal()"><i class="fa-solid fa-plus"></i> New plan</button></div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Plan</th><th class="pss-num">Milestones</th><th>Totals</th><th>Status</th><th></th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="5"><div class="empty" style="padding:24px"><div>No payment plans yet</div></div></td></tr>')+'</tbody></table></div></div>';
}
let PLAN_DRAFT=[];
function msRowHtml(m,i){
  const stOpts=lvl=>'<option value="">Choose stage…</option>'+S.stages.filter(s=>s.level===lvl).map(s=>'<option value="'+s.id+'"'+(m.stage_id===s.id?' selected':'')+'>'+esc(s.name)+'</option>').join('');
  const trig=Object.keys(TRIGGER_LBL).map(k=>'<option value="'+k+'"'+(m.trigger_type===k?' selected':'')+'>'+TRIGGER_LBL[k]+'</option>').join('');
  const when=m.trigger_type==='individual'
    ?'<input class="n" type="number" placeholder="days" title="Raised automatically this many days after booking - blank = raised by hand" value="'+(m.due_days!=null?m.due_days:'')+'" oninput="pssMsSet('+i+',\'due_days\',this.value)">'
    :'<select onchange="pssMsSet('+i+',\'stage_id\',this.value)">'+stOpts(m.trigger_type)+'</select>';
  const n=(k,ph)=>'<input class="n" type="number" step="0.001" placeholder="'+(ph||'0')+'" value="'+(m[k]!=null&&m[k]!==''&&num(m[k])!==0?m[k]:'')+'" oninput="pssMsSet('+i+',\''+k+'\',this.value)">';
  return '<tr><td style="color:var(--slate)">'+(i+1)+'</td>'
    +'<td><input value="'+esc(m.name||'')+'" placeholder="Milestone name" oninput="pssMsSet('+i+',\'name\',this.value)"></td>'
    +'<td><select onchange="pssMsSet('+i+',\'trigger_type\',this.value,true)">'+trig+'</select></td>'
    +'<td>'+when+'</td>'
    +'<td><input class="n" type="number" step="0.01" placeholder="₹" value="'+(m.fixed_amount!=null&&m.fixed_amount!==''?m.fixed_amount:'')+'" oninput="pssMsSet('+i+',\'fixed_amount\',this.value)"></td>'
    +'<td style="text-align:center"><input type="checkbox" title="Less booking amount" '+(m.less_fixed?'checked':'')+' onchange="pssMsSet('+i+',\'less_fixed\',this.checked)"></td>'
    +'<td>'+n('unit_pct')+'</td><td>'+n('edc_pct')+'</td><td>'+n('parking_pct')+'</td>'
    +'<td style="white-space:nowrap"><button class="btn btn-sm btn-ghost" title="Move up" onclick="pssMsMove('+i+',-1)"><i class="fa-solid fa-arrow-up"></i></button><button class="btn btn-sm btn-ghost" title="Remove" onclick="pssMsDel('+i+')"><i class="fa-solid fa-xmark"></i></button></td></tr>';
}
function msRedraw(){
  const tb=$('pssMsBody'); if(!tb) return;
  tb.innerHTML=PLAN_DRAFT.map(msRowHtml).join('')||'<tr><td colspan="10" style="text-align:center;color:var(--slate);padding:16px">Add the first milestone - usually Booking (a fixed amount).</td></tr>';
  msTotals();
}
function msTotals(){
  const t=planTotals(PLAN_DRAFT), f=$('pssMsFoot'); if(!f) return;
  const c=v=>'<span class="'+(near(v,100)?'pss-ok':'pss-bad')+'">'+pct(v)+'</span>';
  f.innerHTML='<td></td><td>Total</td><td></td><td></td><td class="pss-num">'+(t.f?inr(t.f):'')+'</td><td></td><td>'+c(t.u)+'</td><td>'+c(t.e)+'</td><td>'+c(t.p)+'</td><td></td>';
}
window.pssMsSet=function(i,k,v,redraw){
  const m=PLAN_DRAFT[i]; if(!m) return;
  m[k]=v;
  if(k==='trigger_type'){ m.stage_id=null; if(v!=='individual') m.due_days=null; }
  if(k==='stage_id') m.stage_id=v?Number(v):null;
  if(redraw) msRedraw(); else msTotals();
};
window.pssMsAdd=function(){ PLAN_DRAFT.push({name:'',trigger_type:'individual',due_days:null,stage_id:null,fixed_amount:null,less_fixed:false,unit_pct:0,edc_pct:0,parking_pct:0}); msRedraw(); };
window.pssMsDel=function(i){ PLAN_DRAFT.splice(i,1); msRedraw(); };
window.pssMsMove=function(i,d){ const j=i+d; if(j<0||j>=PLAN_DRAFT.length) return; const x=PLAN_DRAFT[i]; PLAN_DRAFT[i]=PLAN_DRAFT[j]; PLAN_DRAFT[j]=x; msRedraw(); };
// Dream Gurukul's standard construction-linked plan, from its Estimated Offer Price sheet - a starting point to edit.
window.pssMsTemplate=function(){
  const st=n=>{const s=S.stages.find(x=>x.name.toLowerCase().includes(n));return s?s.id:null;};
  PLAN_DRAFT=[
    {name:'Booking Amount',trigger_type:'individual',due_days:0,fixed_amount:210000,unit_pct:0,edc_pct:0,parking_pct:0},
    {name:'Balance Booking Amount (within 30 days of application)',trigger_type:'individual',due_days:30,less_fixed:true,unit_pct:10,edc_pct:10,parking_pct:10},
    {name:'Signing of Sale Agreement (within 45 days of application)',trigger_type:'individual',due_days:45,unit_pct:10,edc_pct:10,parking_pct:10},
    {name:'On Commencement of Foundation',trigger_type:'tower',stage_id:st('foundation'),unit_pct:15,edc_pct:15,parking_pct:15},
    {name:'On Commencement of 1st Floor Slab',trigger_type:'tower',stage_id:st('1st floor'),unit_pct:10,edc_pct:10,parking_pct:10},
    {name:'On Commencement of 2nd Floor Slab',trigger_type:'tower',stage_id:st('2nd floor'),unit_pct:10,edc_pct:10,parking_pct:10},
    {name:'On Commencement of 3rd Floor Slab',trigger_type:'tower',stage_id:st('3rd floor'),unit_pct:10,edc_pct:10,parking_pct:10},
    {name:'On Commencement of 5th Floor Slab',trigger_type:'tower',stage_id:st('5th floor'),unit_pct:10,edc_pct:10,parking_pct:10},
    {name:'On Commencement of 7th Floor Slab',trigger_type:'tower',stage_id:st('7th floor'),unit_pct:10,edc_pct:10,parking_pct:10},
    {name:'On Commencement of Brickwork',trigger_type:'floor',stage_id:st('brick'),unit_pct:10,edc_pct:10,parking_pct:10},
    {name:'On Notice of Possession',trigger_type:'tower',stage_id:st('possession'),unit_pct:5,edc_pct:5,parking_pct:5}
  ].map(m=>({due_days:null,stage_id:null,fixed_amount:null,less_fixed:false,...m}));
  msRedraw();
};
window.pssPlanModal=function(id){
  const p=id?S.plans.find(x=>x.id===id):null;
  PLAN_DRAFT=(p?S.milestones.filter(m=>m.plan_id===p.id):[]).map(m=>({...m}));
  openModal('<div class="modal-head"><h3>'+(p?'Edit payment plan':'New payment plan')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body"><div class="frm"><div class="two"><div><label>Plan name</label><input id="pssPlName" value="'+esc(p?p.name:'')+'" placeholder="Construction Linked Plan"></div><div><label>Description (optional)</label><input id="pssPlDesc" value="'+esc(p&&p.description||'')+'"></div></div>'
    +'<label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="pssPlActive" style="width:auto"'+(!p||p.active?' checked':'')+'> Active - offered at booking</label></div>'
    +'<div class="pss-hint" style="margin-top:12px"><b>Individual</b>: raised for one booking - enter days after booking to raise it automatically. <b>Tower / Floor level</b>: raised in bulk when that stage is marked complete. <b>Fixed ₹</b> is the booking amount; tick <b>Less booking</b> on the milestone that deducts it ("10% of flat value less booking amount").'
    +(S.stages.length?'':' <span class="pss-bad">No construction stages yet - add them in Stages before using tower/floor milestones.</span>')+'</div>'
    +'<div style="overflow-x:auto"><table class="pss-ms"><thead><tr><th>#</th><th style="min-width:230px">Milestone</th><th>Trigger</th><th style="min-width:150px">Due / stage</th><th>Fixed ₹</th><th>Less booking</th><th>Unit %</th><th>EDC %</th><th>Parking %</th><th></th></tr></thead><tbody id="pssMsBody"></tbody><tfoot><tr id="pssMsFoot"></tr></tfoot></table></div>'
    +'<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn btn-sm" onclick="pssMsAdd()"><i class="fa-solid fa-plus"></i> Add milestone</button>'+(PLAN_DRAFT.length?'':'<button class="btn btn-sm btn-ghost" onclick="pssMsTemplate()"><i class="fa-solid fa-wand-magic-sparkles"></i> Start from the Dream Gurukul plan</button>')+'</div>'
    +'</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="pssPlanSave('+(p?p.id:'null')+')">Save plan</button></div>','xl');
  msRedraw();
};
window.pssPlanSave=async function(id){
  const name=val('pssPlName');
  if(!name){ toast('Enter the plan name','err'); return; }
  const ms=PLAN_DRAFT.filter(m=>String(m.name||'').trim());
  if(!ms.length){ toast('Add at least one milestone','err'); return; }
  const bad=ms.find(m=>m.trigger_type!=='individual'&&!m.stage_id);
  if(bad){ toast('Choose the construction stage for "'+bad.name+'"','err'); return; }
  const t=planTotals(ms);
  const off=[['Unit',t.u],['EDC',t.e],['Parking',t.p]].filter(x=>!near(x[1],100)&&!(x[0]!=='Unit'&&near(x[1],0)));
  if(off.length&&!await confirmDialog(off.map(x=>x[0]+' adds up to '+pct(x[1])).join(', ')+' instead of 100%. Save anyway?',{danger:false,okLabel:'Save anyway',title:'Totals don\'t add up'})) return;
  const head={name,description:val('pssPlDesc')||null,active:$('pssPlActive').checked,updated_at:new Date().toISOString()};
  let planId=id, error;
  if(id){ ({error}=await PS().from('payment_plans').update(head).eq('id',id)); }
  else{ const r=await PS().from('payment_plans').insert({...head,project_id:S.pid,sort_order:S.plans.length}).select('id').single(); error=r.error; planId=r.data&&r.data.id; }
  if(fail(error)) return;
  // Plans aren't referenced by bookings (each booking keeps its own copy), so replacing the rows is safe.
  const del=await PS().from('plan_milestones').delete().eq('plan_id',planId);
  if(fail(del.error)) return;
  const rows=ms.map((m,i)=>({plan_id:planId,seq:i+1,name:String(m.name).trim(),trigger_type:m.trigger_type,
    due_days:m.trigger_type==='individual'&&m.due_days!==''&&m.due_days!=null?parseInt(m.due_days,10):null,
    stage_id:m.trigger_type==='individual'?null:m.stage_id,
    fixed_amount:m.fixed_amount!==''&&m.fixed_amount!=null&&num(m.fixed_amount)?num(m.fixed_amount):null,
    less_fixed:!!m.less_fixed,unit_pct:num(m.unit_pct),edc_pct:num(m.edc_pct),parking_pct:num(m.parking_pct)}));
  const ins=await PS().from('plan_milestones').insert(rows);
  if(fail(ins.error)) return;
  closeModal(); toast('Payment plan saved','ok'); route();
};
window.pssPlanDup=async function(id){
  const p=S.plans.find(x=>x.id===id);
  const r=await PS().from('payment_plans').insert({project_id:S.pid,name:p.name+' (copy)',description:p.description,active:false,sort_order:S.plans.length}).select('id').single();
  if(fail(r.error)) return;
  const ms=S.milestones.filter(m=>m.plan_id===id).map(m=>{const x={...m};delete x.id;x.plan_id=r.data.id;return x;});
  if(ms.length){ const ins=await PS().from('plan_milestones').insert(ms); if(fail(ins.error)) return; }
  toast('Plan copied - it starts inactive','ok'); route();
};
window.pssPlanDelete=function(id){ const p=S.plans.find(x=>x.id===id); softDelete('payment_plans',id,'payment plan '+p.name); };

/* ============================ POST SALES — BOOKINGS (Stage 2) ============================
   Spec: docs/post-sales-spec.md §2. Tables: supabase/migrations/20261001150000_postsales_bookings.sql.
   Route: postsales/bookings[/new | /<id> | /<id>/edit].

   Pricing: unit = rate × super built-up area, PLC and floor rise per sq ft on the same area, a discount
   either per sq ft or a lump sum (both taken off the unit column), parking = price × spaces, and the
   project's EDC charges. GST is rounded to the rupee per line, the way the Estimated Offer Price sheet
   shows it. The payment schedule is GROSS: a milestone's Unit share is its % of (unit+PLC+FRC−discount
   + their GST), plus any fixed booking amount, less the booking amount where the milestone says so;
   Parking and EDC likewise by their own %. The last milestone of each column takes the rounding
   difference so every column adds up to its total exactly.

   A booking keeps its own copy of the rates it was priced from (booking_charges), so editing a saved
   booking re-prices from THAT copy, not from today's setup - unless its flat is changed. */
const B={pid:null,list:[],f:null,view:null};
const APPL_FIELDS=['title','full_name','relation_type','relation_name','dob','nationality','resident_status','pan','aadhaar','passport_no','spouse_name','anniversary','occupation','company','designation','gross_income','mobile','phone_res','phone_off','email','res_address','off_address','mailing_address','permanent_address','nri_bank_details'];
const newApplicant=()=>({title:'Mr.',full_name:'',relation_type:'S/o',relation_name:'',dob:'',nationality:'Indian',resident_status:'resident',pan:'',aadhaar:'',passport_no:'',spouse_name:'',anniversary:'',occupation:'',company:'',designation:'',gross_income:'',mobile:'',phone_res:'',phone_off:'',email:'',res_address:'',off_address:'',mailing_address:'residential',permanent_address:'residential',nri_bank_details:'',kyc:[]});
const r2=n=>Math.round(num(n)*100)/100;
const today=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const dmy=d=>{if(!d)return '—';const p=String(d).slice(0,10).split('-');return p[2]+'-'+p[1]+'-'+p[0];};
const OCC_LBL={salaried:'Salaried',business:'Business',self_employed:'Self-employed',govt:'Govt. employee',retired:'Retired',other:'Other'};
const KYC_TYPES=['PAN','Aadhaar','Passport','Photo','Address proof','Employer ID','Other'];
const SOURCES=['Facebook','Instagram','Google','Website','Referral','Channel Partner','Walk-in','Newspaper','Hoarding','Existing customer'];

// Where a booking's rates come from: today's setup (new booking, or a booking moved to another flat),
// or the copy saved on the booking itself (editing it).
function rateSource(flat,snap){
  const g=S.setup||{};
  if(snap&&snap.flatId===flat.id) return snap.src;
  const tower=S.towers.find(t=>t.id===flat.tower_id), floor=S.floors.find(x=>x.id===flat.floor_id), fno=floor?floor.floor_no:0;
  return {
    unitGst:num(g.unit_gst_rate),
    plcs:(flat.position_id?plcIdsFor(flat.position_id):[]).map(id=>S.plcs.find(x=>x.id===id)).filter(p=>p&&num(p.rate)).map(p=>({name:p.name,rate:num(p.rate),gst:num(g.plc_gst_rate),id:p.id})),
    frc:frcFor(tower,fno)?{rate:frcFor(tower,fno),gst:num(g.frc_gst_rate),label:ordinal(fno)+' floor'}:null,
    charges:S.charges.filter(c=>c.charge_group==='edc').map(c=>({name:c.name,basis:c.basis,rate:num(c.rate),gst:num(c.gst_rate),id:c.id})),
    parking:S.parking.map(p=>({id:p.id,name:p.name,price:num(p.price),gst:num(p.gst_rate)}))
  };
}
function snapshotSource(lines,parkingTypeId){
  const by=k=>lines.filter(l=>l.kind===k);
  const u=by('unit')[0], fr=by('frc')[0], pk=by('parking')[0];
  return {
    unitGst:u?num(u.gst_rate):5,
    plcs:by('plc').map(l=>({name:String(l.name).replace(/^PLC - /,''),rate:num(l.rate),gst:num(l.gst_rate),id:l.source_id})),
    frc:fr?{rate:num(fr.rate),gst:num(fr.gst_rate),label:String(fr.name).replace(/^Floor Rise \(|\)$/g,'')}:null,
    charges:by('charge').map(l=>({name:l.name,basis:l.basis,rate:num(l.rate),gst:num(l.gst_rate),id:l.source_id})),
    // the booked parking type keeps its booked price; any other type is priced from today's setup
    parking:S.parking.map(p=>(pk&&p.id===parkingTypeId)?{id:p.id,name:p.name,price:num(pk.rate),gst:num(pk.gst_rate)}:{id:p.id,name:p.name,price:num(p.price),gst:num(p.gst_rate)})
  };
}
function priceBooking(f){
  const flat=S.flats.find(x=>x.id===f.flatId); if(!flat) return null;
  const floor=S.floors.find(x=>x.id===flat.floor_id);
  const src=rateSource(flat,f.snap), sba=num(flat.sba_sqft);
  const lines=[]; let seq=0;
  const add=(kind,col,name,basis,rate,qty,amount,gst,sid)=>{amount=r2(amount);lines.push({seq:++seq,kind,col,name,basis,rate:r2(rate),qty,amount,gst_rate:num(gst),gst_amount:Math.round(amount*num(gst)/100),source_id:sid||null});};
  const unitAmt=num(f.rate)*sba;
  add('unit','unit','Unit Price','per_sqft',f.rate,sba,unitAmt,src.unitGst);
  src.plcs.forEach(p=>add('plc','unit','PLC - '+p.name,'per_sqft',p.rate,sba,p.rate*sba,p.gst,p.id));
  if(src.frc) add('frc','unit','Floor Rise ('+src.frc.label+')','per_sqft',src.frc.rate,sba,src.frc.rate*sba,src.frc.gst);
  if(f.discType==='per_sqft'&&num(f.discVal)) add('discount','unit','Discount','per_sqft',f.discVal,sba,-num(f.discVal)*sba,src.unitGst);
  if(f.discType==='lump_sum'&&num(f.discVal)) add('discount','unit','Discount','fixed',f.discVal,1,-num(f.discVal),src.unitGst);
  const pk=src.parking.find(x=>x.id===f.parkId);
  if(pk&&num(f.parkCount)>0) add('parking','parking','Car Parking - '+pk.name,'fixed',pk.price,num(f.parkCount),pk.price*num(f.parkCount),pk.gst,pk.id);
  src.charges.forEach(c=>{
    const amt=c.basis==='per_sqft'?c.rate*sba:c.basis==='fixed'?c.rate:unitAmt*c.rate/100;
    if(amt) add('charge','edc',c.name,c.basis,c.rate,c.basis==='per_sqft'?sba:1,amt,c.gst,c.id);
  });
  const col=k=>lines.filter(l=>l.col===k).reduce((s,l)=>({net:r2(s.net+l.amount),gst:s.gst+l.gst_amount}),{net:0,gst:0});
  const tot={unit:col('unit'),parking:col('parking'),edc:col('edc')};
  tot.consideration=r2(tot.unit.net+tot.parking.net+tot.edc.net);
  tot.gst=tot.unit.gst+tot.parking.gst+tot.edc.gst;
  tot.grand=r2(tot.consideration+tot.gst);
  return {flat,floor,sba,lines,tot,schedule:schedule(f.ms,tot)};
}
function schedule(ms,tot){
  const G={u:tot.unit.net+tot.unit.gst,p:tot.parking.net+tot.parking.gst,e:tot.edc.net+tot.edc.gst};
  const R={u:tot.unit.net?tot.unit.gst/tot.unit.net:0,p:tot.parking.net?tot.parking.gst/tot.parking.net:0,e:tot.edc.net?tot.edc.gst/tot.edc.net:0};
  const fixedSum=ms.reduce((s,m)=>s+num(m.fixed_amount),0);
  const rows=ms.map(m=>({u:Math.round(num(m.fixed_amount)+G.u*num(m.unit_pct)/100-(m.less_fixed?fixedSum:0)),p:Math.round(G.p*num(m.parking_pct)/100),e:Math.round(G.e*num(m.edc_pct)/100)}));
  [['u','unit_pct'],['p','parking_pct'],['e','edc_pct']].forEach(([k,pk])=>{
    if(!near(ms.reduce((s,m)=>s+num(m[pk]),0),100)) return;
    const diff=Math.round(G[k])-rows.reduce((s,r)=>s+r[k],0);
    if(!diff) return;
    for(let i=ms.length-1;i>=0;i--) if(num(ms[i][pk])){ rows[i][k]+=diff; break; }
  });
  const split=(g,rt)=>{const n=r2(g/(1+rt));return [n,r2(g-n)];};
  return rows.map(r=>{const [un,ug]=split(r.u,R.u),[pn,pg]=split(r.p,R.p),[en,eg]=split(r.e,R.e);
    return {...r,unit_net:un,unit_gst:ug,parking_net:pn,parking_gst:pg,edc_net:en,edc_gst:eg,gross_total:r.u+r.p+r.e};});
}
function msDescribe(m){
  const parts=[];
  if(num(m.unit_pct)) parts.push('('+pct(m.unit_pct)+' of Flat Value'+(m.less_fixed?' - less Booking Amount':'')+')+GST');
  if(num(m.parking_pct)) parts.push('Parking ('+pct(m.parking_pct)+')+GST');
  if(num(m.edc_pct)) parts.push('Extra Development charges ('+pct(m.edc_pct)+')+GST');
  return parts.join(', ');
}
const MS_KEYS=['name','trigger_type','due_days','stage_id','fixed_amount','less_fixed','unit_pct','edc_pct','parking_pct'];
function msNorm(m){ return MS_KEYS.map(k=>{const v=m[k]; if(k==='name') return String(v||'').trim(); if(k==='less_fixed') return !!v; if(k==='trigger_type') return v; return (v===''||v==null||num(v)===0&&k!=='due_days')?null:num(v);}).join('|'); }
function planMilestones(planId){ return S.milestones.filter(m=>m.plan_id===planId).sort((a,b)=>a.seq-b.seq).map(m=>{const x={};MS_KEYS.forEach(k=>x[k]=m[k]);return x;}); }
function isNonStandard(f){
  if(!f.planId) return true;
  const a=planMilestones(f.planId).map(msNorm), b=f.ms.filter(m=>String(m.name||'').trim()).map(msNorm);
  return a.length!==b.length||a.some((x,i)=>x!==b[i]);
}

/* ---------------- shell ---------------- */
let BK_SEQ=0;
window.psbRender=async function(host,seg){
  host.classList.add('ps-root');
  css(); bcss();
  seg=seg||[];
  const mine=++BK_SEQ, stale=()=>mine!==BK_SEQ||!host.isConnected;
  loader(host);
  if(!S.projects.length) await loadProjects();
  if(stale()) return;
  if(seg[0]==='new'){ await bookingForm(host,null,stale,parseInt(seg[1],10)||null); return; }
  const id=parseInt(seg[0],10);
  if(id&&seg[1]==='edit'){ await bookingForm(host,id,stale); return; }
  if(id){ await bookingView(host,id,stale); return; }
  await bookingList(host,stale);
};
function bcss(){
  if($('psbCss')) return;
  const st=document.createElement('style'); st.id='psbCss';
  st.textContent=`
  .psb-sec{background:var(--bg-card,#fff);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:14px}
  .psb-sec h3{margin:0 0 4px;font-size:15px;display:flex;align-items:center;gap:8px}
  .psb-sec h3 .n{display:inline-flex;width:22px;height:22px;border-radius:50%;background:#7e22ce;color:#fff;font-size:12px;align-items:center;justify-content:center}
  .psb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:4px 14px}
  .psb-grid.wide{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
  .psb-span2{grid-column:span 2}
  .psb-facts{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;margin-top:10px;color:var(--slate)}
  .psb-facts b{color:var(--ink)}
  .psb-tbl{width:100%;border-collapse:collapse;font-size:13px}
  .psb-tbl th{font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--slate);text-align:left;padding:7px 6px;border-bottom:1px solid var(--line);white-space:nowrap}
  .psb-tbl td{padding:7px 6px;border-bottom:1px solid var(--line);vertical-align:middle}
  .psb-tbl .r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .psb-tbl tr.t td{font-weight:700;border-top:2px solid var(--line);background:#fafafa}
  .psb-tbl tr.neg td{color:#b91c1c}
  .psb-tbl input,.psb-tbl select{width:100%;border:1px solid var(--line);border-radius:6px;padding:6px 7px;font-size:12.5px;font-family:inherit;background:var(--bg-card,#fff);color:var(--ink)}
  .psb-tbl input.n{width:72px}
  .psb-tbl input[type=checkbox]{width:auto}
  .psb-appl{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:12px}
  .psb-appl-h{display:flex;align-items:center;gap:10px;margin-bottom:4px}
  .psb-appl-h b{flex:1}
  .psb-kyc{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}
  .psb-bar{position:sticky;bottom:0;background:var(--bg,#f5f7fb);padding:12px 0;display:flex;gap:10px;justify-content:flex-end;border-top:1px solid var(--line);z-index:5}
  .psb-sum{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:10px}
  .psb-sum div{border:1px solid var(--line);border-radius:9px;padding:9px 11px;font-size:12px;color:var(--slate)}
  .psb-sum b{display:block;font-size:15px;color:var(--ink);margin-top:2px}
  @media (max-width:640px){ .psb-span2{grid-column:auto} }
  `;
  document.head.appendChild(st);
}

/* ---------------- shared list renderer: table on wide screens, cards on phones, 100 rows at a time ---------------- */
const LIM={};
window.psMore=function(key,fn){ LIM[key]=(LIM[key]||100)+200; window[fn](); };
function listHtml(key,fn,rows,head,row,card,empty,foot){
  const lim=LIM[key]||100, shown=rows.slice(0,lim);
  return '<div class="card ps-tablewrap" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+head+'</tr></thead><tbody>'
    +(shown.map(row).join('')||'<tr><td colspan="20">'+empty+'</td></tr>')+'</tbody>'+(rows.length&&foot?foot:'')+'</table></div></div>'
    +'<div class="ps-cards">'+(shown.map(card).join('')||empty)+'</div>'
    +(rows.length>lim?'<div class="ps-more">Showing '+lim+' of '+rows.length+' <button class="btn btn-sm" onclick="psMore(\''+key+'\',\''+fn+'\')"><i class="fa-solid fa-chevron-down"></i> Show more</button></div>':(rows.length>10?'<div class="ps-more">'+rows.length+' shown</div>':''));
}

/* ---------------- list ---------------- */
async function bookingList(host,stale){
  const data=await allRows(()=>PS().from('bookings').select('id,project_id,booking_no,booking_date,status,total_consideration,grand_total,is_non_standard,plan_name,flats(flat_code),towers(name),booking_applicants(full_name,seq)').order('booking_date',{ascending:false}).order('id',{ascending:false}));
  if(stale()) return;
  B.list=data||[];
  const pname=id=>{const p=S.projects.find(x=>x.id===id);return p?p.name:'';};
  const opts='<option value="">All projects</option>'+S.projects.map(p=>'<option value="'+p.id+'"'+(String(p.id)===String(B.pid||'')?' selected':'')+'>'+esc(p.name)+'</option>').join('');
  host.innerHTML='<div class="ps-head"><div class="t"><div class="sec-title">Bookings</div><div class="pss-hint" style="margin:2px 0 0">Tap a booking to see its cost sheet, payments, invoices and interest.</div></div><div class="acts"><button class="btn btn-primary" onclick="navTo(\'postsales/bookings/new\')"><i class="fa-solid fa-plus"></i> New booking</button></div></div>'
    +'<div class="ps-filters"><select id="psbProj" onchange="psbFilter()">'+opts+'</select>'
    +'<span class="mu-sw"><i class="fa-solid fa-magnifying-glass"></i><input id="psbQ" placeholder="Search booking no., flat or applicant" oninput="psbFilter()"></span></div>'
    +'<div id="psbList"></div>';
  window.psbFilter=function(){
    B.pid=val('psbProj')||null; const q=val('psbQ').toLowerCase();
    const rows=B.list.filter(b=>(!B.pid||String(b.project_id)===B.pid)&&(!q||[b.booking_no,b.flats&&b.flats.flat_code,b.towers&&b.towers.name,(b.booking_applicants||[]).map(a=>a.full_name).join(' ')].join(' ').toLowerCase().includes(q)));
    const st={active:'<span class="tag t-green">Active</span>',cancelled:'<span class="tag t-red">Cancelled</span>',transferred:'<span class="tag t-gray">Transferred</span>'};
    const aps=b=>(b.booking_applicants||[]).sort((x,y)=>x.seq-y.seq).map(a=>a.full_name);
    $('psbList').innerHTML=listHtml('bk','psbFilter',rows,
      '<th>Booking</th><th>Date</th><th>Flat</th><th>Applicants</th><th>Plan</th><th class="pss-num">Consideration</th><th class="pss-num">Incl. GST</th><th>Status</th>',
      b=>{const ap=aps(b);return '<tr onclick="navTo(\'postsales/bookings/'+b.id+'\')"><td><b>'+esc(b.booking_no)+'</b><div class="pss-hint" style="margin:0">'+esc(pname(b.project_id))+'</div></td><td>'+dmy(b.booking_date)+'</td><td>'+esc((b.towers&&b.towers.name||'')+' - '+(b.flats&&b.flats.flat_code||''))+'</td><td>'+esc(ap[0]||'')+(ap.length>1?' <span class="tag t-gray">+'+(ap.length-1)+'</span>':'')+'</td>'
          +'<td>'+esc(b.plan_name||'—')+(b.is_non_standard?' <span class="tag t-amber">Non-standard</span>':'')+'</td><td class="pss-num">'+inr(b.total_consideration)+'</td><td class="pss-num">'+inr(b.grand_total)+'</td><td>'+(st[b.status]||esc(b.status))+'</td></tr>';},
      b=>{const ap=aps(b);return '<div class="ps-card" onclick="navTo(\'postsales/bookings/'+b.id+'\')"><div class="r1"><b>'+esc(b.booking_no)+'</b><span class="amt">'+inr(b.grand_total)+'</span></div><div class="r2">'+esc((b.towers&&b.towers.name||'')+' - '+(b.flats&&b.flats.flat_code||''))+' · '+esc(ap[0]||'')+(ap.length>1?' +'+(ap.length-1):'')+'</div><div class="r3"><span>'+dmy(b.booking_date)+'</span><span>'+esc(pname(b.project_id))+'</span>'+(st[b.status]||'')+(b.is_non_standard?'<span class="tag t-amber">Non-standard</span>':'')+'</div></div>';},
      '<div class="empty"><i class="fa-solid fa-file-signature"></i><div>No bookings match</div></div>');
  };
  psbFilter();
}

/* ---------------- form ---------------- */
async function bookingForm(host,id,stale,fromId){
  let f;
  if(!id&&fromId){
    // Flat transfer: a new booking for the same applicants, keeping the original booking date.
    const [bk,ap]=await Promise.all([PS().from('bookings').select('*').eq('id',fromId).single(),PS().from('booking_applicants').select('*').eq('booking_id',fromId).order('seq')]);
    if(bk.error||bk.data.status!=='active'){ host.innerHTML='<div class="empty"><div>Only an active booking can be transferred</div></div>'; return; }
    const o=bk.data;
    await loadProject(o.project_id); S.pid=o.project_id;
    if(stale()) return;
    const plan=S.plans.find(p=>p.id===o.plan_id&&p.active);
    B.f={id:null,pid:o.project_id,towerId:o.tower_id,flatId:null,date:o.booking_date,rate:o.rate,discType:'none',discVal:'',parkId:o.parking_type_id,parkCount:o.parking_count,planId:plan?plan.id:null,ms:plan?planMilestones(plan.id):[],
      applicants:(ap.data||[]).map(a=>{const x=newApplicant();APPL_FIELDS.forEach(k=>x[k]=a[k]==null?'':a[k]);x.kyc=a.kyc||[];return x;}),
      d:{purpose:o.purpose||'',loan_required:o.loan_required==null?'':String(o.loan_required),loan_bank:o.loan_bank||'',source:o.source||'',reason_chosen:o.reason_chosen||'',sales_person:o.sales_person||'',crm_lead_id:o.crm_lead_id||'',remarks:'Transferred from '+o.booking_no},
      attachments:[],snap:null,transferFrom:o.id,transferFromNo:o.booking_no};
    drawForm(host); return;
  }
  if(id){
    const [bk,ap,ch,ms]=await Promise.all([
      PS().from('bookings').select('*').eq('id',id).single(),
      PS().from('booking_applicants').select('*').eq('booking_id',id).order('seq'),
      PS().from('booking_charges').select('*').eq('booking_id',id).order('seq'),
      PS().from('booking_milestones').select('*').eq('booking_id',id).order('seq')
    ]);
    if(bk.error){ host.innerHTML='<div class="empty"><div>Booking not found</div></div>'; return; }
    const b=bk.data;
    if(b.status!=='active'){ toast('Only an active booking can be edited','err'); navTo('postsales/bookings/'+id); return; }
    await loadProject(b.project_id); S.pid=b.project_id;
    if(stale()) return;
    f={id,pid:b.project_id,towerId:b.tower_id,flatId:b.flat_id,date:b.booking_date,rate:b.rate,discType:b.discount_type,discVal:b.discount_value,parkId:b.parking_type_id,parkCount:b.parking_count,planId:b.plan_id,
      ms:(ms.data||[]).map(m=>{const x={};MS_KEYS.forEach(k=>x[k]=m[k]);return x;}),
      applicants:(ap.data||[]).map(a=>{const x=newApplicant();APPL_FIELDS.forEach(k=>x[k]=a[k]==null?'':a[k]);x.kyc=a.kyc||[];return x;}),
      d:{purpose:b.purpose||'',loan_required:b.loan_required==null?'':String(b.loan_required),loan_bank:b.loan_bank||'',source:b.source||'',reason_chosen:b.reason_chosen||'',sales_person:b.sales_person||'',crm_lead_id:b.crm_lead_id||'',remarks:b.remarks||''},
      attachments:b.attachments||[], booking_no:b.booking_no,
      locked:((await PS().from('receipts').select('id',{count:'exact',head:true}).eq('booking_id',id).eq('status','active')).count||0)>0,
      snap:{flatId:b.flat_id,src:snapshotSource(ch.data||[],b.parking_type_id)}};
  }else{
    const pid=B.pid?Number(B.pid):(S.pid||null);
    f={id:null,pid,towerId:null,flatId:null,date:today(),rate:'',discType:'none',discVal:'',parkId:null,parkCount:0,planId:null,ms:[],applicants:[newApplicant()],d:{purpose:'residential',loan_required:'',loan_bank:'',source:'',reason_chosen:'',sales_person:'',crm_lead_id:'',remarks:''},attachments:[],snap:null};
    if(pid){ await loadProject(pid); S.pid=pid; if(stale()) return; }
  }
  B.f=f;
  drawForm(host);
}
function drawForm(host){
  const f=B.f;
  const setupOk=f.pid&&S.setup;
  const projOpts='<option value="">Choose a project…</option>'+S.projects.map(p=>'<option value="'+p.id+'"'+(p.id===f.pid?' selected':'')+'>'+esc(p.name)+'</option>').join('');
  let html='<div class="toolbar"><button class="btn btn-sm btn-ghost" onclick="navTo(\'postsales/bookings'+(f.id?'/'+f.id:'')+'\')"><i class="fa-solid fa-arrow-left"></i> '+(f.id?'Back to booking':'Bookings')+'</button><div class="sec-title" style="margin:0;flex:1">'+(f.id?'Edit booking '+esc(f.booking_no):'New booking')+'</div></div>';
  if(f.transferFrom) html+='<div class="pss-banner"><i class="fa-solid fa-right-left" style="color:#7c3aed"></i><div class="grow"><b>Flat transfer from '+esc(f.transferFromNo)+'.</b> Choose the new flat and price it as a normal booking - the original booking date '+dmy(f.date)+' is kept. On save, '+esc(f.transferFromNo)+' is closed as transferred, its open invoices are cancelled, its flat becomes available, and everything paid on it moves to this booking (no transfer charge).</div></div>';
  if(f.locked) html+='<div class="pss-banner"><i class="fa-solid fa-lock"></i><div class="grow">Payments have been received on this booking, so its flat, pricing and payment plan are fixed - only the applicants and booking details below will be saved.</div></div>';
  else if(f.id) html+='<div class="pss-banner"><i class="fa-solid fa-circle-info"></i><div class="grow">No payment received yet - changing the pricing or plan cancels this booking\'s open invoices and raises them again from the new figures.</div></div>';
  html+='<div class="psb-sec"><h3><span class="n">1</span> Flat</h3><div class="frm psb-grid">'
    +'<div><label>Project</label><select id="psbP" onchange="psbSetProject(this.value)"'+(f.id?' disabled':'')+'>'+projOpts+'</select></div>';
  if(f.pid&&!S.setup){ host.innerHTML=html+'</div><div class="pss-banner"><i class="fa-solid fa-circle-info"></i><div class="grow">This project isn\'t set up for bookings yet - give it a code, towers and a payment plan in Setup first.</div><button class="btn btn-primary btn-sm" onclick="navTo(\'postsales/setup/'+f.pid+'/project\')">Open Setup</button></div></div>'; return; }
  if(!f.pid){ host.innerHTML=html+'</div></div>'; return; }
  const towOpts='<option value="">Choose…</option>'+S.towers.map(t=>'<option value="'+t.id+'"'+(t.id===f.towerId?' selected':'')+'>'+esc(t.name)+'</option>').join('');
  const flats=S.flats.filter(x=>x.tower_id===f.towerId&&(x.status==='available'||x.id===(f.snap&&f.snap.flatId))).sort((a,b)=>{const fa=S.floors.find(z=>z.id===a.floor_id),fb=S.floors.find(z=>z.id===b.floor_id);return (fa?fa.floor_no:0)-(fb?fb.floor_no:0)||a.flat_code.localeCompare(b.flat_code);});
  const flatOpts='<option value="">'+(f.towerId?(flats.length?'Choose…':'No available flats'):'Choose a tower first')+'</option>'+flats.map(x=>'<option value="'+x.id+'"'+(x.id===f.flatId?' selected':'')+'>'+esc(x.flat_code)+(x.bhk?' · '+esc(x.bhk):'')+' · '+num(x.sba_sqft)+' sq ft</option>').join('');
  html+='<div><label>Tower</label><select id="psbT" onchange="psbSet(\'towerId\',this.value?Number(this.value):null,1)">'+towOpts+'</select></div>'
    +'<div><label>Flat (available)</label><select id="psbF" onchange="psbSetFlat(this.value)">'+flatOpts+'</select></div>'
    +'<div><label>Booking / application date</label><input type="date" id="psbD" value="'+esc(f.date)+'" onchange="psbSet(\'date\',this.value)"></div>'
    +'</div><div id="psbFlatFacts"></div></div>';
  // 2 pricing
  const tower=S.towers.find(t=>t.id===f.towerId);
  const parkOpts='<option value="">No parking</option>'+S.parking.map(p=>'<option value="'+p.id+'"'+(p.id===f.parkId?' selected':'')+'>'+esc(p.name)+' · '+inr(p.price)+'</option>').join('');
  html+='<div class="psb-sec"><h3><span class="n">2</span> Pricing</h3><div class="frm psb-grid">'
    +'<div><label>Booking rate per sq ft (super built-up)</label><input type="number" step="0.01" id="psbRate" value="'+esc(f.rate)+'" placeholder="'+(tower&&tower.base_rate!=null?'List rate '+num(tower.base_rate):'')+'" oninput="psbSet(\'rate\',this.value)"></div>'
    +'<div><label>Discount</label><select id="psbDT" onchange="psbSet(\'discType\',this.value,1)"><option value="none"'+(f.discType==='none'?' selected':'')+'>No discount</option><option value="per_sqft"'+(f.discType==='per_sqft'?' selected':'')+'>Per sq ft</option><option value="lump_sum"'+(f.discType==='lump_sum'?' selected':'')+'>Lump sum</option></select></div>'
    +(f.discType!=='none'?'<div><label>'+(f.discType==='per_sqft'?'Discount ₹ per sq ft':'Discount ₹ (lump sum)')+'</label><input type="number" step="0.01" id="psbDV" value="'+esc(f.discVal)+'" oninput="psbSet(\'discVal\',this.value)"></div>':'')
    +'<div><label>Car parking</label><select id="psbPk" onchange="psbSet(\'parkId\',this.value?Number(this.value):null,1)">'+parkOpts+'</select></div>'
    +(f.parkId?'<div><label>Number of spaces</label><input type="number" min="1" id="psbPkN" value="'+esc(f.parkCount||1)+'" oninput="psbSet(\'parkCount\',this.value)"></div>':'')
    +'</div>'+(f.snap&&f.snap.flatId===f.flatId?'<div class="pss-hint" style="margin-top:8px"><i class="fa-solid fa-lock"></i> PLC, floor rise, charges and GST rates are the ones locked on this booking when it was made.</div>':'')
    +'<div id="psbCost" style="margin-top:12px"></div></div>';
  // 3 plan
  const plans=S.plans.filter(p=>p.active||p.id===f.planId);
  html+='<div class="psb-sec"><h3><span class="n">3</span> Payment plan <span id="psbStd"></span></h3><div class="frm psb-grid"><div class="psb-span2"><label>Standard plan</label><select id="psbPl" onchange="psbSetPlan(this.value)"><option value="">Choose…</option>'+plans.map(p=>'<option value="'+p.id+'"'+(p.id===f.planId?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></div></div>'
    +'<div class="pss-hint" style="margin-top:8px">Edit any milestone below to make a non-standard plan for this booking only - no approval needed.</div>'
    +'<div style="overflow-x:auto"><table class="psb-tbl" style="margin-top:6px"><thead><tr><th>#</th><th style="min-width:220px">Milestone</th><th>Trigger</th><th>Fixed ₹</th><th>Less bkg</th><th>Unit %</th><th>Parking %</th><th>EDC %</th><th class="r">Unit</th><th class="r">Parking</th><th class="r">EDC</th><th class="r">Gross</th><th></th></tr></thead><tbody id="psbMs"></tbody><tfoot id="psbMsT"></tfoot></table></div>'
    +'<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-sm" onclick="psbMsAdd()"><i class="fa-solid fa-plus"></i> Add milestone</button><button class="btn btn-sm btn-ghost" id="psbReset" onclick="psbSetPlan(B.f.planId)"><i class="fa-solid fa-rotate-left"></i> Reset to standard</button></div></div>';
  // 4 applicants
  html+='<div class="psb-sec"><h3><span class="n">4</span> Applicants</h3><div class="pss-hint">The first applicant is the one the Customer Portal login and all correspondence go to.</div><div id="psbAppl"></div><button class="btn btn-sm" onclick="psbApplAdd()"><i class="fa-solid fa-user-plus"></i> Add joint applicant</button></div>';
  // 5 details
  const d=f.d;
  html+='<div class="psb-sec"><h3><span class="n">5</span> Booking details</h3><div class="frm psb-grid">'
    +'<div><label>Purpose</label><select onchange="psbSetD(\'purpose\',this.value)"><option value="residential"'+(d.purpose==='residential'?' selected':'')+'>Residential</option><option value="investment"'+(d.purpose==='investment'?' selected':'')+'>Investment</option></select></div>'
    +'<div><label>Loan required</label><select onchange="psbSetD(\'loan_required\',this.value,1)"><option value="">—</option><option value="true"'+(d.loan_required==='true'?' selected':'')+'>Yes</option><option value="false"'+(d.loan_required==='false'?' selected':'')+'>No</option></select></div>'
    +(d.loan_required==='true'?'<div><label>Preferred bank / institution</label><input value="'+esc(d.loan_bank)+'" oninput="psbSetD(\'loan_bank\',this.value)"></div>':'')
    +'<div><label>How did they hear about the project</label><input list="psbSrc" value="'+esc(d.source)+'" oninput="psbSetD(\'source\',this.value)"><datalist id="psbSrc">'+SOURCES.map(s=>'<option value="'+esc(s)+'">').join('')+'</datalist></div>'
    +'<div><label>Why they chose it</label><input value="'+esc(d.reason_chosen)+'" oninput="psbSetD(\'reason_chosen\',this.value)"></div>'
    +'<div><label>Sales person / booking agent</label><input value="'+esc(d.sales_person)+'" oninput="psbSetD(\'sales_person\',this.value)"></div>'
    +'<div><label>CRM Lead ID</label><input value="'+esc(d.crm_lead_id)+'" oninput="psbSetD(\'crm_lead_id\',this.value)"></div>'
    +'<div class="psb-span2"><label>Remarks</label><input value="'+esc(d.remarks)+'" oninput="psbSetD(\'remarks\',this.value)"></div>'
    +'</div><div class="psb-kyc" id="psbAtt"></div></div>';
  html+='<div class="psb-bar"><button class="btn" onclick="navTo(\'postsales/bookings'+(f.id?'/'+f.id:'')+'\')">Cancel</button><button class="btn btn-primary" id="psbSave" onclick="psbSave()"><i class="fa-solid fa-floppy-disk"></i> '+(f.id?'Save changes':'Save booking')+'</button></div>';
  host.innerHTML=html;
  drawAppl(); drawAtt(); recalc(true);
}
function formHost(){ return $('psbBody'); }
window.psbSetProject=async function(v){
  const pid=v?Number(v):null; B.f.pid=pid; B.pid=v||null; B.f.towerId=null; B.f.flatId=null; B.f.planId=null; B.f.ms=[]; B.f.parkId=null;
  if(pid){ const h=formHost(); await loadProject(pid); S.pid=pid; }
  drawForm(formHost());
};
window.psbSet=function(k,v,redraw){
  B.f[k]=v;
  if(k==='towerId'){ B.f.flatId=null; }
  if(k==='parkId'&&v&&!num(B.f.parkCount)) B.f.parkCount=1;
  if(k==='parkId'&&!v) B.f.parkCount=0;
  if(redraw){ keepScroll(()=>drawForm(formHost())); } else recalc();
};
function keepScroll(fn){ const y=window.scrollY; fn(); window.scrollTo(0,y); }
window.psbSetFlat=function(v){
  B.f.flatId=v?Number(v):null;
  const fl=S.flats.find(x=>x.id===B.f.flatId), t=fl&&S.towers.find(x=>x.id===fl.tower_id);
  if(fl&&!num(B.f.rate)&&t&&t.base_rate!=null){ B.f.rate=t.base_rate; const r=$('psbRate'); if(r) r.value=t.base_rate; }
  keepScroll(()=>drawForm(formHost()));
};
window.psbSetPlan=function(v){
  B.f.planId=v?Number(v):null;
  B.f.ms=B.f.planId?planMilestones(B.f.planId):[];
  const p=S.plans.find(x=>x.id===B.f.planId);
  recalc(true);
};
window.psbSetD=function(k,v,redraw){ B.f.d[k]=v; if(redraw) keepScroll(()=>drawForm(formHost())); };

function recalc(full){
  const f=B.f, pr=priceBooking(f);
  // flat facts
  const ff=$('psbFlatFacts');
  if(ff){
    if(pr){ const src=rateSource(pr.flat,f.snap);
      ff.innerHTML='<div class="psb-facts"><span>Floor <b>'+esc(pr.floor?(pr.floor.label||ordinal(pr.floor.floor_no)):'—')+'</b></span><span>Super built-up <b>'+num(pr.flat.sba_sqft)+' sq ft</b></span><span>Built-up <b>'+(pr.flat.built_up_sqft!=null?num(pr.flat.built_up_sqft):'—')+'</b></span><span>Carpet <b>'+(pr.flat.carpet_sqft!=null?num(pr.flat.carpet_sqft):'—')+'</b></span><span>BHK <b>'+esc(pr.flat.bhk||'—')+'</b></span><span>PLC <b>'+(src.plcs.length?esc(src.plcs.map(p=>p.name+' '+rate(p.rate)).join(', ')):'None')+'</b></span><span>Floor rise <b>'+(src.frc?rate(src.frc.rate)+'/sq ft':'None')+'</b></span></div>';
    } else ff.innerHTML='';
  }
  // cost sheet
  const cs=$('psbCost');
  if(cs){
    if(!pr||!num(f.rate)){ cs.innerHTML='<div class="pss-hint">Choose a flat and enter the booking rate to build the cost sheet.</div>'; }
    else{
      const row=l=>'<tr'+(l.amount<0?' class="neg"':'')+'><td>'+esc(l.name)+'</td><td class="r">'+(l.basis==='per_sqft'?rate(l.rate)+' × '+num(l.qty):l.kind==='parking'?inr(l.rate)+' × '+num(l.qty):l.basis==='pct_unit'?pct(l.rate)+' of unit':'Fixed')+'</td><td class="r">'+inr(l.amount)+'</td><td class="r">'+pct(l.gst_rate)+'</td><td class="r">'+inr(l.gst_amount)+'</td><td class="r">'+inr(l.amount+l.gst_amount)+'</td></tr>';
      const sub=(lbl,c)=>'<tr class="t"><td colspan="2">'+lbl+'</td><td class="r">'+inr(c.net)+'</td><td></td><td class="r">'+inr(c.gst)+'</td><td class="r">'+inr(c.net+c.gst)+'</td></tr>';
      const L=k=>pr.lines.filter(l=>l.col===k);
      cs.innerHTML='<div style="overflow-x:auto"><table class="psb-tbl"><thead><tr><th>Particulars</th><th class="r">Rate</th><th class="r">Amount</th><th class="r">GST</th><th class="r">GST amount</th><th class="r">Gross</th></tr></thead><tbody>'
        +L('unit').map(row).join('')+sub('Total flat value',pr.tot.unit)
        +(L('parking').length?L('parking').map(row).join('')+sub('Total parking',pr.tot.parking):'')
        +(L('edc').length?L('edc').map(row).join('')+sub('Total extra development charges',pr.tot.edc):'')
        +'</tbody></table></div>'
        +'<div class="psb-sum"><div>Total consideration (excl. GST)<b>'+inr(pr.tot.consideration)+'</b></div><div>GST<b>'+inr(pr.tot.gst)+'</b></div><div>Grand total<b>'+inr(pr.tot.grand)+'</b></div></div>';
    }
  }
  // schedule
  const tb=$('psbMs');
  if(tb){
    const sc=pr&&num(f.rate)?pr.schedule:null;
    if(full){
      const stOpts=(m,lvl)=>S.stages.filter(s=>s.level===lvl).map(s=>'<option value="'+s.id+'"'+(m.stage_id===s.id?' selected':'')+'>'+esc(s.name)+'</option>').join('');
      tb.innerHTML=f.ms.map((m,i)=>'<tr><td style="color:var(--slate)">'+(i+1)+'</td>'
        +'<td><input value="'+esc(m.name||'')+'" oninput="psbMs('+i+',\'name\',this.value)"><div class="pss-hint" style="margin:2px 0 0;font-size:11px">'+(m.trigger_type==='individual'?(m.due_days!=null&&m.due_days!==''?'Due '+m.due_days+' days after booking':'Raised by hand'):'<select style="font-size:11px;padding:3px" onchange="psbMs('+i+',\'stage_id\',this.value?Number(this.value):null)"><option value="">Choose stage…</option>'+stOpts(m,m.trigger_type)+'</select>')+'</div></td>'
        +'<td><select onchange="psbMs('+i+',\'trigger_type\',this.value,1)">'+Object.keys(TRIGGER_LBL).map(k=>'<option value="'+k+'"'+(m.trigger_type===k?' selected':'')+'>'+TRIGGER_LBL[k]+'</option>').join('')+'</select>'+(m.trigger_type==='individual'?'<input class="n" type="number" placeholder="days" title="Days after booking" style="margin-top:3px" value="'+(m.due_days!=null?m.due_days:'')+'" oninput="psbMs('+i+',\'due_days\',this.value===\'\'?null:parseInt(this.value,10))">':'')+'</td>'
        +'<td><input class="n" type="number" value="'+(m.fixed_amount!=null&&num(m.fixed_amount)?m.fixed_amount:'')+'" oninput="psbMs('+i+',\'fixed_amount\',this.value)"></td>'
        +'<td style="text-align:center"><input type="checkbox"'+(m.less_fixed?' checked':'')+' onchange="psbMs('+i+',\'less_fixed\',this.checked)"></td>'
        +['unit_pct','parking_pct','edc_pct'].map(k=>'<td><input class="n" type="number" step="0.001" value="'+(num(m[k])?m[k]:'')+'" oninput="psbMs('+i+',\''+k+'\',this.value)"></td>').join('')
        +'<td class="r" id="psbMu'+i+'"></td><td class="r" id="psbMp'+i+'"></td><td class="r" id="psbMe'+i+'"></td><td class="r" id="psbMg'+i+'"></td>'
        +'<td><button class="btn btn-sm btn-ghost" title="Remove" onclick="psbMsDel('+i+')"><i class="fa-solid fa-xmark"></i></button></td></tr>').join('')
        ||'<tr><td colspan="13" style="text-align:center;color:var(--slate);padding:14px">Choose a standard plan.</td></tr>';
    }
    f.ms.forEach((m,i)=>{const r=sc&&sc[i];[['u','Mu'],['p','Mp'],['e','Me']].forEach(([k,id])=>{const e=$('psb'+id+i);if(e)e.textContent=r?inr(r[k]):'';});const g=$('psbMg'+i);if(g)g.innerHTML=r?'<b>'+inr(r.gross_total)+'</b>':'';});
    const t=planTotals(f.ms), ft=$('psbMsT');
    if(ft){
      const c=v=>'<span class="'+(near(v,100)?'pss-ok':'pss-bad')+'">'+pct(v)+'</span>';
      const sum=k=>sc?sc.reduce((s,r)=>s+r[k],0):0;
      ft.innerHTML=f.ms.length?'<tr class="t"><td></td><td>Total</td><td></td><td>'+(t.f?inr(t.f):'')+'</td><td></td><td>'+c(t.u)+'</td><td>'+c(t.p)+'</td><td>'+c(t.e)+'</td><td class="r">'+(sc?inr(sum('u')):'')+'</td><td class="r">'+(sc?inr(sum('p')):'')+'</td><td class="r">'+(sc?inr(sum('e')):'')+'</td><td class="r">'+(sc?inr(sum('gross_total')):'')+'</td><td></td></tr>':'';
    }
  }
  const std=$('psbStd'), rs=$('psbReset');
  if(std){ const ns=f.ms.length&&isNonStandard(f); std.innerHTML=!f.ms.length?'':ns?'<span class="tag t-amber">Non-standard</span>':'<span class="tag t-green">Standard</span>'; if(rs) rs.style.display=ns&&f.planId?'':'none'; }
}
window.psbMs=function(i,k,v,redraw){ const m=B.f.ms[i]; if(!m) return; m[k]=v; if(k==='trigger_type'){ m.stage_id=null; if(v!=='individual') m.due_days=null; } recalc(!!redraw); };
window.psbMsAdd=function(){ B.f.ms.push({name:'',trigger_type:'individual',due_days:null,stage_id:null,fixed_amount:null,less_fixed:false,unit_pct:0,edc_pct:0,parking_pct:0}); recalc(true); };
window.psbMsDel=function(i){ B.f.ms.splice(i,1); recalc(true); };

/* applicants */
function drawAppl(){
  const h=$('psbAppl'); if(!h) return;
  const f=B.f;
  const inp=(i,k,lbl,type,extra)=>'<div'+(extra&&extra.span?' class="psb-span2"':'')+'><label>'+lbl+'</label><input'+(type?' type="'+type+'"':'')+' value="'+esc(f.applicants[i][k]==null?'':f.applicants[i][k])+'" oninput="psbA('+i+',\''+k+'\',this.value)"'+(extra&&extra.ph?' placeholder="'+esc(extra.ph)+'"':'')+(extra&&extra.up?' class="pss-up"':'')+'></div>';
  const sel=(i,k,lbl,opts,redraw)=>'<div><label>'+lbl+'</label><select onchange="psbA('+i+',\''+k+'\',this.value'+(redraw?',1':'')+')">'+opts.map(o=>'<option value="'+esc(o[0])+'"'+(String(f.applicants[i][k])===String(o[0])?' selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select></div>';
  h.innerHTML=f.applicants.map((a,i)=>'<div class="psb-appl"><div class="psb-appl-h"><b>'+(i===0?'First / sole applicant':ordinal(i+1).replace('Ground','')+' applicant (joint)')+'</b>'+(i>0?'<button class="btn btn-sm btn-ghost" onclick="psbApplMove('+i+')" title="Make this the first applicant"><i class="fa-solid fa-arrow-up"></i></button><button class="btn btn-sm btn-ghost" onclick="psbApplDel('+i+')" title="Remove"><i class="fa-solid fa-trash"></i></button>':'')+'</div>'
    +'<div class="frm psb-grid">'
    +sel(i,'title','Title',[['Mr.','Mr.'],['Ms.','Ms.'],['Mrs.','Mrs.'],['Mast.','Mast.'],['M/s','M/s'],['Dr.','Dr.']])
    +inp(i,'full_name','Full name *','',{span:1})
    +sel(i,'relation_type','Relation',[['S/o','S/o'],['D/o','D/o'],['W/o','W/o'],['C/o','C/o']])
    +inp(i,'relation_name','Father / husband / guardian name')
    +inp(i,'dob','Date of birth','date')
    +inp(i,'pan','PAN','',{up:1,ph:'ABCDE1234F'})
    +inp(i,'aadhaar','Aadhaar','',{ph:'12-digit number'})
    +sel(i,'resident_status','Resident status',[['resident','Resident Indian'],['nri','NRI'],['foreigner','Foreign national']],1)
    +inp(i,'nationality','Nationality')
    +inp(i,'passport_no','Passport no.')
    +(a.resident_status!=='resident'?inp(i,'nri_bank_details','Bank account details (NRI / foreign)','',{span:1}):'')
    +inp(i,'spouse_name','Spouse name')
    +inp(i,'anniversary','Marriage anniversary','date')
    +sel(i,'occupation','Occupation',[['','—']].concat(Object.keys(OCC_LBL).map(k=>[k,OCC_LBL[k]])))
    +inp(i,'company','Company')
    +inp(i,'designation','Designation')
    +inp(i,'gross_income','Gross annual income (optional)','number')
    +inp(i,'mobile','Mobile'+(i===0?' *':''),'tel')
    +inp(i,'phone_res','Phone (residence)','tel')
    +inp(i,'phone_off','Phone (office)','tel')
    +inp(i,'email','Email'+(i===0?' *':''),'email')
    +'</div><div class="frm psb-grid wide">'
    +'<div><label>Residential address</label><textarea oninput="psbA('+i+',\'res_address\',this.value)" style="min-height:60px">'+esc(a.res_address||'')+'</textarea></div>'
    +'<div><label>Office address</label><textarea oninput="psbA('+i+',\'off_address\',this.value)" style="min-height:60px">'+esc(a.off_address||'')+'</textarea></div>'
    +'</div><div class="frm psb-grid">'
    +sel(i,'mailing_address','Mailing address',[['residential','Residential'],['office','Office']])
    +sel(i,'permanent_address','Permanent address',[['residential','Residential'],['office','Office']])
    +'</div>'
    +'<div class="psb-kyc"><span style="font-size:12.5px;font-weight:600">KYC:</span>'+(a.kyc||[]).map((k,j)=>'<span class="tag t-blue" style="cursor:pointer" onclick="s3OpenSigned(\''+esc(k.path)+'\')"><i class="fa-solid fa-paperclip"></i> '+esc(k.type)+': '+esc(k.name)+' <i class="fa-solid fa-xmark" style="margin-left:4px" onclick="event.stopPropagation();psbKycDel('+i+','+j+')"></i></span>').join('')
    +'<select id="psbKt'+i+'" style="height:30px;border:1px solid var(--line);border-radius:6px;font-size:12.5px">'+KYC_TYPES.map(t=>'<option>'+t+'</option>').join('')+'</select><label class="btn btn-sm" style="margin:0"><i class="fa-solid fa-upload"></i> Upload<input type="file" style="display:none" accept="image/*,application/pdf" onchange="psbKycUp('+i+',this)"></label></div>'
    +'</div>').join('');
}
window.psbA=function(i,k,v,redraw){ B.f.applicants[i][k]=v; if(redraw) drawAppl(); };
window.psbApplAdd=function(){ const a=newApplicant(); a.title='Mrs.'; a.relation_type='W/o'; B.f.applicants.push(a); drawAppl(); };
window.psbApplDel=function(i){ B.f.applicants.splice(i,1); drawAppl(); };
window.psbApplMove=function(i){ const a=B.f.applicants.splice(i,1)[0]; B.f.applicants.unshift(a); drawAppl(); };
window.psbKycUp=async function(i,input){
  const file=input.files&&input.files[0]; if(!file) return;
  const type=val('psbKt'+i)||'Other';
  toast('Uploading '+file.name+'…');
  const r=await uploadFileToS3('postsales/bookings/kyc/'+s3Stamp()+'_'+s3SafeName(file.name),file);
  if(r.error){ toast('Upload failed: '+r.error.message,'err'); return; }
  B.f.applicants[i].kyc=(B.f.applicants[i].kyc||[]).concat([{type,name:file.name,path:r.data.path}]);
  toast('Uploaded','ok'); drawAppl();
};
window.psbKycDel=function(i,j){ B.f.applicants[i].kyc.splice(j,1); drawAppl(); };
function drawAtt(){
  const h=$('psbAtt'); if(!h) return;
  h.innerHTML='<span style="font-size:12.5px;font-weight:600">Attachments (application form, payment proof):</span>'+B.f.attachments.map((a,j)=>'<span class="tag t-blue" style="cursor:pointer" onclick="s3OpenSigned(\''+esc(a.path)+'\')"><i class="fa-solid fa-paperclip"></i> '+esc(a.name)+' <i class="fa-solid fa-xmark" style="margin-left:4px" onclick="event.stopPropagation();psbAttDel('+j+')"></i></span>').join('')
    +'<label class="btn btn-sm" style="margin:0"><i class="fa-solid fa-upload"></i> Upload<input type="file" style="display:none" accept="image/*,application/pdf" onchange="psbAttUp(this)"></label>';
}
window.psbAttUp=async function(input){
  const file=input.files&&input.files[0]; if(!file) return;
  toast('Uploading '+file.name+'…');
  const r=await uploadFileToS3('postsales/bookings/docs/'+s3Stamp()+'_'+s3SafeName(file.name),file);
  if(r.error){ toast('Upload failed: '+r.error.message,'err'); return; }
  B.f.attachments=B.f.attachments.concat([{name:file.name,path:r.data.path}]); toast('Uploaded','ok'); drawAtt();
};
window.psbAttDel=function(j){ B.f.attachments.splice(j,1); drawAtt(); };

window.psbSave=async function(){
  const f=B.f, pr=priceBooking(f);
  const err=m=>{toast(m,'err');return false;};
  if(!pr) return err('Choose the flat');
  if(!(num(f.rate)>0)) return err('Enter the booking rate');
  if(!f.date) return err('Enter the booking date');
  const ms=f.ms.filter(m=>String(m.name||'').trim());
  if(!ms.length) return err('Choose a payment plan');
  const badStage=ms.find(m=>m.trigger_type!=='individual'&&!m.stage_id); if(badStage) return err('Choose the construction stage for "'+badStage.name+'"');
  const t=planTotals(ms);
  if(!near(t.u,100)) return err('Unit % in the payment plan adds up to '+pct(t.u)+' - it must be 100%');
  if(pr.tot.parking.net&&!near(t.p,100)) return err('Parking % adds up to '+pct(t.p)+' - it must be 100% when parking is booked');
  if(pr.tot.edc.net&&!near(t.e,100)) return err('EDC % adds up to '+pct(t.e)+' - it must be 100%');
  const ap=f.applicants;
  if(!ap.length||!String(ap[0].full_name).trim()) return err('Enter the first applicant\'s name');
  if(!String(ap[0].mobile).trim()) return err('Enter the first applicant\'s mobile');
  if(!/^\S+@\S+\.\S+$/.test(String(ap[0].email).trim())) return err('Enter a valid email for the first applicant - it is their Customer Portal login');
  for(let i=0;i<ap.length;i++){
    if(!String(ap[i].full_name).trim()) return err('Enter a name for applicant '+(i+1)+' or remove it');
    const pan=String(ap[i].pan||'').trim().toUpperCase();
    if(pan&&!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return err('PAN of '+ap[i].full_name+' doesn\'t look right (e.g. ABCDE1234F)');
    const ad=String(ap[i].aadhaar||'').replace(/\s/g,'');
    if(ad&&!/^\d{12}$/.test(ad)) return err('Aadhaar of '+ap[i].full_name+' should be 12 digits');
  }
  const sc=schedule(ms,pr.tot);
  const plan=S.plans.find(p=>p.id===f.planId);
  const payload={
    booking:{flat_id:pr.flat.id,booking_date:f.date,sba_sqft:pr.sba,floor_no:pr.floor?pr.floor.floor_no:0,rate:num(f.rate),
      discount_type:f.discType,discount_value:f.discType==='none'?0:num(f.discVal),parking_type_id:f.parkId||'',parking_count:f.parkId?num(f.parkCount):0,
      plan_id:f.planId||'',plan_name:plan?plan.name:'Custom',is_non_standard:isNonStandard({...f,ms}),
      unit_net:pr.tot.unit.net,unit_gst:pr.tot.unit.gst,parking_net:pr.tot.parking.net,parking_gst:pr.tot.parking.gst,edc_net:pr.tot.edc.net,edc_gst:pr.tot.edc.gst,
      total_consideration:pr.tot.consideration,grand_total:pr.tot.grand,
      purpose:f.d.purpose,loan_required:f.d.loan_required===''?null:f.d.loan_required==='true',loan_bank:f.d.loan_bank,source:f.d.source,reason_chosen:f.d.reason_chosen,sales_person:f.d.sales_person,crm_lead_id:f.d.crm_lead_id,remarks:f.d.remarks,attachments:f.attachments},
    applicants:ap.map((a,i)=>{const x={seq:i+1};APPL_FIELDS.forEach(k=>{let v=a[k];if(typeof v==='string')v=v.trim();x[k]=(v===''?null:v);});x.aadhaar=x.aadhaar?String(x.aadhaar).replace(/\s/g,''):null;x.kyc=a.kyc||[];return x;}),
    charges:pr.lines,
    milestones:ms.map((m,i)=>({seq:i+1,name:String(m.name).trim(),trigger_type:m.trigger_type,due_days:m.trigger_type==='individual'&&m.due_days!==''&&m.due_days!=null?parseInt(m.due_days,10):null,stage_id:m.trigger_type==='individual'?null:m.stage_id,
      fixed_amount:num(m.fixed_amount)||null,less_fixed:!!m.less_fixed,unit_pct:num(m.unit_pct),edc_pct:num(m.edc_pct),parking_pct:num(m.parking_pct),
      unit_net:sc[i].unit_net,unit_gst:sc[i].unit_gst,parking_net:sc[i].parking_net,parking_gst:sc[i].parking_gst,edc_net:sc[i].edc_net,edc_gst:sc[i].edc_gst,gross_total:sc[i].gross_total}))
  };
  const btn=$('psbSave'); if(btn){btn.disabled=true;}
  const {data,error}=await PS().rpc('save_booking',{p_booking_id:f.id,p:payload});
  if(btn) btn.disabled=false;
  if(fail(error,'Could not save the booking')) return;
  if(f.transferFrom){
    const tr=await PS().rpc('transfer_booking',{p:{from_id:f.transferFrom,to_id:data,date:today()}});
    if(tr.error){ toast('The new booking was saved, but the transfer did not go through: '+tr.error.message+' - open '+f.transferFromNo+' and transfer again.','err'); navTo('postsales/bookings/'+data); return; }
    toast('Transferred - '+inr(tr.data.amount)+' moved from '+f.transferFromNo+(tr.data.ptc?' ('+tr.data.ptc+')':''),'ok');
    navTo('postsales/bookings/'+data); return;
  }
  toast(f.id?'Booking updated':'Booking saved','ok');
  navTo('postsales/bookings/'+data);
};

/* ---------------- view + Estimated Offer Price ---------------- */
async function loadBooking(id){
  const [bk,ap,ch,ms]=await Promise.all([
    PS().from('bookings').select('*,flats(flat_code,bhk,built_up_sqft,carpet_sqft),towers(name)').eq('id',id).single(),
    PS().from('booking_applicants').select('*').eq('booking_id',id).order('seq'),
    PS().from('booking_charges').select('*').eq('booking_id',id).order('seq'),
    PS().from('booking_milestones').select('*').eq('booking_id',id).order('seq')
  ]);
  if(bk.error) return null;
  return {b:bk.data,ap:ap.data||[],ch:ch.data||[],ms:ms.data||[]};
}
async function bookingView(host,id,stale){
  const v=await loadBooking(id);
  if(stale()) return;
  if(!v){ host.innerHTML='<div class="empty"><div>Booking not found</div></div>'; return; }
  B.view=v;
  if(!S.stages.length||S.pid!==v.b.project_id){ await loadProject(v.b.project_id); S.pid=v.b.project_id; if(stale()) return; }
  const {b,ap,ch,ms}=v, proj=S.projects.find(p=>p.id===b.project_id);
  const stName=sid=>{const s=S.stages.find(x=>x.id===sid);return s?s.name:'';};
  const st={active:'<span class="tag t-green">Active</span>',cancelled:'<span class="tag t-red">Cancelled</span>',transferred:'<span class="tag t-gray">Transferred</span>'}[b.status]||'';
  const fact=(l,x)=>'<span>'+esc(l)+' <b>'+x+'</b></span>';
  const applHtml=ap.map(a=>'<div class="psb-appl"><div class="psb-appl-h"><b>'+(a.seq===1?'First applicant':'Joint applicant '+a.seq)+' - '+esc([a.title,a.full_name].filter(Boolean).join(' '))+'</b></div><div class="psb-facts" style="margin-top:2px">'
    +(a.relation_name?fact(a.relation_type||'',esc(a.relation_name)):'')+(a.dob?fact('DOB',dmy(a.dob)):'')+(a.pan?fact('PAN',esc(a.pan)):'')+(a.aadhaar?fact('Aadhaar','XXXX XXXX '+esc(String(a.aadhaar).slice(-4))):'')
    +(a.mobile?fact('Mobile',esc(a.mobile)):'')+(a.email?fact('Email',esc(a.email)):'')+(a.occupation?fact('Occupation',esc(OCC_LBL[a.occupation]||a.occupation)):'')+(a.company?fact('Company',esc(a.company)+(a.designation?', '+esc(a.designation):'')):'')
    +(a.resident_status&&a.resident_status!=='resident'?fact('Status',a.resident_status==='nri'?'NRI':'Foreign national'):'')+'</div>'
    +(a.res_address?'<div class="pss-hint" style="margin:6px 0 0">Residential: '+esc(a.res_address)+(a.mailing_address==='residential'?' <span class="tag t-gray">Mailing</span>':'')+'</div>':'')
    +(a.off_address?'<div class="pss-hint" style="margin:2px 0 0">Office: '+esc(a.off_address)+(a.mailing_address==='office'?' <span class="tag t-gray">Mailing</span>':'')+'</div>':'')
    +((a.kyc||[]).length?'<div class="psb-kyc">'+a.kyc.map(k=>'<span class="tag t-blue" style="cursor:pointer" onclick="s3OpenSigned(\''+esc(k.path)+'\')"><i class="fa-solid fa-paperclip"></i> '+esc(k.type)+'</span>').join('')+'</div>':'')+'</div>').join('');
  const row=l=>'<tr'+(num(l.amount)<0?' class="neg"':'')+'><td>'+esc(l.name)+'</td><td class="r">'+(l.basis==='per_sqft'?rate(l.rate)+' × '+num(l.qty):l.kind==='parking'?inr(l.rate)+' × '+num(l.qty):'Fixed')+'</td><td class="r">'+inr(l.amount)+'</td><td class="r">'+pct(l.gst_rate)+'</td><td class="r">'+inr(l.gst_amount)+'</td><td class="r">'+inr(num(l.amount)+num(l.gst_amount))+'</td></tr>';
  const sub=(lbl,n,g)=>'<tr class="t"><td colspan="2">'+lbl+'</td><td class="r">'+inr(n)+'</td><td></td><td class="r">'+inr(g)+'</td><td class="r">'+inr(num(n)+num(g))+'</td></tr>';
  const L=k=>ch.filter(l=>l.col===k);
  const sum=k=>ms.reduce((s,m)=>s+num(m[k]),0);
  host.innerHTML='<div class="toolbar"><button class="btn btn-sm btn-ghost" onclick="navTo(\'postsales/bookings\')"><i class="fa-solid fa-arrow-left"></i> Bookings</button><div style="flex:1"><div class="sec-title" style="margin:0">'+esc(b.booking_no)+' '+st+(b.is_non_standard?' <span class="tag t-amber">Non-standard plan</span>':'')+'</div><div class="pss-hint" style="margin:0">'+esc(proj?proj.name:'')+' · '+esc(b.towers&&b.towers.name||'')+' - '+esc(b.flats&&b.flats.flat_code||'')+' · booked '+dmy(b.booking_date)+'</div></div>'
    +'<button class="btn" onclick="psbPrint('+b.id+')"><i class="fa-solid fa-print"></i> Estimated Offer Price</button>'
    +(b.status==='active'?'<button class="btn" onclick="psxTransferStart('+b.id+')"><i class="fa-solid fa-right-left"></i> Transfer flat</button><button class="btn btn-danger" onclick="psxCancelModal('+b.id+')"><i class="fa-solid fa-ban"></i> Cancel booking</button><button class="btn btn-primary" onclick="navTo(\'postsales/bookings/'+b.id+'/edit\')"><i class="fa-solid fa-pen"></i> Edit</button>':'')+'</div>'
    +(b.status==='cancelled'?'<div class="pss-banner" style="border-color:#fecaca;background:#fef2f2"><i class="fa-solid fa-ban" style="color:#b91c1c"></i><div class="grow"><b>Cancelled on '+dmy(b.cancelled_on)+'</b> by '+esc((b.closed_by||'').split('@')[0])+' - '+esc(b.cancel_reason||'')+'. Charge '+inr(b.cancel_charge)+' + GST'+(num(b.cancel_charge)<num(b.cancel_charge_calc)?' (reduced from '+inr(b.cancel_charge_calc)+': '+esc(b.cancel_waiver_reason||'')+')':'')+'.</div></div>':'')
    +(b.status==='transferred'?'<div class="pss-banner"><i class="fa-solid fa-right-left" style="color:#7c3aed"></i><div class="grow"><b>Transferred on '+dmy(b.cancelled_on)+'</b> to <a href="javascript:void 0" onclick="navTo(\'postsales/bookings/'+b.transferred_to+'\')">the new booking</a>; everything paid here moved with it.</div></div>':'')
    +(b.transferred_from?'<div class="pss-banner"><i class="fa-solid fa-right-left" style="color:#7c3aed"></i><div class="grow">Transferred in from <a href="javascript:void 0" onclick="navTo(\'postsales/bookings/'+b.transferred_from+'\')">an earlier booking</a> - the original booking date is kept.</div></div>':'')
    +mKpis([['Total consideration',inr(b.total_consideration),'excl. GST'],['GST',inr(num(b.unit_gst)+num(b.parking_gst)+num(b.edc_gst)),''],['Grand total',inr(b.grand_total),'incl. GST'],['Rate',rate(b.rate)+'/sq ft',num(b.sba_sqft)+' sq ft super built-up']])
    +'<div class="psb-sec" style="margin-top:14px" id="psbMoney"><h3>Payments</h3><div class="loader"><div class="spin"></div></div></div>'
    +'<div class="psb-sec"><h3>Applicants</h3>'+applHtml+'</div>'
    +'<div class="psb-sec"><h3>Cost sheet</h3><div style="overflow-x:auto"><table class="psb-tbl"><thead><tr><th>Particulars</th><th class="r">Rate</th><th class="r">Amount</th><th class="r">GST</th><th class="r">GST amount</th><th class="r">Gross</th></tr></thead><tbody>'
      +L('unit').map(row).join('')+sub('Total flat value',b.unit_net,b.unit_gst)+(L('parking').length?L('parking').map(row).join('')+sub('Total parking',b.parking_net,b.parking_gst):'')+(L('edc').length?L('edc').map(row).join('')+sub('Total extra development charges',b.edc_net,b.edc_gst):'')+'</tbody></table></div></div>'
    +'<div class="psb-sec"><h3>Payment schedule - '+esc(b.plan_name||'')+'</h3><div style="overflow-x:auto"><table class="psb-tbl"><thead><tr><th>#</th><th>Milestone</th><th>Raised</th><th class="r">Unit</th><th class="r">Parking</th><th class="r">EDC</th><th class="r">Gross</th></tr></thead><tbody>'
      +ms.map(m=>'<tr><td>'+m.seq+'</td><td>'+esc(m.name)+'<div class="pss-hint" style="margin:0">'+esc(msDescribe(m))+'</div></td><td style="font-size:12px">'+(m.trigger_type==='individual'?(m.due_days!=null?m.due_days+' days after booking':'By hand'):esc(TRIGGER_LBL[m.trigger_type])+': '+esc(stName(m.stage_id)))+'</td><td class="r">'+inr(num(m.unit_net)+num(m.unit_gst))+'</td><td class="r">'+inr(num(m.parking_net)+num(m.parking_gst))+'</td><td class="r">'+inr(num(m.edc_net)+num(m.edc_gst))+'</td><td class="r"><b>'+inr(m.gross_total)+'</b></td></tr>').join('')
      +'<tr class="t"><td></td><td>Total</td><td></td><td class="r">'+inr(sum('unit_net')+sum('unit_gst'))+'</td><td class="r">'+inr(sum('parking_net')+sum('parking_gst'))+'</td><td class="r">'+inr(sum('edc_net')+sum('edc_gst'))+'</td><td class="r">'+inr(sum('gross_total'))+'</td></tr></tbody></table></div></div>'
    +'<div class="psb-sec"><h3>Booking details</h3><div class="psb-facts">'+fact('Purpose',esc(b.purpose==='investment'?'Investment':b.purpose==='residential'?'Residential':'—'))+fact('Loan',b.loan_required==null?'—':b.loan_required?'Yes'+(b.loan_bank?' ('+esc(b.loan_bank)+')':''):'No')+fact('Source',esc(b.source||'—'))+fact('Reason',esc(b.reason_chosen||'—'))+fact('Sales person',esc(b.sales_person||'—'))+fact('CRM Lead ID',esc(b.crm_lead_id||'—'))+fact('Created by',esc((b.created_by||'').split('@')[0]))+'</div>'
      +(b.remarks?'<div class="pss-hint" style="margin-top:8px">'+esc(b.remarks)+'</div>':'')
      +((b.attachments||[]).length?'<div class="psb-kyc">'+b.attachments.map(a=>'<span class="tag t-blue" style="cursor:pointer" onclick="s3OpenSigned(\''+esc(a.path)+'\')"><i class="fa-solid fa-paperclip"></i> '+esc(a.name)+'</span>').join('')+'</div>':'')+'</div>';
  const [mo,irows,po]=await Promise.all([bookingMoney(b.id),interestRows(b.id),PS().from('payouts').select('*').eq('booking_id',b.id).order('payout_date')]);
  const box=$('psbMoney');
  if(stale()||!box) return;
  const payouts=po.data||[];
  box.insertAdjacentHTML('afterend',interestPanel(b,irows)
    +((payouts.length||(b.status==='cancelled'&&num(mo.bal.advance)>0.5))?'<div class="psb-sec"><h3 style="justify-content:space-between">Refunds &amp; transfers out'+(b.status==='cancelled'&&num(mo.bal.advance)>0.5?' <button class="btn btn-sm btn-primary" onclick="psxRefundModal('+b.id+')"><i class="fa-solid fa-money-bill-transfer"></i> Record refund ('+inr(mo.bal.advance)+' due)</button>':'')+'</h3>'
      +(payouts.length?'<table class="psb-tbl"><thead><tr><th>No.</th><th>Date</th><th>Type</th><th>Ref.</th><th class="r">Amount</th></tr></thead><tbody>'+payouts.map(x=>'<tr><td><b>'+esc(x.payout_no)+'</b></td><td>'+dmy(x.payout_date)+'</td><td>'+(x.kind==='refund'?'Refund':'Transfer to '+(x.to_booking_id?'<a href="javascript:void 0" onclick="navTo(\'postsales/bookings/'+x.to_booking_id+'\')">new booking</a>':''))+'</td><td>'+esc(x.instrument_no||x.remarks||'')+'</td><td class="r">'+inr(x.amount)+'</td></tr>').join('')+'</tbody></table>':'<div class="pss-hint">Nothing paid back yet.</div>')+'</div>':''));
  box.innerHTML='<h3 style="justify-content:space-between">Payments'+(b.status!=='transferred'?' <button class="btn btn-sm btn-primary" onclick="navTo(\'postsales/receipts/new/'+b.id+'\')"><i class="fa-solid fa-plus"></i> Record payment</button>':'')+'</h3>'
    +balanceCards(mo.bal)+milestoneStatus(b,ms,mo.inv,mo.al)
    +(mo.inv.some(x=>x.kind!=='milestone')?'<div class="pss-hint" style="margin:12px 0 0">Other invoices on this booking:</div>'+invoiceTable(mo.inv.filter(x=>x.kind!=='milestone'),mo.al):'')
    +(mo.rc.length?'<div style="overflow-x:auto;margin-top:12px"><table class="psb-tbl"><thead><tr><th>Receipt</th><th>Date</th><th>Mode</th><th>Ref.</th><th class="r">Amount</th><th>Status</th></tr></thead><tbody>'
      +mo.rc.map(r=>'<tr style="cursor:pointer" onclick="navTo(\'postsales/receipts/'+r.id+'\')"><td><b>'+esc(r.receipt_no)+'</b>'+(r.against_interest?' <span class="tag t-purple">Interest</span>':'')+'</td><td>'+dmy(r.receipt_date)+'</td><td>'+esc(MODE_LBL[r.mode]||r.mode)+'</td><td>'+esc(r.instrument_no||'')+'</td><td class="r">'+inr(r.amount)+'</td><td>'+(r.status==='active'?'<span class="tag t-green">Received</span>':'<span class="tag t-red">Reversed</span>')+'</td></tr>').join('')
      +'</tbody></table></div>':'<div class="pss-hint" style="margin-top:10px">No payments recorded yet.</div>');
}
// The Estimated Offer Price sheet, laid out like the one stapled into the application form.
window.psbPrint=async function(id){
  const w=window.open('','_blank');
  if(!w){ toast('Allow pop-ups to print the Estimated Offer Price','err'); return; }
  w.document.write('<!doctype html><meta charset="utf-8"><title>Preparing…</title><body style="font:14px system-ui;padding:30px">Preparing…</body>');
  const v=(B.view&&B.view.b.id===id)?B.view:await loadBooking(id);
  if(!v){ w.close(); toast('Booking not found','err'); return; }
  const {b,ap,ch,ms}=v, proj=S.projects.find(p=>p.id===b.project_id);
  const n=x=>{const v=Math.round(num(x));return (v<0?'−':'')+Math.abs(v).toLocaleString('en-IN');}, rs=x=>{const s=n(x);return s[0]==='−'?'−₹ '+s.slice(1):'₹ '+s;};
  const L=k=>ch.filter(l=>l.col===k);
  const ln=l=>'<tr><td>'+esc(l.name)+'</td><td class="r">'+(l.basis==='per_sqft'?num(l.rate).toLocaleString('en-IN'):l.kind==='parking'?n(l.rate)+' × '+num(l.qty):'')+'</td><td class="r">'+rs(l.amount)+'</td><td class="r">'+num(l.gst_rate)+'%</td><td class="r">'+rs(l.gst_amount)+'</td><td class="r">'+rs(num(l.amount)+num(l.gst_amount))+'</td></tr>';
  const tot=(lbl,a,g)=>'<tr class="t"><td colspan="2">'+lbl+'</td><td class="r">'+rs(a)+'</td><td></td><td class="r">'+rs(g)+'</td><td class="r">'+rs(num(a)+num(g))+'</td></tr>';
  const sum=k=>ms.reduce((s,m)=>s+num(m[k]),0);
  const html='<!doctype html><html><head><meta charset="utf-8"><title>Estimated Offer Price - '+esc(b.booking_no)+'</title><style>'
    +'body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:24px}h1{font-size:15px;letter-spacing:6px;text-align:center;background:#555;color:#fff;padding:7px;margin:0 0 0}'
    +'table{width:100%;border-collapse:collapse;margin-bottom:0}td,th{border:1px solid #444;padding:6px 7px;vertical-align:top}th{background:#eee;text-align:left}'
    +'.sec td{background:#777;color:#fff;font-weight:bold;text-align:center;letter-spacing:1px}.r{text-align:right;white-space:nowrap}.t td{font-weight:bold}.k{font-weight:bold;width:14%}'
    +'.notes{background:#666;color:#fff;text-align:center;padding:8px;font-size:11px;line-height:1.6}.meta{font-size:11px;margin:10px 0 0;color:#444}@media print{body{margin:10mm}}</style></head><body>'
    +'<h1>ESTIMATED OFFER PRICE</h1>'
    +'<table><tr><td class="k">Project:</td><td>'+esc(proj?proj.name:'')+'</td><td class="k">Block:</td><td>'+esc(b.towers&&b.towers.name||'')+'</td><td class="k">Booking no.:</td><td>'+esc(b.booking_no)+'</td></tr>'
    +'<tr><td class="k">SBA:</td><td>'+num(b.sba_sqft)+'</td><td class="k">Built-Up:</td><td>'+(b.flats&&b.flats.built_up_sqft!=null?num(b.flats.built_up_sqft):'')+'</td><td class="k">Carpet-Area:</td><td>'+(b.flats&&b.flats.carpet_sqft!=null?num(b.flats.carpet_sqft):'')+'</td></tr>'
    +'<tr><td class="k">Floor:</td><td>'+esc(ordinal(b.floor_no))+'</td><td class="k">Flat:</td><td>'+esc((b.towers&&b.towers.name||'')+' - '+(b.flats&&b.flats.flat_code||''))+'</td><td class="k">BHK:</td><td>'+esc(b.flats&&b.flats.bhk||'')+'</td></tr>'
    +'<tr><td class="k">Applicant:</td><td colspan="3">'+esc(ap.map(a=>[a.title,a.full_name].filter(Boolean).join(' ')).join(' & '))+'</td><td class="k">Date:</td><td>'+dmy(b.booking_date)+'</td></tr></table>'
    +'<table><tr class="sec"><td colspan="6">Unit Charges Details</td></tr><tr><th>Particulars</th><th class="r">Rate</th><th class="r">Total (Rs.)</th><th class="r">GST</th><th class="r">GST Amount</th><th class="r">Gross Amount</th></tr>'
    +L('unit').map(ln).join('')+tot('TOTAL FLAT VALUE',b.unit_net,b.unit_gst)
    +(L('parking').length?'<tr class="sec"><td colspan="6">Car Parking</td></tr>'+L('parking').map(ln).join('')+tot('TOTAL',b.parking_net,b.parking_gst):'')
    +(L('edc').length?'<tr class="sec"><td colspan="6">Extra Development Charges (EDC)</td></tr>'+L('edc').map(ln).join('')+tot('TOTAL',b.edc_net,b.edc_gst):'')
    +'<tr class="t"><td colspan="2">GRAND TOTAL</td><td class="r">'+rs(b.total_consideration)+'</td><td></td><td class="r">'+rs(num(b.unit_gst)+num(b.parking_gst)+num(b.edc_gst))+'</td><td class="r">'+rs(b.grand_total)+'</td></tr></table>'
    +'<table><tr class="sec"><td colspan="5">Payment Schedule</td></tr><tr><th>Event Particulars</th><th class="r">Unit</th><th class="r">Parking</th><th class="r">EDC</th><th class="r">Gross Amount</th></tr>'
    +ms.map(m=>'<tr><td>'+esc(m.name)+(msDescribe(m)?' '+esc(msDescribe(m)):'')+'</td><td class="r">'+n(num(m.unit_net)+num(m.unit_gst))+'</td><td class="r">'+n(num(m.parking_net)+num(m.parking_gst))+'</td><td class="r">'+n(num(m.edc_net)+num(m.edc_gst))+'</td><td class="r">'+rs(m.gross_total)+'</td></tr>').join('')
    +'<tr class="t"><td>TOTAL</td><td class="r">'+n(sum('unit_net')+sum('unit_gst'))+'</td><td class="r">'+n(sum('parking_net')+sum('parking_gst'))+'</td><td class="r">'+n(sum('edc_net')+sum('edc_gst'))+'</td><td class="r">'+rs(sum('gross_total'))+'</td></tr></table>'
    +'<div class="notes">1) Above calculations are an indicative offer price only.<br>2) Taxes applicable as per govt norms.<br>3) Customers are advised to check all calculations and revert.<br>4) Please note that there may be changes in calculation due to decimal rounding off.</div>'
    +'<div class="meta">Payment plan: '+esc(b.plan_name||'')+(b.is_non_standard?' (non-standard)':'')+'</div>'
    +'<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>';
  w.document.open(); w.document.write(html); w.document.close();
};

/* ============================ POST SALES — MONEY RECEIVED (Stage 3) ============================
   Spec: docs/post-sales-spec.md §3. Tables: supabase/migrations/20261001180000_postsales_receipts.sql.
   Route: postsales/receipts[/new[/<bookingId>] | /<receiptId>].

   A receipt is saved against a booking and applied by postsales.reallocate_booking() to that
   booking's open invoices, oldest due first; whatever isn't needed stays as advance and is applied
   automatically when the next invoice is raised. "Against interest" receipts go only to interest
   invoices. A reversal (bounce) keeps the receipt on record, takes it out of every total and can
   raise a cheque-dishonour charge. */
const MODE_LBL={net_banking:'Net Banking',cheque:'Cheque',dd:'Demand Draft',rtgs_neft_imps:'RTGS / NEFT / IMPS',upi:'UPI',cash:'Cash',jv:'JV (adjustment)'};
const R={list:[],pid:null,f:null};
function inWords(n){
  n=Math.round(num(n)); if(!n) return 'Zero';
  const a=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const t=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const two=x=>x<20?a[x]:t[Math.floor(x/10)]+(x%10?' '+a[x%10]:'');
  const three=x=>(x>=100?a[Math.floor(x/100)]+' Hundred'+(x%100?' ':''):'')+(x%100?two(x%100):'');
  const parts=[]; const cr=Math.floor(n/10000000); n%=10000000; const lk=Math.floor(n/100000); n%=100000; const th=Math.floor(n/1000); n%=1000;
  if(cr) parts.push((cr>99?inWords(cr):two(cr))+' Crore'); if(lk) parts.push(two(lk)+' Lakh'); if(th) parts.push(two(th)+' Thousand'); if(n) parts.push(three(n));
  return parts.join(' ');
}
async function bookingOptions(pid){
  return allRows(()=>{let q=PS().from('bookings').select('id,project_id,booking_no,status,flats(flat_code),towers(name),booking_applicants(full_name,seq)').neq('status','transferred').order('booking_no'); if(pid) q=q.eq('project_id',pid); return q;});
}
const bkLabel=b=>b.booking_no+' · '+(b.towers&&b.towers.name||'')+' '+(b.flats&&b.flats.flat_code||'')+' · '+(((b.booking_applicants||[]).sort((x,y)=>x.seq-y.seq)[0]||{}).full_name||'');

let RC_SEQ=0;
window.psrRender=async function(host,seg){
  host.classList.add('ps-root');
  css(); bcss();
  seg=seg||[];
  const mine=++RC_SEQ, stale=()=>mine!==RC_SEQ||!host.isConnected;
  loader(host);
  if(!S.projects.length) await loadProjects();
  if(stale()) return;
  if(seg[0]==='new'){ await receiptForm(host,parseInt(seg[1],10)||null,stale); return; }
  const id=parseInt(seg[0],10);
  if(id){ await receiptView(host,id,stale); return; }
  await receiptList(host,stale);
};

async function receiptList(host,stale){
  const data=await allRows(()=>PS().from('receipts').select('id,project_id,receipt_no,receipt_date,mode,instrument_no,amount,status,against_interest,bookings(booking_no,flats(flat_code),towers(name),booking_applicants(full_name,seq))').order('receipt_date',{ascending:false}).order('id',{ascending:false}));
  if(stale()) return;
  R.list=data||[];
  const opts='<option value="">All projects</option>'+S.projects.map(p=>'<option value="'+p.id+'"'+(String(p.id)===String(R.pid||'')?' selected':'')+'>'+esc(p.name)+'</option>').join('');
  host.innerHTML='<div class="ps-head"><div class="t"><div class="sec-title">Receipts</div><div class="pss-hint" style="margin:2px 0 0">Every payment received, newest first. Tap one to see what it was applied to, print it or reverse it.</div></div><div class="acts"><button class="btn btn-primary" onclick="navTo(\'postsales/receipts/new\')"><i class="fa-solid fa-plus"></i> Record payment</button></div></div>'
    +'<div class="ps-filters"><select id="psrProj" onchange="psrFilter()">'+opts+'</select>'
    +'<label class="fl">From<input type="date" id="psrFrom" onchange="psrFilter()"></label><label class="fl">To<input type="date" id="psrTo" onchange="psrFilter()"></label>'
    +'<span class="mu-sw"><i class="fa-solid fa-magnifying-glass"></i><input id="psrQ" placeholder="Search receipt, booking, flat, applicant or reference" oninput="psrFilter()"></span></div>'
    +'<div id="psrList"></div>';
  window.psrFilter=function(){
    R.pid=val('psrProj')||null; const q=val('psrQ').toLowerCase(), from=val('psrFrom'), to=val('psrTo');
    const rows=R.list.filter(r=>{const b=r.bookings||{};
      if(R.pid&&String(r.project_id)!==R.pid) return false; if(from&&r.receipt_date<from) return false; if(to&&r.receipt_date>to) return false;
      return !q||[r.receipt_no,r.instrument_no,b.booking_no,b.flats&&b.flats.flat_code,b.towers&&b.towers.name,(b.booking_applicants||[]).map(a=>a.full_name).join(' ')].join(' ').toLowerCase().includes(q);});
    const act=rows.filter(r=>r.status==='active'), tot=act.reduce((s,r)=>s+num(r.amount),0);
    const stTag=r=>r.status==='active'?'<span class="tag t-green">Received</span>':'<span class="tag t-red">Reversed</span>';
    $('psrList').innerHTML=(rows.length?'<div class="psb-sum" style="margin:0 0 12px"><div>Total received<b>'+inr(tot)+'</b></div><div>Receipts<b>'+act.length+'</b></div>'+(rows.length>act.length?'<div>Reversed<b>'+(rows.length-act.length)+'</b></div>':'')+'</div>':'')
      +listHtml('rc','psrFilter',rows,
      '<th>Receipt</th><th>Date</th><th>Booking / flat</th><th>Received from</th><th>Mode</th><th class="pss-num">Amount</th><th>Status</th>',
      r=>{const b=r.bookings||{},ap=(b.booking_applicants||[]).sort((x,y)=>x.seq-y.seq);
        return '<tr onclick="navTo(\'postsales/receipts/'+r.id+'\')"><td><b>'+esc(r.receipt_no)+'</b>'+(r.against_interest?' <span class="tag t-purple">Interest</span>':'')+'</td><td>'+dmy(r.receipt_date)+'</td><td>'+esc(b.booking_no||'')+'<div class="pss-hint" style="margin:0">'+esc((b.towers&&b.towers.name||'')+' - '+(b.flats&&b.flats.flat_code||''))+'</div></td><td>'+esc(ap[0]?ap[0].full_name:'')+'</td><td>'+esc(MODE_LBL[r.mode]||r.mode)+(r.instrument_no?'<div class="pss-hint" style="margin:0">'+esc(r.instrument_no)+'</div>':'')+'</td><td class="pss-num">'+inr(r.amount)+'</td><td>'+stTag(r)+'</td></tr>';},
      r=>{const b=r.bookings||{},ap=(b.booking_applicants||[]).sort((x,y)=>x.seq-y.seq);
        return '<div class="ps-card" onclick="navTo(\'postsales/receipts/'+r.id+'\')"'+(r.status!=='active'?' style="opacity:.65"':'')+'><div class="r1"><b>'+esc(r.receipt_no)+'</b><span class="amt">'+inr(r.amount)+'</span></div><div class="r2">'+esc((b.towers&&b.towers.name||'')+' - '+(b.flats&&b.flats.flat_code||''))+' · '+esc(ap[0]?ap[0].full_name:'')+'</div><div class="r3"><span>'+dmy(r.receipt_date)+'</span><span>'+esc(MODE_LBL[r.mode]||r.mode)+(r.instrument_no?' · '+esc(r.instrument_no):'')+'</span>'+stTag(r)+(r.against_interest?'<span class="tag t-purple">Interest</span>':'')+'</div></div>';},
      '<div class="empty"><i class="fa-solid fa-indian-rupee-sign"></i><div>No receipts match</div></div>');
  };
  psrFilter();
}

async function bookingMoney(bookingId){
  const [bal,inv,rc,al]=await Promise.all([
    PS().from('booking_balances').select('*').eq('booking_id',bookingId).maybeSingle(),
    PS().from('invoices').select('*').eq('booking_id',bookingId).order('due_date').order('id'),
    PS().from('receipts').select('*').eq('booking_id',bookingId).order('receipt_date').order('id'),
    PS().from('receipt_allocations').select('receipt_id,invoice_id,amount,receipts!inner(booking_id)').eq('receipts.booking_id',bookingId)
  ]);
  return {bal:bal.data||{},inv:inv.data||[],rc:rc.data||[],al:al.data||[]};
}
function balanceCards(bal){
  return '<div class="psb-sum">'
    +'<div>Invoiced so far<b>'+inr(bal.principal_invoiced)+'</b></div>'
    +'<div>Received<b>'+inr(num(bal.principal_received))+'</b></div>'
    +'<div>Outstanding<b'+(num(bal.principal_outstanding)>0?' style="color:#b45309"':'')+'>'+inr(bal.principal_outstanding)+'</b></div>'
    +'<div>Overdue<b'+(num(bal.principal_overdue)>0?' style="color:#b91c1c"':'')+'>'+inr(bal.principal_overdue)+'</b></div>'
    +'<div>'+(bal.status==='cancelled'?'Refund due':'Advance (not yet applied)')+'<b'+(num(bal.advance)>0?' style="color:#15803d"':'')+'>'+inr(bal.advance)+'</b></div>'
    +(num(bal.interest_invoiced)||num(bal.interest_received)?'<div>Interest outstanding<b>'+inr(bal.interest_outstanding)+'</b></div>':'')
    +'</div>';
}
function invoiceTable(inv,al){
  const applied=id=>al.filter(a=>a.invoice_id===id).reduce((s,a)=>s+num(a.amount),0);
  const open=inv.filter(i=>i.status==='open');
  if(!open.length) return '<div class="pss-hint" style="margin-top:8px">No invoices raised yet - every payment is held as advance and will be applied when demands are raised.</div>';
  return '<div style="overflow-x:auto;margin-top:10px"><table class="psb-tbl"><thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th>For</th><th class="r">Amount</th><th class="r">Received</th><th class="r">Balance</th></tr></thead><tbody>'
    +open.map(i=>{const p=applied(i.id),b=num(i.total)-p,od=b>0&&i.due_date<today();return '<tr><td><b>'+esc(i.invoice_no)+'</b></td><td>'+dmy(i.invoice_date)+'</td><td'+(od?' style="color:#b91c1c;font-weight:600"':'')+'>'+dmy(i.due_date)+(od?' · overdue':'')+'</td><td>'+esc(i.title)+'</td><td class="r">'+inr(i.total)+'</td><td class="r">'+inr(p)+'</td><td class="r"><b>'+inr(b)+'</b></td></tr>';}).join('')
    +'</tbody></table></div>';
}

async function receiptForm(host,bookingId,stale){
  let bk=null;
  if(bookingId){ const {data}=await PS().from('bookings').select('id,project_id').eq('id',bookingId).maybeSingle(); bk=data; }
  const pid=bk?bk.project_id:(R.pid?Number(R.pid):(S.pid||null));
  R.f={pid,bookingId:bk?bk.id:null,date:today(),amount:'',mode:'net_banking',instrument_no:'',instrument_date:'',drawn_on:'',drawn_branch:'',bank_account_id:'',paid_by:'',against_interest:false,narration:'',attachments:[]};
  if(pid){ await loadProject(pid); S.pid=pid; }
  R.opts=await bookingOptions(pid);
  if(stale()) return;
  await drawReceiptForm(host);
}
async function drawReceiptForm(host){
  const f=R.f;
  const projOpts='<option value="">Choose a project…</option>'+S.projects.map(p=>'<option value="'+p.id+'"'+(p.id===f.pid?' selected':'')+'>'+esc(p.name)+'</option>').join('');
  const bkOpts='<option value="">'+(f.pid?(R.opts.length?'Choose a booking…':'No active bookings in this project'):'Choose a project first')+'</option>'+R.opts.map(b=>'<option value="'+b.id+'"'+(b.id===f.bookingId?' selected':'')+'>'+esc(bkLabel(b))+'</option>').join('');
  let money='', applicants=[];
  if(f.bookingId){
    const [m,ap]=await Promise.all([bookingMoney(f.bookingId),PS().from('booking_applicants').select('full_name,seq').eq('booking_id',f.bookingId).order('seq')]);
    applicants=(ap.data||[]).map(a=>a.full_name);
    if(!f.paid_by&&!f._other&&applicants[0]) f.paid_by=applicants[0];
    money='<div class="psb-sec"><h3>Where this booking stands</h3>'+balanceCards(m.bal)+invoiceTable(m.inv,m.al)+'</div>';
  }
  const banks=S.banks.filter(b=>b.active);
  const needsInst=f.mode!=='cash', needsBank=f.mode==='cheque'||f.mode==='dd';
  const other=f._other||(f.paid_by&&!applicants.includes(f.paid_by));
  const paidOpts=applicants.map(a=>'<option'+(!other&&f.paid_by===a?' selected':'')+'>'+esc(a)+'</option>').join('')+'<option value="__other"'+(other?' selected':'')+'>Someone else…</option>';
  host.innerHTML='<div class="toolbar"><button class="btn btn-sm btn-ghost" onclick="navTo(\'postsales/receipts\')"><i class="fa-solid fa-arrow-left"></i> Receipts</button><div class="sec-title" style="margin:0;flex:1">Record payment</div></div>'
    +'<div class="psb-sec"><h3><span class="n">1</span> Booking</h3><div class="frm psb-grid"><div><label>Project</label><select onchange="psrSetProject(this.value)">'+projOpts+'</select></div><div class="psb-span2"><label>Booking</label><select onchange="psrSet(\'bookingId\',this.value?Number(this.value):null,1)">'+bkOpts+'</select></div></div></div>'
    +money
    +(f.bookingId?'<div class="psb-sec"><h3><span class="n">2</span> Payment</h3><div class="frm psb-grid">'
      +'<div><label>Receipt date</label><input type="date" value="'+esc(f.date)+'" onchange="psrSet(\'date\',this.value)"></div>'
      +'<div><label>Amount (₹)</label><input type="number" step="0.01" id="psrAmt" value="'+esc(f.amount)+'" oninput="psrSet(\'amount\',this.value)"><div class="pss-hint" id="psrWords" style="margin:4px 0 0"></div></div>'
      +'<div><label>Mode</label><select onchange="psrSet(\'mode\',this.value,1)">'+Object.keys(MODE_LBL).map(k=>'<option value="'+k+'"'+(f.mode===k?' selected':'')+'>'+MODE_LBL[k]+'</option>').join('')+'</select></div>'
      +(needsInst?'<div><label>'+(f.mode==='cheque'?'Cheque no.':f.mode==='dd'?'DD no.':f.mode==='upi'?'UPI transaction ID':f.mode==='jv'?'JV reference':'UTR / reference no.')+'</label><input value="'+esc(f.instrument_no)+'" oninput="psrSet(\'instrument_no\',this.value)"></div>'
        +'<div><label>'+(f.mode==='cheque'||f.mode==='dd'?'Instrument date':'Transaction date')+'</label><input type="date" value="'+esc(f.instrument_date)+'" onchange="psrSet(\'instrument_date\',this.value)"></div>':'')
      +(needsBank?'<div><label>Drawn on (bank)</label><input value="'+esc(f.drawn_on)+'" oninput="psrSet(\'drawn_on\',this.value)"></div><div><label>Branch</label><input value="'+esc(f.drawn_branch)+'" oninput="psrSet(\'drawn_branch\',this.value)"></div>':'')
      +'<div><label>Deposited in</label><select onchange="psrSet(\'bank_account_id\',this.value)"><option value="">—</option>'+banks.map(b=>'<option value="'+b.id+'"'+(String(f.bank_account_id)===String(b.id)?' selected':'')+'>'+esc(b.name)+'</option>').join('')+'</select>'+(banks.length?'':'<div class="pss-hint" style="margin:4px 0 0">No bank accounts yet - add them in Setup › Bank Accounts.</div>')+'</div>'
      +'<div><label>Paid by</label><select onchange="psrPaidBy(this.value)">'+paidOpts+'</select>'+(other?'<input style="margin-top:6px" placeholder="Name of the payer" value="'+esc(applicants.includes(f.paid_by)?'':f.paid_by)+'" oninput="psrSet(\'paid_by\',this.value)">':'')+'</div>'
      +'<div class="psb-span2"><label>Narration</label><input value="'+esc(f.narration)+'" oninput="psrSet(\'narration\',this.value)"></div>'
      +'</div><label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-top:12px"><input type="checkbox"'+(f.against_interest?' checked':'')+' onchange="psrSet(\'against_interest\',this.checked)"> The customer has agreed this payment is <b>against interest</b> (otherwise it always goes to principal)</label>'
      +'<div class="psb-kyc" id="psrAtt"></div></div>'
      +'<div class="psb-bar"><button class="btn" onclick="navTo(\'postsales/receipts\')">Cancel</button><button class="btn btn-primary" id="psrSave" onclick="psrSave()"><i class="fa-solid fa-floppy-disk"></i> Save receipt</button></div>':'');
  drawRcAtt(); psrWords();
}
function psrWords(){ const w=$('psrWords'); if(w) w.textContent=num(R.f.amount)?'Rupees '+inWords(R.f.amount)+' only':''; }
window.psrSetProject=async function(v){ R.f.pid=v?Number(v):null; R.f.bookingId=null; if(R.f.pid){ await loadProject(R.f.pid); S.pid=R.f.pid; } R.opts=await bookingOptions(R.f.pid); drawReceiptForm($('psrBody')); };
window.psrSet=function(k,v,redraw){ R.f[k]=v; if(k==='bookingId') R.f.paid_by=''; if(redraw) drawReceiptForm($('psrBody')); else if(k==='amount') psrWords(); };
window.psrPaidBy=function(v){ if(v==='__other'){ R.f.paid_by=''; R.f._other=true; } else { R.f.paid_by=v; R.f._other=false; } drawReceiptForm($('psrBody')); };
function drawRcAtt(){
  const h=$('psrAtt'); if(!h) return;
  h.innerHTML='<span style="font-size:12.5px;font-weight:600">Proof (screenshot / cheque copy):</span>'+R.f.attachments.map((a,j)=>'<span class="tag t-blue" style="cursor:pointer" onclick="s3OpenSigned(\''+esc(a.path)+'\')"><i class="fa-solid fa-paperclip"></i> '+esc(a.name)+' <i class="fa-solid fa-xmark" style="margin-left:4px" onclick="event.stopPropagation();psrAttDel('+j+')"></i></span>').join('')
    +'<label class="btn btn-sm" style="margin:0"><i class="fa-solid fa-upload"></i> Upload<input type="file" style="display:none" accept="image/*,application/pdf" onchange="psrAttUp(this)"></label>';
}
window.psrAttUp=async function(input){
  const file=input.files&&input.files[0]; if(!file) return;
  toast('Uploading '+file.name+'…');
  const r=await uploadFileToS3('postsales/receipts/'+s3Stamp()+'_'+s3SafeName(file.name),file);
  if(r.error){ toast('Upload failed: '+r.error.message,'err'); return; }
  R.f.attachments=R.f.attachments.concat([{name:file.name,path:r.data.path}]); toast('Uploaded','ok'); drawRcAtt();
};
window.psrAttDel=function(j){ R.f.attachments.splice(j,1); drawRcAtt(); };
window.psrSave=async function(){
  const f=R.f;
  if(!f.bookingId){ toast('Choose the booking','err'); return; }
  if(!(num(f.amount)>0)){ toast('Enter the amount received','err'); return; }
  if(!f.date){ toast('Enter the receipt date','err'); return; }
  if(f.date>today()){ toast('The receipt date can\'t be in the future','err'); return; }
  if(f.mode!=='cash'&&!String(f.instrument_no).trim()){ toast('Enter the '+(f.mode==='cheque'?'cheque':f.mode==='upi'?'UPI transaction':'reference')+' number','err'); return; }
  const btn=$('psrSave'); if(btn) btn.disabled=true;
  const {data,error}=await PS().rpc('save_receipt',{p:{booking_id:f.bookingId,receipt_date:f.date,mode:f.mode,instrument_no:f.instrument_no,instrument_date:f.instrument_date,drawn_on:f.drawn_on,drawn_branch:f.drawn_branch,bank_account_id:f.bank_account_id,amount:num(f.amount),narration:f.narration,paid_by:f.paid_by,against_interest:!!f.against_interest,attachments:f.attachments}});
  if(btn) btn.disabled=false;
  if(fail(error,'Could not save the receipt')) return;
  toast('Receipt saved','ok'); navTo('postsales/receipts/'+data);
};

async function loadReceipt(id){
  const {data:r,error}=await PS().from('receipts').select('*,bank_accounts(name),bookings(id,booking_no,project_id,flats(flat_code),towers(name),booking_applicants(full_name,title,seq,res_address,off_address,mailing_address))').eq('id',id).single();
  if(error) return null;
  const al=await PS().from('receipt_allocations').select('amount,invoices(invoice_no,title,invoice_date)').eq('receipt_id',id);
  return {r,al:al.data||[]};
}
async function receiptView(host,id,stale){
  const v=await loadReceipt(id);
  if(stale()) return;
  if(!v){ host.innerHTML='<div class="empty"><div>Receipt not found</div></div>'; return; }
  const {r,al}=v, b=r.bookings||{}, ap=(b.booking_applicants||[]).sort((x,y)=>x.seq-y.seq);
  const applied=al.reduce((s,a)=>s+num(a.amount),0);
  const fact=(l,x)=>'<span>'+esc(l)+' <b>'+x+'</b></span>';
  host.innerHTML='<div class="toolbar"><button class="btn btn-sm btn-ghost" onclick="navTo(\'postsales/receipts\')"><i class="fa-solid fa-arrow-left"></i> Receipts</button><div style="flex:1"><div class="sec-title" style="margin:0">'+esc(r.receipt_no)+' '+(r.status==='active'?'<span class="tag t-green">Received</span>':'<span class="tag t-red">Reversed</span>')+(r.against_interest?' <span class="tag t-purple">Against interest</span>':'')+'</div><div class="pss-hint" style="margin:0"><a href="javascript:void 0" onclick="navTo(\'postsales/bookings/'+b.id+'\')">'+esc(b.booking_no||'')+'</a> · '+esc((b.towers&&b.towers.name||'')+' - '+(b.flats&&b.flats.flat_code||''))+' · '+esc(ap.map(a=>a.full_name).join(' & '))+'</div></div>'
    +'<button class="btn" onclick="psrPrint('+r.id+')"><i class="fa-solid fa-print"></i> Money receipt</button>'+(r.status==='active'?'<button class="btn btn-danger" onclick="psrReverseModal('+r.id+')"><i class="fa-solid fa-rotate-left"></i> Reverse</button>':'')+'</div>'
    +mKpis([['Amount',inr(r.amount),'Rupees '+inWords(r.amount)+' only'],['Applied to invoices',inr(r.status==='active'?applied:0),''],['Held as advance',inr(r.status==='active'?num(r.amount)-applied:0),'applied when the next demand is raised']])
    +'<div class="psb-sec" style="margin-top:14px"><h3>Payment</h3><div class="psb-facts">'+fact('Date',dmy(r.receipt_date))+fact('Mode',esc(MODE_LBL[r.mode]||r.mode))+(r.instrument_no?fact('Ref.',esc(r.instrument_no)):'')+(r.instrument_date?fact('Instrument date',dmy(r.instrument_date)):'')+(r.drawn_on?fact('Drawn on',esc(r.drawn_on)+(r.drawn_branch?', '+esc(r.drawn_branch):'')):'')+fact('Deposited in',esc(r.bank_accounts&&r.bank_accounts.name||'—'))+fact('Paid by',esc(r.paid_by||'—'))+fact('Entered by',esc((r.created_by||'').split('@')[0]))+'</div>'
      +(r.narration?'<div class="pss-hint" style="margin-top:8px">'+esc(r.narration)+'</div>':'')
      +((r.attachments||[]).length?'<div class="psb-kyc">'+r.attachments.map(a=>'<span class="tag t-blue" style="cursor:pointer" onclick="s3OpenSigned(\''+esc(a.path)+'\')"><i class="fa-solid fa-paperclip"></i> '+esc(a.name)+'</span>').join('')+'</div>':'')
      +(r.status==='reversed'?'<div class="pss-banner" style="margin-top:12px;border-color:#fecaca;background:#fef2f2"><i class="fa-solid fa-rotate-left" style="color:#b91c1c"></i><div class="grow">Reversed on '+dmy(r.reversal_date)+' ('+esc(r.reversal_no||'')+') by '+esc((r.reversed_by||'').split('@')[0])+' - '+esc(r.reversal_reason||'')+'</div></div>':'')+'</div>'
    +'<div class="psb-sec"><h3>Applied to</h3>'+(r.status!=='active'?'<div class="pss-hint">A reversed receipt isn\'t applied to anything.</div>':al.length?'<table class="psb-tbl"><thead><tr><th>Invoice</th><th>Date</th><th>For</th><th class="r">Applied</th></tr></thead><tbody>'+al.map(a=>'<tr><td>'+esc(a.invoices&&a.invoices.invoice_no||'')+'</td><td>'+dmy(a.invoices&&a.invoices.invoice_date)+'</td><td>'+esc(a.invoices&&a.invoices.title||'')+'</td><td class="r">'+inr(a.amount)+'</td></tr>').join('')+'</tbody></table>':'<div class="pss-hint">Nothing yet - no invoice is open on this booking, so the whole amount is held as advance.</div>')+'</div>';
}
window.psrReverseModal=function(id){
  openModal('<div class="modal-head"><h3>Reverse receipt</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm">'
    +'<div class="pss-hint">Use this for a bounced cheque or a wrong entry. The receipt stays on record but stops counting, and the booking\'s invoices are re-applied without it.</div>'
    +'<label>Reversal date</label><input type="date" id="psrRvD" value="'+today()+'"><label>Reason</label><input id="psrRvR" placeholder="e.g. Cheque dishonoured - insufficient funds">'
    +'<label>Cheque dishonour charge (₹, optional - 18% GST is added)</label><input type="number" id="psrRvC" placeholder="e.g. 2000"></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-danger" onclick="psrReverse('+id+')">Reverse receipt</button></div>');
};
window.psrReverse=async function(id){
  const reason=val('psrRvR'); if(!reason){ toast('Enter the reason','err'); return; }
  const {error}=await PS().rpc('reverse_receipt',{p_receipt_id:id,p_date:val('psrRvD')||today(),p_reason:reason,p_charge:num(val('psrRvC'))||0});
  if(fail(error,'Could not reverse')) return;
  closeModal(); toast('Receipt reversed','ok'); route();
};
window.psrPrint=async function(id){
  const w=window.open('','_blank');
  if(!w){ toast('Allow pop-ups to print the receipt','err'); return; }
  w.document.write('<!doctype html><meta charset="utf-8"><title>Preparing…</title><body style="font:14px system-ui;padding:30px">Preparing…</body>');
  const v=await loadReceipt(id); if(!v){ w.close(); return; }
  const {r,al}=v, b=r.bookings||{}, ap=(b.booking_applicants||[]).sort((x,y)=>x.seq-y.seq), proj=S.projects.find(p=>p.id===r.project_id);
  const {data:setup}=await PS().from('project_setup').select('company_name').eq('project_id',r.project_id).maybeSingle();
  const first=ap[0]||{}, addr=first.mailing_address==='office'?first.off_address:first.res_address;
  const html='<!doctype html><html><head><meta charset="utf-8"><title>Money Receipt '+esc(r.receipt_no)+'</title><style>body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;margin:28px}h1{font-size:18px;margin:0}h2{font-size:14px;letter-spacing:4px;text-align:center;border:1px solid #333;padding:6px;margin:16px 0}table{width:100%;border-collapse:collapse}td{padding:7px 8px;border:1px solid #999;vertical-align:top}.k{width:24%;font-weight:bold;background:#f3f3f3}.amt{font-size:16px;font-weight:bold}.foot{margin-top:40px;display:flex;justify-content:space-between;font-size:12px}.void{color:#b91c1c;font-weight:bold;font-size:15px;text-align:center;border:2px solid #b91c1c;padding:6px;margin-top:10px}@media print{body{margin:12mm}}</style></head><body>'
    +'<h1>'+esc(setup&&setup.company_name||'Jain Group')+'</h1><div>'+esc(proj?proj.name:'')+'</div>'
    +'<h2>MONEY RECEIPT</h2>'
    +'<table><tr><td class="k">Receipt no.</td><td>'+esc(r.receipt_no)+'</td><td class="k">Date</td><td>'+dmy(r.receipt_date)+'</td></tr>'
    +'<tr><td class="k">Received with thanks from</td><td colspan="3">'+esc(ap.map(a=>[a.title,a.full_name].filter(Boolean).join(' ')).join(' & '))+(addr?'<br><span style="font-size:12px">'+esc(addr)+'</span>':'')+'</td></tr>'
    +'<tr><td class="k">Booking / unit</td><td colspan="3">'+esc(b.booking_no||'')+' - '+esc((b.towers&&b.towers.name||'')+' - '+(b.flats&&b.flats.flat_code||''))+'</td></tr>'
    +'<tr><td class="k">Amount</td><td colspan="3"><span class="amt">₹ '+Math.round(num(r.amount)).toLocaleString('en-IN')+'</span> &nbsp; (Rupees '+esc(inWords(r.amount))+' only)</td></tr>'
    +'<tr><td class="k">Mode</td><td>'+esc(MODE_LBL[r.mode]||r.mode)+'</td><td class="k">Reference</td><td>'+esc(r.instrument_no||'—')+(r.instrument_date?' dated '+dmy(r.instrument_date):'')+(r.drawn_on?'<br>'+esc(r.drawn_on)+(r.drawn_branch?', '+esc(r.drawn_branch):''):'')+'</td></tr>'
    +'<tr><td class="k">Towards</td><td colspan="3">'+(r.against_interest?'Interest on delayed payment':al.length?esc(al.map(a=>(a.invoices&&a.invoices.title||'')+' ('+(a.invoices&&a.invoices.invoice_no||'')+')').join('; ')):'Advance against booking')+'</td></tr></table>'
    +(r.mode==='cheque'||r.mode==='dd'?'<div style="font-size:11.5px;margin-top:8px">Subject to realisation of the instrument.</div>':'')
    +(r.status==='reversed'?'<div class="void">REVERSED on '+dmy(r.reversal_date)+' - '+esc(r.reversal_reason||'')+'</div>':'')
    +'<div class="foot"><div>Entered by '+esc((r.created_by||'').split('@')[0])+'</div><div style="text-align:center">______________________<br>Authorised Signatory</div></div>'
    +'<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>';
  w.document.open(); w.document.write(html); w.document.close();
};

/* ============================ POST SALES — INVOICING (Stage 4) ============================
   Spec: docs/post-sales-spec.md §4. Functions: supabase/migrations/20261001210000_postsales_invoicing.sql.
   Route: postsales/invoices[/stage | /progress | /<invoiceId>].

   Invoices are raised from a booking's own milestones (amounts fixed at booking), never re-priced:
   individually from the booking, automatically when booking date + due days has passed ("Raise due
   invoices"), in bulk when a construction stage is marked complete for a tower or a floor, and at
   booking for stages already complete. Due date = invoice date + 30 days. */
const VIA_LBL={individual:'Individual',bulk:'Stage (bulk)',late_booking:'At booking',import:'Imported',system:'System'};
const KIND_LBL={milestone:'Milestone',interest:'Interest',cancellation:'Cancellation',charge:'Charge'};
const I={list:[],pid:null,status:'open',w:null};

let IN_SEQ=0;
window.psiRender=async function(host,seg){
  host.classList.add('ps-root');
  css(); bcss();
  seg=seg||[];
  const mine=++IN_SEQ, stale=()=>mine!==IN_SEQ||!host.isConnected;
  loader(host);
  if(!S.projects.length) await loadProjects();
  if(stale()) return;
  if(seg[0]==='stage'){ await stageWizard(host,stale); return; }
  if(seg[0]==='progress'){ await progressView(host,stale); return; }
  if(seg[0]==='interest'){ await interestDue(host,stale); return; }
  const id=parseInt(seg[0],10);
  if(id){ await invoiceView(host,id,stale); return; }
  await invoiceList(host,stale);
};
// The three views of the Invoices tab, always shown on top so it is clear where each page sits.
const invNav=on=>'<div class="ps-nav">'+[['list','Invoices','fa-file-invoice','postsales/invoices'],['interest','Interest due','fa-percent','postsales/invoices/interest'],['progress','Construction progress','fa-building-circle-check','postsales/invoices/progress']]
  .map(x=>'<span class="'+(x[0]===on?'on':'')+'" onclick="'+(x[0]===on?'':'navTo(\''+x[3]+'\')')+'"><i class="fa-solid '+x[2]+'"></i> '+x[1]+'</span>').join('')+'</div>';
const projSelect=(id,sel,onch,allLbl)=>'<select id="'+id+'" onchange="'+onch+'" style="height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px">'+(allLbl?'<option value="">'+allLbl+'</option>':'')+S.projects.map(p=>'<option value="'+p.id+'"'+(String(p.id)===String(sel||'')?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select>';

async function invoiceList(host,stale){
  const data=await allRows(()=>PS().from('invoices').select('id,project_id,booking_id,invoice_no,invoice_date,due_date,kind,title,total,status,raised_via,bookings!invoices_booking_id_fkey(booking_no,flats(flat_code),towers(name),booking_applicants(full_name,seq))').order('invoice_date',{ascending:false}).order('id',{ascending:false}));
  if(stale()) return;
  I.list=data||[];
  const ids=I.list.map(i=>i.id), paid={};
  for(let k=0;k<ids.length;k+=300){ const {data:al}=await PS().from('receipt_allocations').select('invoice_id,amount').in('invoice_id',ids.slice(k,k+300)); (al||[]).forEach(a=>paid[a.invoice_id]=(paid[a.invoice_id]||0)+num(a.amount)); }
  if(stale()) return;
  I.paid=paid;
  host.innerHTML=invNav('list')
    +'<div class="ps-actions">'
      +'<div class="ps-action"><i class="ic fa-solid fa-helmet-safety"></i><div class="tx"><b>A construction stage is complete</b><div>Foundation, a floor casting, brickwork… Mark it done for a tower (or a floor) and every booked flat there gets its demand in one go. You see every invoice before anything is raised.</div><button class="btn btn-primary btn-sm" onclick="navTo(\'postsales/invoices/stage\')"><i class="fa-solid fa-check"></i> Mark stage complete</button></div></div>'
      +'<div class="ps-action"><i class="ic fa-solid fa-calendar-check"></i><div class="tx"><b>Time-based demands</b><div>Balance booking, agreement and similar milestones fall due a set number of days after booking. This raises every one that has come due, dated today.</div><button class="btn btn-sm" onclick="psiRaiseDue()"><i class="fa-solid fa-file-invoice"></i> Raise due invoices</button></div></div>'
    +'</div>'
    +'<div class="ps-filters">'+projSelect('psiProj',I.pid,'psiFilter()','All projects')
    +'<select id="psiSt" onchange="psiFilter()"><option value="open"'+(I.status==='open'?' selected':'')+'>Open invoices</option><option value="overdue"'+(I.status==='overdue'?' selected':'')+'>Overdue</option><option value="unpaid"'+(I.status==='unpaid'?' selected':'')+'>Not fully paid</option><option value="cancelled"'+(I.status==='cancelled'?' selected':'')+'>Cancelled</option><option value=""'+(I.status===''?' selected':'')+'>All invoices</option></select>'
    +'<span class="mu-sw"><i class="fa-solid fa-magnifying-glass"></i><input id="psiQ" placeholder="Search invoice, booking, flat, customer or milestone" oninput="psiFilter()"></span></div>'
    +'<div id="psiList"></div>';
  window.psiFilter=function(){
    I.pid=val('psiProj')||null; I.status=val('psiSt'); const q=val('psiQ').toLowerCase(), td=today();
    const rows=I.list.filter(i=>{const b=i.bookings||{}, bal=num(i.total)-(I.paid[i.id]||0);
      if(I.pid&&String(i.project_id)!==I.pid) return false;
      if(I.status==='open'&&i.status!=='open') return false;
      if(I.status==='cancelled'&&i.status!=='cancelled') return false;
      if(I.status==='unpaid'&&(i.status!=='open'||bal<=0.5)) return false;
      if(I.status==='overdue'&&(i.status!=='open'||bal<=0.5||i.due_date>=td)) return false;
      return !q||[i.invoice_no,i.title,b.booking_no,b.flats&&b.flats.flat_code,b.towers&&b.towers.name,(b.booking_applicants||[]).map(a=>a.full_name).join(' ')].join(' ').toLowerCase().includes(q);});
    let T=0,P=0; rows.forEach(i=>{ if(i.status==='open'){T+=num(i.total);P+=(I.paid[i.id]||0);} });
    const info=i=>{const p=I.paid[i.id]||0,bal=num(i.total)-p,od=i.status==='open'&&bal>0.5&&i.due_date<td;
      return {p,bal,od,tag:i.status==='cancelled'?'<span class="tag t-gray">Cancelled</span>':bal<=0.5?'<span class="tag t-green">Paid</span>':od?'<span class="tag t-red">Overdue</span>':p>0?'<span class="tag t-amber">Part paid</span>':'<span class="tag t-blue">Due</span>'};};
    $('psiList').innerHTML=(rows.length?'<div class="psb-sum" style="margin:0 0 12px"><div>Invoiced (open)<b>'+inr(T)+'</b></div><div>Received<b>'+inr(P)+'</b></div><div>Balance<b>'+inr(T-P)+'</b></div></div>':'')
      +listHtml('in','psiFilter',rows,
      '<th>Invoice</th><th>Date</th><th>Due</th><th>Booking / flat</th><th>For</th><th class="pss-num">Amount</th><th class="pss-num">Received</th><th class="pss-num">Balance</th><th>Status</th>',
      i=>{const b=i.bookings||{},ap=(b.booking_applicants||[]).sort((x,y)=>x.seq-y.seq),x=info(i);
        return '<tr onclick="navTo(\'postsales/invoices/'+i.id+'\')"><td><b>'+esc(i.invoice_no)+'</b>'+(i.kind!=='milestone'?' <span class="tag t-purple">'+esc(KIND_LBL[i.kind])+'</span>':'')+'</td><td style="white-space:nowrap">'+dmy(i.invoice_date)+'</td><td style="white-space:nowrap'+(x.od?';color:#b91c1c;font-weight:600':'')+'">'+dmy(i.due_date)+'</td><td>'+esc(b.booking_no||'')+'<div class="pss-hint" style="margin:0">'+esc((b.towers&&b.towers.name||'')+' - '+(b.flats&&b.flats.flat_code||'')+(ap[0]?' · '+ap[0].full_name:''))+'</div></td><td>'+esc(i.title)+'<div class="pss-hint" style="margin:0">'+esc(VIA_LBL[i.raised_via]||'')+'</div></td><td class="pss-num">'+inr(i.total)+'</td><td class="pss-num">'+inr(x.p)+'</td><td class="pss-num"><b>'+inr(i.status==='open'?x.bal:0)+'</b></td><td>'+x.tag+'</td></tr>';},
      i=>{const b=i.bookings||{},ap=(b.booking_applicants||[]).sort((x,y)=>x.seq-y.seq),x=info(i);
        return '<div class="ps-card" onclick="navTo(\'postsales/invoices/'+i.id+'\')"><div class="r1"><b>'+esc(i.invoice_no)+'</b><span class="amt">'+inr(i.status==='open'&&x.bal>0.5?x.bal:i.total)+'</span></div><div class="r2">'+esc(i.title)+'</div><div class="r3"><span>'+esc((b.towers&&b.towers.name||'')+' - '+(b.flats&&b.flats.flat_code||'')+(ap[0]?' · '+ap[0].full_name:''))+'</span><span'+(x.od?' style="color:#b91c1c;font-weight:600"':'')+'>Due '+dmy(i.due_date)+'</span>'+x.tag+'</div></div>';},
      '<div class="empty"><i class="fa-solid fa-file-invoice"></i><div>No invoices match</div></div>');
  };
  psiFilter();
}
window.psiRaiseDue=async function(){
  const pid=val('psiProj')||null;
  if(!await confirmDialog('Raise every individual milestone that has come due (booking date + its due days) for '+(pid?'this project':'all projects')+'? Invoices are dated today.',{danger:false,okLabel:'Raise due invoices',title:'Raise due invoices'})) return;
  const {data,error}=await PS().rpc('raise_due_individual',{p_project_id:pid?Number(pid):null,p_date:today()});
  if(fail(error,'Could not raise invoices')) return;
  toast(data?data+' invoice'+(data===1?'':'s')+' raised':'Nothing is due right now','ok'); route();
};

/* ---- bulk: mark a construction stage complete ---- */
async function stageWizard(host,stale){
  I.w=I.w||{pid:I.pid?Number(I.pid):(S.pid||null),towerId:null,stageId:null,floor:null,done:today(),invDate:today(),remarks:'',rows:null};
  if(I.w.pid&&S.pid!==I.w.pid){ await loadProject(I.w.pid); S.pid=I.w.pid; }
  if(stale()) return;
  drawWizard(host);
}
function drawWizard(host){
  const w=I.w, st=S.stages.find(s=>s.id===w.stageId), t=S.towers.find(x=>x.id===w.towerId);
  const floors=t?S.floors.filter(f=>f.tower_id===t.id).sort((a,b)=>a.floor_no-b.floor_no):[];
  host.innerHTML='<div class="toolbar"><button class="btn btn-sm btn-ghost" onclick="I_reset();navTo(\'postsales/invoices\')"><i class="fa-solid fa-arrow-left"></i> Invoices</button><div class="sec-title" style="margin:0;flex:1">Mark a construction stage complete</div></div>'
    +'<div class="psb-sec"><div class="pss-hint">Tower-level stages (foundation, floor castings, roof, possession) invoice every booked flat in the tower; floor-level stages (brickwork, flooring, POP) invoice every booked flat on that floor. You see every invoice before anything is raised.</div><div class="frm psb-grid">'
    +'<div><label>Project</label>'+projSelect('psiWP',w.pid,'psiW(\'pid\',this.value?Number(this.value):null,1)','Choose…')+'</div>'
    +'<div><label>Tower</label><select onchange="psiW(\'towerId\',this.value?Number(this.value):null,1)"><option value="">Choose…</option>'+S.towers.map(x=>'<option value="'+x.id+'"'+(x.id===w.towerId?' selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select></div>'
    +'<div class="psb-span2"><label>Stage</label><select onchange="psiW(\'stageId\',this.value?Number(this.value):null,1)"><option value="">Choose…</option>'
      +['tower','floor'].map(l=>'<optgroup label="'+(l==='tower'?'Tower level':'Floor level')+'">'+S.stages.filter(s=>s.level===l).map(s=>'<option value="'+s.id+'"'+(s.id===w.stageId?' selected':'')+'>'+esc(s.name)+'</option>').join('')+'</optgroup>').join('')+'</select></div>'
    +(st&&st.level==='floor'?'<div><label>Floor</label><select onchange="psiW(\'floor\',this.value===\'\'?null:Number(this.value),1)"><option value="">Choose…</option>'+floors.map(f=>'<option value="'+f.floor_no+'"'+(f.floor_no===w.floor?' selected':'')+'>'+esc(f.label||ordinal(f.floor_no))+'</option>').join('')+'</select></div>':'')
    +'<div><label>Completed on</label><input type="date" value="'+esc(w.done)+'" onchange="psiW(\'done\',this.value)"></div>'
    +'<div><label>Invoice date</label><input type="date" value="'+esc(w.invDate)+'" onchange="psiW(\'invDate\',this.value)"><div class="pss-hint" style="margin:4px 0 0">Due 30 days after.</div></div>'
    +'<div class="psb-span2"><label>Remarks</label><input value="'+esc(w.remarks)+'" oninput="psiW(\'remarks\',this.value)"></div>'
    +'</div><div style="margin-top:12px"><button class="btn btn-primary" onclick="psiPreview()"'+(t&&st&&(st.level==='tower'||w.floor!=null)?'':' disabled')+'><i class="fa-solid fa-eye"></i> Preview invoices</button></div></div>'
    +'<div id="psiPrev"></div>';
  if(w.rows) drawPreview();
}
window.I_reset=function(){ I.w=null; };
window.psiW=async function(k,v,redraw){
  I.w[k]=v; I.w.rows=null;
  if(k==='pid'){ I.w.towerId=null; I.w.stageId=null; I.w.floor=null; if(v){ await loadProject(v); S.pid=v; } }
  if(k==='towerId') I.w.floor=null;
  if(k==='stageId'){ const s=S.stages.find(x=>x.id===v); if(s&&s.level==='tower') I.w.floor=null; }
  if(redraw) drawWizard($('psiBody'));
};
window.psiPreview=async function(){
  const w=I.w, st=S.stages.find(s=>s.id===w.stageId);
  let q=PS().from('booking_milestones').select('id,booking_id,name,gross_total,bookings!inner(id,booking_no,status,tower_id,floor_no,flats(flat_code),booking_applicants(full_name,seq))').eq('stage_id',w.stageId).eq('bookings.tower_id',w.towerId).eq('bookings.status','active');
  if(st.level==='floor') q=q.eq('bookings.floor_no',w.floor);
  const {data,error}=await q;
  if(fail(error,'Could not load bookings')) return;
  const ids=(data||[]).map(m=>m.id);
  const done=new Set();
  if(ids.length){ const {data:inv}=await PS().from('invoices').select('booking_milestone_id,invoice_no').in('booking_milestone_id',ids).eq('status','open'); (inv||[]).forEach(x=>done.add(x.booking_milestone_id)); }
  w.rows=(data||[]).map(m=>({...m,already:done.has(m.id),pick:!done.has(m.id)})).sort((a,b)=>(a.bookings.floor_no-b.bookings.floor_no)||String(a.bookings.flats&&a.bookings.flats.flat_code).localeCompare(String(b.bookings.flats&&b.bookings.flats.flat_code)));
  drawPreview();
};
function drawPreview(){
  const w=I.w, h=$('psiPrev'); if(!h) return;
  const rows=w.rows||[], pick=rows.filter(r=>r.pick&&!r.already), tot=pick.reduce((s,r)=>s+num(r.gross_total),0);
  h.innerHTML='<div class="psb-sec"><h3>'+rows.length+' booking'+(rows.length===1?'':'s')+' wait on this stage</h3>'
    +(rows.length?'<div style="overflow-x:auto"><table class="psb-tbl"><thead><tr><th><input type="checkbox" '+(pick.length===rows.filter(r=>!r.already).length&&pick.length?'checked':'')+' onchange="psiPickAll(this.checked)"></th><th>Booking</th><th>Flat</th><th>Applicant</th><th>Milestone</th><th class="r">Invoice amount</th></tr></thead><tbody>'
      +rows.map((r,i)=>{const b=r.bookings,ap=(b.booking_applicants||[]).sort((x,y)=>x.seq-y.seq);return '<tr'+(r.already?' style="opacity:.55"':'')+'><td>'+(r.already?'<i class="fa-solid fa-check" title="Already invoiced"></i>':'<input type="checkbox"'+(r.pick?' checked':'')+' onchange="psiPick('+i+',this.checked)">')+'</td><td>'+esc(b.booking_no)+'</td><td>'+esc(b.flats&&b.flats.flat_code||'')+'</td><td>'+esc(ap[0]?ap[0].full_name:'')+'</td><td>'+esc(r.name)+(r.already?' <span class="tag t-gray">already invoiced</span>':'')+'</td><td class="r">'+inr(r.gross_total)+'</td></tr>';}).join('')
      +'<tr class="t"><td></td><td colspan="4">'+pick.length+' to invoice</td><td class="r">'+inr(tot)+'</td></tr></tbody></table></div>':'<div class="pss-hint">No active booking in this '+(w.floor!=null?'floor':'tower')+' has a milestone on this stage. You can still record the stage as complete - bookings made later are invoiced for it at booking.</div>')
    +'<div class="psb-bar"><button class="btn btn-primary" id="psiGo" onclick="psiComplete()"><i class="fa-solid fa-check"></i> '+(pick.length?'Mark complete & raise '+pick.length+' invoice'+(pick.length===1?'':'s'):'Mark stage complete')+'</button></div></div>';
}
window.psiPick=function(i,v){ I.w.rows[i].pick=v; drawPreview(); };
window.psiPickAll=function(v){ I.w.rows.forEach(r=>{ if(!r.already) r.pick=v; }); drawPreview(); };
window.psiComplete=async function(){
  const w=I.w;
  if(!w.done||!w.invDate){ toast('Enter the completion and invoice dates','err'); return; }
  const btn=$('psiGo'); if(btn) btn.disabled=true;
  const {data,error}=await PS().rpc('complete_stage',{p:{tower_id:w.towerId,stage_id:w.stageId,floor_no:w.floor,completed_on:w.done,invoice_date:w.invDate,remarks:w.remarks,booking_ids:(w.rows||[]).filter(r=>r.pick&&!r.already).map(r=>r.booking_id)}});
  if(btn) btn.disabled=false;
  if(fail(error,'Could not complete the stage')) return;
  toast('Stage recorded'+(data.invoices?' · '+data.invoices+' invoice'+(data.invoices===1?'':'s')+' raised':''),'ok');
  I.w=null; I.status='open'; navTo('postsales/invoices');
};

/* ---- interest due across bookings ---- */
async function interestDue(host,stale){
  const pid=I.pid?Number(I.pid):null;
  const {data,error}=await PS().rpc('interest_summary',{p_project_id:pid,p_as_of:today()});
  if(stale()) return;
  if(error){ host.innerHTML='<div class="empty"><div>'+esc(error.message)+'</div></div>'; return; }
  const ids=(data||[]).map(r=>r.booking_id);
  let bk=[];
  if(ids.length){ const r=await PS().from('bookings').select('id,booking_no,project_id,flats(flat_code),towers(name),booking_applicants(full_name,seq)').in('id',ids); bk=r.data||[]; }
  if(stale()) return;
  const by={}; bk.forEach(b=>by[b.id]=b);
  const rows=(data||[]).sort((a,b)=>num(b.suggested)-num(a.suggested)||num(b.running)-num(a.running));
  const T=k=>rows.reduce((s,r)=>s+num(r[k]),0);
  host.innerHTML=invNav('interest')
    +'<div class="ps-head"><div class="t"><div class="sec-title">Interest on late payment (18% p.a.) - as of today</div><div class="pss-hint" style="margin:2px 0 0"><b>Suggested</b> = interest on payments that came in after their due date, not yet billed or waived. Open a booking to approve (bill) or waive it. <b>Running</b> = still building on demands not yet paid.</div></div></div>'
    +'<div class="ps-filters">'+projSelect('psiIP',pid,'I.pid=this.value;route()','All projects')+'</div>'
    +mKpis([['Suggested for billing',inr(T('suggested')),rows.filter(r=>num(r.suggested)>0.5).length+' bookings'],['Running',inr(T('running')),'on unpaid demands'],['Billed',inr(T('billed')),''],['Waived',inr(T('waived')),'']])
    +'<div class="card" style="padding:0;margin-top:14px"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Booking</th><th>Flat</th><th>Applicant</th><th class="pss-num">Paid late</th><th class="pss-num">Running</th><th class="pss-num">Billed</th><th class="pss-num">Waived</th><th class="pss-num">Suggested</th></tr></thead><tbody>'
    +(rows.map(r=>{const b=by[r.booking_id]||{},ap=(b.booking_applicants||[]).sort((x,y)=>x.seq-y.seq);return '<tr style="cursor:pointer" onclick="navTo(\'postsales/bookings/'+r.booking_id+'\')"><td><b>'+esc(b.booking_no||'')+'</b></td><td>'+esc((b.towers&&b.towers.name||'')+' - '+(b.flats&&b.flats.flat_code||''))+'</td><td>'+esc(ap[0]?ap[0].full_name:'')+'</td><td class="pss-num">'+inr(r.paid_late)+'</td><td class="pss-num">'+inr(r.running)+'</td><td class="pss-num">'+inr(r.billed)+'</td><td class="pss-num">'+inr(r.waived)+'</td><td class="pss-num"><b>'+inr(r.suggested)+'</b></td></tr>';}).join('')
      ||'<tr><td colspan="8"><div class="empty"><i class="fa-solid fa-percent"></i><div>No interest - nothing has been paid late</div></div></td></tr>')+'</tbody></table></div></div>';
}

/* ---- construction progress ---- */
async function progressView(host,stale){
  const pid=I.pid?Number(I.pid):(S.pid||(S.projects[0]&&S.projects[0].id));
  if(pid&&S.pid!==pid){ await loadProject(pid); S.pid=pid; }
  const {data:ev}=await PS().from('stage_events').select('*').eq('project_id',pid).order('completed_on');
  const evIds=(ev||[]).map(e=>e.id); const cnt={};
  if(evIds.length){ const {data:inv}=await PS().from('invoices').select('stage_event_id').in('stage_event_id',evIds).eq('status','open'); (inv||[]).forEach(i=>cnt[i.stage_event_id]=(cnt[i.stage_event_id]||0)+1); }
  if(stale()) return;
  const sn=id=>{const s=S.stages.find(x=>x.id===id);return s?s.name:'';};
  host.innerHTML=invNav('progress')
    +'<div class="ps-head"><div class="t"><div class="sec-title">Construction progress</div><div class="pss-hint" style="margin:2px 0 0">Every stage recorded as complete, per tower (and per floor for floor-level stages), with the invoices it raised. New bookings in a tower are invoiced for these stages at booking.</div></div><div class="acts"><button class="btn btn-primary" onclick="navTo(\'postsales/invoices/stage\')"><i class="fa-solid fa-helmet-safety"></i> Mark stage complete</button></div></div>'
    +'<div class="ps-filters">'+projSelect('psiPP',pid,'I.pid=this.value;psiProgressGo()','')+'</div>'
    +(S.towers.map(t=>{const e=(ev||[]).filter(x=>x.tower_id===t.id);
      return '<div class="psb-sec"><h3>'+esc(t.name)+' <span class="tag t-gray">'+e.length+' stage'+(e.length===1?'':'s')+' complete</span></h3>'+(e.length?'<table class="psb-tbl"><thead><tr><th>Stage</th><th>Floor</th><th>Completed on</th><th class="r">Invoices raised</th><th>Recorded by</th></tr></thead><tbody>'+e.map(x=>'<tr><td>'+esc(sn(x.stage_id))+'</td><td>'+(x.floor_no==null?'<span style="color:var(--slate)">Whole tower</span>':esc(ordinal(x.floor_no)))+'</td><td>'+dmy(x.completed_on)+'</td><td class="r">'+(cnt[x.id]||0)+'</td><td>'+esc((x.created_by||'').split('@')[0])+'</td></tr>').join('')+'</tbody></table>':'<div class="pss-hint">Nothing recorded yet.</div>')+'</div>';}).join('')||'<div class="empty"><div>No towers set up for this project</div></div>');
}
window.psiProgressGo=function(){ I.pid=val('psiPP'); route(); };

/* ---- invoice view, cancel, print ---- */
async function loadInvoice(id){
  const {data:i,error}=await PS().from('invoices').select('*,bookings!invoices_booking_id_fkey(id,booking_no,project_id,floor_no,flats(flat_code),towers(name),booking_applicants(full_name,title,seq,res_address,off_address,mailing_address))').eq('id',id).single();
  if(error) return null;
  const [ln,al]=await Promise.all([PS().from('invoice_lines').select('*').eq('invoice_id',id).order('seq'),PS().from('receipt_allocations').select('amount,receipts(id,receipt_no,receipt_date,mode)').eq('invoice_id',id)]);
  return {i,ln:ln.data||[],al:al.data||[]};
}
async function invoiceView(host,id,stale){
  const v=await loadInvoice(id);
  if(stale()) return;
  if(!v){ host.innerHTML='<div class="empty"><div>Invoice not found</div></div>'; return; }
  const {i,ln,al}=v, b=i.bookings||{}, ap=(b.booking_applicants||[]).sort((x,y)=>x.seq-y.seq);
  const paid=al.reduce((s,a)=>s+num(a.amount),0), bal=num(i.total)-paid, od=i.status==='open'&&bal>0.5&&i.due_date<today();
  host.innerHTML='<div class="toolbar"><button class="btn btn-sm btn-ghost" onclick="navTo(\'postsales/invoices\')"><i class="fa-solid fa-arrow-left"></i> Invoices</button><div style="flex:1"><div class="sec-title" style="margin:0">'+esc(i.invoice_no)+' '+(i.status==='cancelled'?'<span class="tag t-gray">Cancelled</span>':bal<=0.5?'<span class="tag t-green">Paid</span>':od?'<span class="tag t-red">Overdue</span>':'<span class="tag t-blue">Due</span>')+'</div><div class="pss-hint" style="margin:0"><a href="javascript:void 0" onclick="navTo(\'postsales/bookings/'+b.id+'\')">'+esc(b.booking_no||'')+'</a> · '+esc((b.towers&&b.towers.name||'')+' - '+(b.flats&&b.flats.flat_code||''))+' · '+esc(ap.map(a=>a.full_name).join(' & '))+'</div></div>'
    +'<button class="btn" onclick="psiPrint('+i.id+')"><i class="fa-solid fa-print"></i> Demand note</button>'+(i.status==='open'?'<button class="btn btn-danger" onclick="psiCancelModal('+i.id+')"><i class="fa-solid fa-ban"></i> Cancel</button>':'')+'</div>'
    +mKpis([['Amount',inr(i.total),'incl. GST '+inr(i.gst)],['Received',inr(paid),''],['Balance',inr(i.status==='open'?bal:0),od?'overdue since '+dmy(i.due_date):'due '+dmy(i.due_date)]])
    +'<div class="psb-sec" style="margin-top:14px"><h3>'+esc(i.title)+'</h3><div class="psb-facts"><span>Invoice date <b>'+dmy(i.invoice_date)+'</b></span><span>Due <b>'+dmy(i.due_date)+'</b></span><span>Type <b>'+esc(KIND_LBL[i.kind])+'</b></span><span>Raised <b>'+esc(VIA_LBL[i.raised_via]||i.raised_via)+'</b> by <b>'+esc((i.created_by||'').split('@')[0])+'</b></span></div>'
      +'<table class="psb-tbl" style="margin-top:10px"><thead><tr><th>Particulars</th><th class="r">Amount</th><th class="r">GST</th><th class="r">Total</th></tr></thead><tbody>'+ln.map(l=>'<tr><td>'+esc(l.head)+'</td><td class="r">'+inr(l.net)+'</td><td class="r">'+inr(l.gst)+'</td><td class="r">'+inr(l.total)+'</td></tr>').join('')+'<tr class="t"><td>Total</td><td class="r">'+inr(i.net)+'</td><td class="r">'+inr(i.gst)+'</td><td class="r">'+inr(i.total)+'</td></tr></tbody></table>'
      +(i.remarks?'<div class="pss-hint" style="margin-top:8px">'+esc(i.remarks)+'</div>':'')
      +(i.status==='cancelled'?'<div class="pss-banner" style="margin-top:12px"><i class="fa-solid fa-ban"></i><div class="grow">Cancelled by '+esc((i.cancelled_by||'').split('@')[0])+' - '+esc(i.cancel_reason||'')+'</div></div>':'')+'</div>'
    +'<div class="psb-sec"><h3>Payments applied</h3>'+(al.length?'<table class="psb-tbl"><thead><tr><th>Receipt</th><th>Date</th><th>Mode</th><th class="r">Applied</th></tr></thead><tbody>'+al.map(a=>'<tr style="cursor:pointer" onclick="navTo(\'postsales/receipts/'+(a.receipts&&a.receipts.id)+'\')"><td>'+esc(a.receipts&&a.receipts.receipt_no||'')+'</td><td>'+dmy(a.receipts&&a.receipts.receipt_date)+'</td><td>'+esc(MODE_LBL[a.receipts&&a.receipts.mode]||'')+'</td><td class="r">'+inr(a.amount)+'</td></tr>').join('')+'</tbody></table>':'<div class="pss-hint">Nothing received against this invoice yet.</div>')+'</div>';
}
window.psiCancelModal=function(id){
  openModal('<div class="modal-head"><h3>Cancel invoice</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm"><div class="pss-hint">The invoice stays on record as cancelled; any payment applied to it moves to the booking\'s next due invoice (or back to advance). Its milestone can be invoiced again afterwards.</div><label>Reason</label><input id="psiCR" placeholder="e.g. Raised on the wrong date"></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Keep it</button><button class="btn btn-danger" onclick="psiCancel('+id+')">Cancel invoice</button></div>');
};
window.psiCancel=async function(id){
  const r=val('psiCR'); if(!r){ toast('Enter the reason','err'); return; }
  const {error}=await PS().rpc('cancel_invoice',{p_invoice_id:id,p_reason:r});
  if(fail(error,'Could not cancel')) return;
  closeModal(); toast('Invoice cancelled','ok'); route();
};
window.psiPrint=async function(id){
  const w=window.open('','_blank');
  if(!w){ toast('Allow pop-ups to print the demand note','err'); return; }
  w.document.write('<!doctype html><meta charset="utf-8"><title>Preparing…</title><body style="font:14px system-ui;padding:30px">Preparing…</body>');
  const v=await loadInvoice(id); if(!v){ w.close(); return; }
  const {i,ln,al}=v, b=i.bookings||{}, ap=(b.booking_applicants||[]).sort((x,y)=>x.seq-y.seq), proj=S.projects.find(p=>p.id===i.project_id);
  const [{data:setup},{data:bal},{data:banks}]=await Promise.all([
    PS().from('project_setup').select('company_name').eq('project_id',i.project_id).maybeSingle(),
    PS().from('booking_balances').select('*').eq('booking_id',b.id).maybeSingle(),
    PS().from('bank_accounts').select('name,bank_name,account_no,ifsc').or('project_id.eq.'+i.project_id+',project_id.is.null').eq('active',true).is('deleted_at',null)]);
  const first=ap[0]||{}, addr=first.mailing_address==='office'?first.off_address:first.res_address;
  const n=x=>Math.round(num(x)).toLocaleString('en-IN'), paid=al.reduce((s,a)=>s+num(a.amount),0);
  const realBanks=(banks||[]).filter(x=>x.account_no);
  const html='<!doctype html><html><head><meta charset="utf-8"><title>Demand Note '+esc(i.invoice_no)+'</title><style>body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;margin:28px}h1{font-size:18px;margin:0}h2{font-size:14px;letter-spacing:4px;text-align:center;border:1px solid #333;padding:6px;margin:16px 0}table{width:100%;border-collapse:collapse;margin-top:8px}td,th{padding:7px 8px;border:1px solid #999;vertical-align:top}th{background:#f3f3f3;text-align:left}.r{text-align:right;white-space:nowrap}.t td{font-weight:bold}.k{width:22%;font-weight:bold;background:#f3f3f3}.note{font-size:11.5px;margin-top:10px;line-height:1.5}.void{color:#b91c1c;font-weight:bold;text-align:center;border:2px solid #b91c1c;padding:6px;margin-top:10px}@media print{body{margin:12mm}}</style></head><body>'
    +'<h1>'+esc(setup&&setup.company_name||'Jain Group')+'</h1><div>'+esc(proj?proj.name:'')+'</div><h2>'+(i.kind==='milestone'?'DEMAND NOTE':'INVOICE')+'</h2>'
    +'<table><tr><td class="k">Invoice no.</td><td>'+esc(i.invoice_no)+'</td><td class="k">Date</td><td>'+dmy(i.invoice_date)+'</td></tr>'
    +'<tr><td class="k">To</td><td colspan="3">'+esc(ap.map(a=>[a.title,a.full_name].filter(Boolean).join(' ')).join(' & '))+(addr?'<br><span style="font-size:12px">'+esc(addr)+'</span>':'')+'</td></tr>'
    +'<tr><td class="k">Booking / unit</td><td>'+esc(b.booking_no||'')+'</td><td class="k">Unit</td><td>'+esc((b.towers&&b.towers.name||'')+' - '+(b.flats&&b.flats.flat_code||''))+'</td></tr>'
    +'<tr><td class="k">For</td><td colspan="3"><b>'+esc(i.title)+'</b></td></tr></table>'
    +'<table><tr><th>Particulars</th><th class="r">Amount (₹)</th><th class="r">GST (₹)</th><th class="r">Total (₹)</th></tr>'+ln.map(l=>'<tr><td>'+esc(l.head)+'</td><td class="r">'+n(l.net)+'</td><td class="r">'+n(l.gst)+'</td><td class="r">'+n(l.total)+'</td></tr>').join('')
    +'<tr class="t"><td>Total</td><td class="r">'+n(i.net)+'</td><td class="r">'+n(i.gst)+'</td><td class="r">'+n(i.total)+'</td></tr>'
    +(paid?'<tr><td colspan="3">Less: already received against this invoice</td><td class="r">'+n(paid)+'</td></tr><tr class="t"><td colspan="3">Payable</td><td class="r">'+n(num(i.total)-paid)+'</td></tr>':'')+'</table>'
    +'<div style="margin-top:8px"><b>Amount payable: ₹ '+n(num(i.total)-paid)+'</b> (Rupees '+esc(inWords(num(i.total)-paid))+' only) on or before <b>'+dmy(i.due_date)+'</b>.</div>'
    +(bal?'<div style="margin-top:6px;font-size:12px">Total outstanding on this booking including this invoice: ₹ '+n(bal.principal_outstanding)+'.</div>':'')
    +(realBanks.length?'<table><tr><th colspan="4">Pay by cheque / NEFT / RTGS in favour of '+esc(setup&&setup.company_name||'')+'</th></tr>'+realBanks.map(x=>'<tr><td>'+esc(x.bank_name||x.name)+'</td><td>A/c '+esc(x.account_no)+'</td><td colspan="2">'+esc(x.ifsc?'IFSC '+x.ifsc:'')+'</td></tr>').join('')+'</table>':'')
    +'<div class="note">Interest at 18% per annum is chargeable on any amount not paid by the due date. Please quote the booking number with every payment.</div>'
    +(i.status==='cancelled'?'<div class="void">CANCELLED - '+esc(i.cancel_reason||'')+'</div>':'')
    +'<div style="margin-top:40px;text-align:right">______________________<br>Authorised Signatory</div>'
    +'<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>';
  w.document.open(); w.document.write(html); w.document.close();
};

/* ---- booking page: milestone status + raise ---- */
function milestoneStatus(b,ms,inv,al){
  const paid=id=>al.filter(a=>a.invoice_id===id).reduce((s,a)=>s+num(a.amount),0);
  const stName=sid=>{const s=S.stages.find(x=>x.id===sid);return s?s.name:'';};
  return '<div style="overflow-x:auto;margin-top:12px"><table class="psb-tbl"><thead><tr><th>#</th><th>Milestone</th><th>When</th><th class="r">Amount</th><th>Invoice</th><th class="r">Balance</th><th></th></tr></thead><tbody>'
    +ms.map(m=>{const iv=inv.find(x=>x.booking_milestone_id===m.id&&x.status==='open');
      const when=m.trigger_type==='individual'?(m.due_days!=null?(()=>{const d=new Date(b.booking_date);d.setDate(d.getDate()+m.due_days);return 'Due '+dmy(d.toISOString().slice(0,10));})():'Raised by hand'):esc(stName(m.stage_id));
      const bal=iv?num(iv.total)-paid(iv.id):null;
      return '<tr><td>'+m.seq+'</td><td>'+esc(m.name)+'</td><td style="font-size:12px">'+when+'</td><td class="r">'+inr(m.gross_total)+'</td><td>'+(iv?'<a href="javascript:void 0" onclick="navTo(\'postsales/invoices/'+iv.id+'\')">'+esc(iv.invoice_no)+'</a> <span class="pss-hint">'+dmy(iv.invoice_date)+'</span>':'<span class="tag t-gray">Not invoiced</span>')+'</td><td class="r">'+(iv?(bal<=0.5?'<span class="tag t-green">Paid</span>':inr(bal)):'')+'</td><td>'+(!iv&&b.status==='active'&&num(m.gross_total)>0?'<button class="btn btn-sm" onclick="psiRaiseOne('+m.id+',\''+esc(m.name).replace(/'/g,'')+'\')">Raise</button>':'')+'</td></tr>';}).join('')
    +'</tbody></table></div>';
}
/* ============================ POST SALES — INTEREST, CANCELLATION, TRANSFER (Stage 5) ============================
   Spec: docs/post-sales-spec.md §5-§7. Functions: supabase/migrations/20261001230000_postsales_interest_cancel_transfer.sql.
   Interest is shown, never charged, until someone approves billing it (an interest invoice + 18% GST);
   waivers need a reason. Cancellation and transfer are one confirmation each, with the settlement
   shown before anything is changed. */
async function interestRows(bookingId){
  const {data,error}=await PS().rpc('interest_calc',{p_booking_id:bookingId,p_as_of:today()});
  if(error){ toast('Could not work out interest: '+error.message,'err'); return []; }
  return data||[];
}
function interestPanel(b,rows){
  if(!rows.length) return '';
  const t=k=>rows.reduce((s,r)=>s+num(r[k]),0), unsettled=Math.max(0,t('paid_late')+t('running')-t('billed')-t('waived'));
  if(t('paid_late')+t('running')<0.5) return '';
  return '<div class="psb-sec"><h3 style="justify-content:space-between">Interest on late payment (18% p.a.)'
    +(b.status==='active'&&unsettled>0.5?'<span style="display:flex;gap:6px"><button class="btn btn-sm btn-primary" onclick="psxInterestModal('+b.id+',\'bill\')"><i class="fa-solid fa-check"></i> Approve &amp; bill</button><button class="btn btn-sm" onclick="psxInterestModal('+b.id+',\'waive\')">Waive</button></span>':'')+'</h3>'
    +'<div class="pss-hint">Paid late = interest on amounts already paid after their due date - this is what is suggested for billing. Running = interest still building up on what is unpaid today. Nothing is charged until it is approved.</div>'
    +'<div style="overflow-x:auto"><table class="psb-tbl"><thead><tr><th>Invoice</th><th>Due</th><th class="r">Days late</th><th class="r">Unpaid</th><th class="r">Paid late</th><th class="r">Running</th><th class="r">Billed</th><th class="r">Waived</th><th class="r">Suggested</th></tr></thead><tbody>'
    +rows.filter(r=>num(r.paid_late)+num(r.running)>0).map(r=>'<tr><td>'+esc(r.invoice_no)+'<div class="pss-hint" style="margin:0">'+esc(r.title)+'</div></td><td>'+dmy(r.due_date)+'</td><td class="r">'+r.days_overdue+'</td><td class="r">'+inr(r.balance)+'</td><td class="r">'+inr(r.paid_late)+'</td><td class="r">'+inr(r.running)+'</td><td class="r">'+inr(r.billed)+'</td><td class="r">'+inr(r.waived)+'</td><td class="r"><b>'+inr(r.suggested)+'</b></td></tr>').join('')
    +'<tr class="t"><td colspan="3">Total</td><td class="r">'+inr(t('balance'))+'</td><td class="r">'+inr(t('paid_late'))+'</td><td class="r">'+inr(t('running'))+'</td><td class="r">'+inr(t('billed'))+'</td><td class="r">'+inr(t('waived'))+'</td><td class="r">'+inr(t('suggested'))+'</td></tr></tbody></table></div></div>';
}
window.psxInterestModal=async function(bookingId,mode){
  const rows=(await interestRows(bookingId)).filter(r=>num(r.paid_late)+num(r.running)-num(r.billed)-num(r.waived)>0.5);
  if(!rows.length){ toast('No interest left to settle','ok'); return; }
  const bill=mode==='bill';
  const def=(r,withRunning)=>r2(Math.max(0,num(r.paid_late)+(withRunning?num(r.running):0)-num(r.billed)-num(r.waived)));
  openModal('<div class="modal-head"><h3>'+(bill?'Approve and bill interest':'Waive interest')+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm">'
    +'<div class="pss-hint">'+(bill?'Raises one interest invoice (+18% GST, due in 30 days). Amounts can be edited before approving.':'Records a waiver - the amount is no longer suggested and nothing is billed.')+'</div>'
    +'<label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="psxRun" style="width:auto" onchange="psxRunToggle()"> Include running interest (on amounts still unpaid, up to today)</label>'
    +'<table class="psb-tbl" style="margin-top:8px"><thead><tr><th>Invoice</th><th class="r">Paid late</th><th class="r">Running</th><th class="r">Already settled</th><th class="r">Amount</th></tr></thead><tbody>'
    +rows.map((r,i)=>'<tr><td>'+esc(r.invoice_no)+'<div class="pss-hint" style="margin:0">'+esc(r.title)+'</div></td><td class="r">'+inr(r.paid_late)+'</td><td class="r">'+inr(r.running)+'</td><td class="r">'+inr(num(r.billed)+num(r.waived))+'</td><td class="r"><input class="n psxAmt" type="number" step="0.01" data-sid="'+r.invoice_id+'" data-a="'+def(r,false)+'" data-b="'+def(r,true)+'" value="'+def(r,false)+'" style="width:110px" oninput="psxTot()"></td></tr>').join('')
    +'</tbody></table><div style="text-align:right;margin-top:8px;font-weight:700" id="psxTot"></div>'
    +(bill?'<label>Invoice date</label><input type="date" id="psxDate" value="'+today()+'">':'<label>Reason for waiving *</label><input id="psxReason" placeholder="e.g. Delay due to bank loan disbursement - approved by MD">')
    +'</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="psxInterestGo('+bookingId+',\''+mode+'\')">'+(bill?'Approve &amp; raise invoice':'Record waiver')+'</button></div>','lg');
  psxTot();
};
window.psxRunToggle=function(){ const on=$('psxRun').checked; document.querySelectorAll('.psxAmt').forEach(i=>i.value=on?i.dataset.b:i.dataset.a); psxTot(); };
window.psxTot=function(){ const t=[...document.querySelectorAll('.psxAmt')].reduce((s,i)=>s+num(i.value),0); const e=$('psxTot'); if(e) e.textContent='Total '+inr(t)+($('psxDate')?' + GST '+inr(Math.round(t*0.18))+' = '+inr(t+Math.round(t*0.18)):''); };
window.psxInterestGo=async function(bookingId,mode){
  const items=[...document.querySelectorAll('.psxAmt')].map(i=>({source_invoice_id:Number(i.dataset.sid),amount:num(i.value)})).filter(x=>x.amount>0);
  if(!items.length){ toast('Enter at least one amount','err'); return; }
  let error;
  if(mode==='bill') ({error}=await PS().rpc('bill_interest',{p:{booking_id:bookingId,invoice_date:val('psxDate')||today(),items}}));
  else { const reason=val('psxReason'); if(!reason){ toast('Enter the reason for waiving','err'); return; } ({error}=await PS().rpc('waive_interest',{p:{booking_id:bookingId,reason,items}})); }
  if(fail(error,'Could not save')) return;
  closeModal(); toast(mode==='bill'?'Interest invoice raised':'Waiver recorded','ok'); route();
};

/* ---- cancellation ---- */
window.psxCancelModal=async function(bookingId){
  const [{data:b},{data:bal},{data:inv},{data:calc},rows]=await Promise.all([
    PS().from('bookings').select('*').eq('id',bookingId).single(),
    PS().from('booking_balances').select('*').eq('booking_id',bookingId).maybeSingle(),
    PS().from('invoices').select('kind,total,status').eq('booking_id',bookingId).eq('status','open'),
    PS().rpc('cancellation_charge',{p_booking_id:bookingId,p_date:today()}),
    interestRows(bookingId)]);
  const unsettled=Math.max(0,rows.reduce((s,r)=>s+num(r.paid_late)+num(r.running)-num(r.billed)-num(r.waived),0));
  const within=(new Date(today())-new Date(b.booking_date))/864e5<=15;
  B.cx={b,bal,inv:inv||[],calc:num(calc)};
  openModal('<div class="modal-head"><h3>Cancel booking '+esc(b.booking_no)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm">'
    +'<div class="pss-banner"><i class="fa-solid fa-circle-info"></i><div class="grow">'+(within?'Cancelled within 15 days of the application: <b>₹50,000 + GST</b>.':'More than 15 days after the application: <b>10% of total consideration</b> ('+inr(b.total_consideration)+', incl. EDC, excl. GST) <b>+ GST</b>.')+' Calculated charge: <b>'+inr(calc)+'</b> + 18% GST.</div></div>'
    +(unsettled>0.5?'<div class="pss-banner" style="border-color:#fde68a;background:#fffbeb"><i class="fa-solid fa-triangle-exclamation" style="color:#b45309"></i><div class="grow">'+inr(unsettled)+' of late-payment interest is not billed. It is only deducted if it is billed first (Approve &amp; bill on the booking) - otherwise it is dropped with the booking.</div></div>':'')
    +'<div class="two"><div><label>Cancellation date</label><input type="date" id="psxCD" value="'+today()+'" onchange="psxCxDate()"></div><div><label>Cancellation charge (₹, before GST)</label><input type="number" id="psxCC" value="'+num(calc)+'" oninput="psxCxCalc()"></div></div>'
    +'<div id="psxCW" style="display:none"><label>Reason for reducing / waiving the charge *</label><input id="psxCWR"></div>'
    +'<label>Reason for cancellation *</label><input id="psxCR" placeholder="e.g. Customer request letter dated …">'
    +'<div id="psxCS" style="margin-top:12px"></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Keep booking</button><button class="btn btn-danger" onclick="psxCancelGo('+bookingId+')"><i class="fa-solid fa-ban"></i> Cancel booking</button></div>','lg');
  psxCxCalc();
};
window.psxCxDate=async function(){ const {data}=await PS().rpc('cancellation_charge',{p_booking_id:B.cx.b.id,p_date:val('psxCD')||today()}); B.cx.calc=num(data); $('psxCC').value=B.cx.calc; psxCxCalc(); };
window.psxCxCalc=function(){
  const c=B.cx, charge=Math.max(0,num(val('psxCC'))), gst=Math.round(charge*0.18), bal=c.bal||{};
  $('psxCW').style.display=charge<c.calc?'':'none';
  const received=num(bal.principal_received)+num(bal.interest_received)-num(bal.paid_out);
  const others=c.inv.filter(i=>i.kind!=='milestone').reduce((s,i)=>s+num(i.total),0);
  const net=received-(charge+gst)-others;
  $('psxCS').innerHTML='<table class="psb-tbl"><tbody><tr><td>Received from the customer</td><td class="r">'+inr(received)+'</td></tr>'
    +'<tr><td>Less: cancellation charge + GST ('+inr(charge)+' + '+inr(gst)+')</td><td class="r">−'+inr(charge+gst)+'</td></tr>'
    +(others?'<tr><td>Less: interest / other charges already billed</td><td class="r">−'+inr(others)+'</td></tr>':'')
    +'<tr class="t"><td>'+(net>=0?'Refund due to the customer':'Shortfall - recoverable from the customer')+'</td><td class="r">'+inr(Math.abs(net))+'</td></tr></tbody></table>'
    +'<div class="pss-hint" style="margin-top:6px">Open milestone invoices are cancelled, the flat becomes available again and the booking is kept on record as cancelled.</div>';
};
window.psxCancelGo=async function(bookingId){
  const reason=val('psxCR'); if(!reason){ toast('Enter the reason for cancellation','err'); return; }
  const charge=Math.max(0,num(val('psxCC')));
  if(charge>B.cx.calc){ toast('The charge can\'t be more than '+inr(B.cx.calc),'err'); return; }
  if(charge<B.cx.calc&&!val('psxCWR')){ toast('Enter the reason for reducing the charge','err'); return; }
  const {data,error}=await PS().rpc('cancel_booking',{p:{booking_id:bookingId,date:val('psxCD')||today(),reason,charge,waiver_reason:val('psxCWR')}});
  if(fail(error,'Could not cancel the booking')) return;
  closeModal(); toast('Booking cancelled - '+(num(data.refund_due)>0?'refund due '+inr(data.refund_due):num(data.recoverable)>0?inr(data.recoverable)+' recoverable':'nothing due either way'),'ok'); route();
};
window.psxRefundModal=async function(bookingId){
  const {data:bal}=await PS().from('booking_balances').select('advance').eq('booking_id',bookingId).maybeSingle();
  const banks=S.banks.filter(x=>x.active&&x.account_no);
  openModal('<div class="modal-head"><h3>Record refund</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body frm">'
    +'<div class="pss-hint">Left to refund: <b>'+inr(bal&&bal.advance)+'</b>. A refund can be paid in parts.</div>'
    +'<div class="two"><div><label>Date</label><input type="date" id="psxRD" value="'+today()+'"></div><div><label>Amount (₹)</label><input type="number" step="0.01" id="psxRA" value="'+Math.max(0,r2(num(bal&&bal.advance)))+'"></div></div>'
    +'<div class="two"><div><label>Mode</label><select id="psxRM"><option value="rtgs_neft_imps">RTGS / NEFT / IMPS</option><option value="cheque">Cheque</option><option value="dd">Demand Draft</option></select></div><div><label>UTR / cheque no.</label><input id="psxRI"></div></div>'
    +'<label>Paid from</label><select id="psxRB"><option value="">—</option>'+banks.map(x=>'<option value="'+x.id+'">'+esc(x.name)+'</option>').join('')+'</select>'
    +'<label>Remarks</label><input id="psxRR"></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="psxRefundGo('+bookingId+')">Save refund</button></div>');
};
window.psxRefundGo=async function(bookingId){
  if(!(num(val('psxRA'))>0)){ toast('Enter the amount','err'); return; }
  if(!val('psxRI')){ toast('Enter the UTR / cheque number','err'); return; }
  const {error}=await PS().rpc('save_refund',{p:{booking_id:bookingId,date:val('psxRD')||today(),amount:num(val('psxRA')),mode:val('psxRM'),instrument_no:val('psxRI'),bank_account_id:val('psxRB'),remarks:val('psxRR')}});
  if(fail(error,'Could not save the refund')) return;
  closeModal(); toast('Refund recorded','ok'); route();
};

/* ---- transfer to another flat (same customer) ---- */
window.psxTransferStart=async function(bookingId){
  const rows=await interestRows(bookingId);
  const unsettled=Math.max(0,rows.reduce((s,r)=>s+num(r.paid_late)+num(r.running)-num(r.billed)-num(r.waived),0));
  if(unsettled>1){
    openModal('<div class="modal-head"><h3>Settle interest first</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body">'+inr(unsettled)+' of late-payment interest on this booking isn\'t settled. Bill it (it is then paid out of the amount being transferred) or waive it, then start the transfer.</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button><button class="btn" onclick="closeModal();psxInterestModal('+bookingId+',\'waive\')">Waive</button><button class="btn btn-primary" onclick="closeModal();psxInterestModal('+bookingId+',\'bill\')">Approve &amp; bill</button></div>');
    return;
  }
  navTo('postsales/bookings/new/'+bookingId);
};

/* ============================ POST SALES — REPORTS (Stage 6) ============================
   Spec: docs/post-sales-spec.md §8. Route: postsales/reports[/<key>[/<bookingId>]].
   Every report: project / tower / date filters, totals, Excel export (SheetJS, already used elsewhere
   in JainE via loadXLSX) and a print layout that saves as PDF. Visible to anyone with Post Sales access. */
const REPORTS=[
  ['mis','MIS Report','fa-chart-column','Project-wise outstanding vs collection, all projects, in the weekly MIS layout: outstanding till date (active customers, net outstanding > 0), this month\'s and last month\'s collection (active units, not reversed).'],
  ['ledger','Applicant Ledger','fa-book','Every invoice, payment, reversal and refund for a customer by date, with a running balance.'],
  ['availability','Flat Availability','fa-table-cells','Floor-by-flat grid with status, today\'s price at list rate, and counts per tower and BHK.'],
  ['outstanding','Customer Outstanding with Interest','fa-hourglass-half','As on any date: invoiced, received, outstanding, overdue, interest built up / billed / received and total due.'],
  ['collection','Collection Report','fa-indian-rupee-sign','Receipts for a period with mode, bank and project, totals by mode and by bank.'],
  ['demand','Demand vs Collection','fa-scale-balanced','Per milestone: invoiced, collected, balance and % collected.'],
  ['cancellation','Cancellation / Refund Register','fa-ban','Cancelled and transferred bookings with charge, waivers, refund paid and pending, and recoverable shortfall.'],
  ['register','Sales / Booking Register','fa-file-signature','Bookings for a period with flat, applicants, rate, discount, consideration, plan, sales person and source.']
];
const fyStart=()=>{const d=new Date(today());const y=d.getMonth()>=3?d.getFullYear():d.getFullYear()-1;return y+'-04-01';};
const RP={pid:null,tower:'',from:null,to:null,asOf:null,q:'',view:'grid',booking:null,cols:null,rows:null,title:'',sub:''};
const apName=b=>((b.booking_applicants||[]).sort((x,y)=>x.seq-y.seq).map(a=>a.full_name).join(' & '));
const flatLbl=b=>(b.towers&&b.towers.name||'')+' - '+(b.flats&&b.flats.flat_code||'');
const BK_SEL='id,project_id,tower_id,booking_no,booking_date,status,rate,sba_sqft,discount_type,discount_value,total_consideration,grand_total,plan_name,is_non_standard,sales_person,source,crm_lead_id,cancelled_on,cancel_reason,cancel_charge_calc,cancel_charge,cancel_waiver_reason,transferred_to,flats(flat_code,bhk),towers(name),booking_applicants(full_name,seq)';
async function allRows(build){ // pages past PostgREST's 1000-row cap
  let out=[],from=0;
  for(;;){ const {data,error}=await build().range(from,from+999); if(error){ toast(error.message,'err'); break; } out=out.concat(data||[]); if(!data||data.length<1000) break; from+=1000; }
  return out;
}
const fmtCell=(c,v)=>c.t==='inr'?inr(v):c.t==='n'?(v==null?'':num(v).toLocaleString('en-IN',{maximumFractionDigits:2})):c.t==='d'?dmy(v):c.t==='pct'?(v==null?'':num(v).toFixed(1)+'%'):esc(v==null?'':v);
function repTable(cols,rows,opts){
  opts=opts||{};
  const tot=cols.map(c=>c.sum?rows.reduce((s,r)=>s+num(r[c.k]),0):null);
  return '<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+cols.map(c=>'<th'+(c.t==='inr'||c.t==='n'||c.t==='pct'?' class="pss-num"':'')+'>'+esc(c.h)+'</th>').join('')+'</tr></thead><tbody>'
    +(rows.map(r=>'<tr'+(r._link?' style="cursor:pointer" onclick="navTo(\''+r._link+'\')"':'')+(r._style?' style="'+r._style+'"':'')+'>'+cols.map(c=>'<td'+(c.t==='inr'||c.t==='n'||c.t==='pct'?' class="pss-num"':'')+'>'+(c.html?c.html(r):fmtCell(c,r[c.k]))+'</td>').join('')+'</tr>').join('')
      ||'<tr><td colspan="'+cols.length+'"><div class="empty" style="padding:28px"><div>'+esc(opts.empty||'Nothing to show for these filters')+'</div></div></td></tr>')
    +'</tbody>'+(rows.length&&tot.some(x=>x!=null)?'<tfoot><tr>'+cols.map((c,i)=>'<td'+(tot[i]!=null?' class="pss-num"':'')+' style="font-weight:700">'+(i===0?'Total ('+rows.length+')':tot[i]!=null?fmtCell(c,tot[i]):'')+'</td>').join('')+'</tr></tfoot>':'')+'</table></div></div>';
}
function repSet(title,sub,cols,rows){ RP.title=title; RP.sub=sub; RP.cols=cols; RP.rows=rows; }
/* ---- exports: a styled Excel workbook (ExcelJS, already used by the MIS and Usability exports)
   and a real PDF (jsPDF + autoTable). Both carry the company, the report title, the filters it was
   run with, when and by whom, a coloured header row, totals and page numbers. RP.theme 'mis' gives
   the MIS Report the look of the template it has always been circulated in (yellow header band). */
const XL_IND='[>=10000000]##\\,##\\,##\\,##0;[>=100000]##\\,##\\,##0;##,##0';
const XL_IND2='[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';
const indN=(v,dec)=>{const n=num(v),neg=n<0,a=Math.abs(n);const p=(dec?a.toFixed(2):String(Math.round(a))).split('.');let s=p[0];const l3=s.slice(-3);let rest=s.slice(0,-3);const g=[];while(rest.length>2){g.unshift(rest.slice(-2));rest=rest.slice(0,-2);}if(rest)g.unshift(rest);return (neg?'-':'')+(g.length?g.join(',')+','+l3:l3)+(dec&&p[1]?'.'+p[1]:'');};
const isNumCol=c=>c.t==='inr'||c.t==='n'||c.t==='pct';
const repCompany=()=>RP.theme==='mis'?'Jain Group':((S.setup&&S.setup.company_name)||'Jain Group');
const repStamp=()=>{const d=new Date();return dmy(today())+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+' by '+String(state.email||'').split('@')[0];};
const repFile=ext=>RP.title.replace(/[^\w ]+/g,' ').trim().replace(/\s+/g,'_')+'_'+today()+'.'+ext;
const cellText=(c,r)=>{const v=r[c.k];if(c.text) return c.text(r);if(c.t==='d') return dmy(v);if(c.t==='pct') return v==null?'':num(v).toFixed(1)+'%';if(c.t==='inr'||c.t==='n') return (v==null||v==='')?'':(RP.theme==='mis'&&!num(v)?'—':indN(v,c.t==='n'&&num(v)%1!==0));return v==null?'':String(v);};

window.psrpExcel=async function(btn){
  if(!RP.rows) return;
  const restore=btn?btn.innerHTML:''; if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Excel';}
  try{
    if(!(await usbLoadXlsx())) throw new Error('Could not load the spreadsheet library');
    const mis=RP.theme==='mis', brand=mis?'FF000000':'FF6D28D9', headFill=mis?'FFFFFF00':'FF6D28D9', headInk=mis?'FF000000':'FFFFFFFF';
    const cols=RP.cols.filter(c=>!c.noExport), n=cols.length;
    const wb=new ExcelJS.Workbook(); wb.creator='JAIN-E'; wb.created=new Date();
    const ws=wb.addWorksheet(RP.title.replace(/[^\w &-]/g,'').slice(0,31)||'Report',{views:[{state:'frozen',ySplit:6}]});
    const L=i=>ws.getColumn(i).letter;
    const band=(row,text,font,align)=>{ws.mergeCells(row,1,row,n);const c=ws.getCell(row,1);c.value=text;c.font=font;c.alignment={horizontal:align||'left',vertical:'middle'};};
    band(1,repCompany(),{size:15,bold:true,color:{argb:brand}},mis?'center':'left'); ws.getRow(1).height=22;
    band(2,RP.title,{size:13,bold:true},mis?'center':'left'); ws.getRow(2).height=19;
    band(3,RP.sub,{size:10.5,italic:!mis,bold:mis,color:{argb:mis?'FF000000':'FF475569'}},mis?'center':'left');
    band(4,'Generated on '+repStamp()+' · JAIN-E Post Sales',{size:9,color:{argb:'FF94A3B8'}},mis?'center':'left');
    const head=ws.getRow(6); head.values=cols.map(c=>c.h); head.height=mis?42:30;
    head.eachCell(c=>{c.font={bold:true,color:{argb:headInk},size:10};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:headFill}};c.alignment={vertical:'middle',horizontal:'center',wrapText:true};c.border={top:{style:'thin'},left:{style:'thin',color:{argb:'FFD4D4D8'}},bottom:{style:'thin'},right:{style:'thin',color:{argb:'FFD4D4D8'}}};});
    const thin={style:'thin',color:{argb:mis?'FF000000':'FFE4E4E7'}};
    RP.rows.forEach((r,ri)=>{
      const row=ws.addRow(cols.map(c=>{const v=r[c.k];
        if(c.text) return c.text(r);
        if(isNumCol(c)) return (v==null||v===''||(mis&&!num(v)))?null:(c.t==='pct'?num(v)/100:Math.round(num(v)*100)/100);
        if(c.t==='d') return v?new Date(String(v).slice(0,10)+'T00:00:00'):null;
        return v==null?'':v;}));
      row.eachCell({includeEmpty:true},(cell,ci)=>{const c=cols[ci-1];
        cell.border={top:thin,left:thin,bottom:thin,right:thin};
        cell.font={size:10,bold:mis&&!isNumCol(c)};
        if(!mis&&ri%2===1) cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF8F5FF'}};
        if(c&&isNumCol(c)){ cell.numFmt=c.t==='pct'?'0.0%':(c.t==='n'?'#,##0.##':XL_IND); cell.alignment={horizontal:'right',vertical:'top'}; if(mis&&cell.value==null){cell.value='—';cell.alignment={horizontal:'center'};} }
        else if(c&&c.t==='d'){ cell.numFmt='dd-mm-yyyy'; cell.alignment={horizontal:'center',vertical:'top'}; }
        else cell.alignment={vertical:'top',wrapText:true};
      });
    });
    const first=7,last=6+RP.rows.length;
    if(RP.rows.length&&cols.some(c=>c.sum)){
      const tot=ws.addRow(cols.map((c,i)=>{if(i===0) return mis?'TOTAL':'Total ('+RP.rows.length+')';if(!c.sum) return null;const res=RP.rows.reduce((s,r)=>s+num(r[c.k]),0);return {formula:'SUM('+L(i+1)+first+':'+L(i+1)+last+')',result:Math.round(res*100)/100};}));
      tot.height=20;
      tot.eachCell({includeEmpty:true},(cell,ci)=>{const c=cols[ci-1];cell.font={bold:true,size:10.5};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:mis?'FFF1F5F9':'FFEDE9FE'}};cell.border={top:{style:'medium',color:{argb:brand}},left:thin,bottom:{style:'double',color:{argb:brand}},right:thin};if(c&&c.sum){cell.numFmt=c.t==='n'?'#,##0.##':XL_IND;cell.alignment={horizontal:'right'};}});
    }
    cols.forEach((c,i)=>{const lens=[c.h.length*(mis?0.55:0.8)].concat(RP.rows.slice(0,400).map(r=>String(cellText(c,r)).length));ws.getColumn(i+1).width=Math.max(isNumCol(c)?13:9,Math.min(mis?40:46,Math.max.apply(null,lens)+3));});
    if(!mis&&RP.rows.length) ws.autoFilter={from:{row:6,column:1},to:{row:6,column:n}};
    ws.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:0.4,right:0.4,top:0.5,bottom:0.6,header:0.2,footer:0.3},printTitlesRow:'6:6'};
    ws.headerFooter={oddFooter:'&L&8'+repCompany().replace(/&/g,'&&')+' · JAIN-E Post Sales&C&8'+RP.title.replace(/&/g,'&&')+'&R&8Page &P of &N'};
    const buf=await wb.xlsx.writeBuffer();
    usbSaveBlob(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),repFile('xlsx'));
    toast('Excel downloaded','ok');
  }catch(e){ toast('Could not build the spreadsheet: '+((e&&e.message)||e),'err'); }
  finally{ if(btn){btn.disabled=false;btn.innerHTML=restore;} }
};
let _jspdfP=null;
function loadJsPdf(){
  if(window.jspdf&&window.jspdf.jsPDF&&window.jspdf.jsPDF.API.autoTable) return Promise.resolve(window.jspdf.jsPDF);
  if(_jspdfP) return _jspdfP;
  const add=src=>new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=rej;document.head.appendChild(s);});
  _jspdfP=add('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
    .then(()=>add('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'))
    .then(()=>window.jspdf.jsPDF).catch(e=>{_jspdfP=null;throw e;});
  return _jspdfP;
}
window.psrpPdf=async function(btn){
  if(!RP.rows) return;
  const restore=btn?btn.innerHTML:''; if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> PDF';}
  try{
    const jsPDF=await loadJsPdf();
    const mis=RP.theme==='mis', cols=RP.cols.filter(c=>!c.noExport);
    const doc=new jsPDF({orientation:'landscape',unit:'pt',format:'a4'});
    const W=doc.internal.pageSize.getWidth(), H=doc.internal.pageSize.getHeight(), M=30;
    const brand=[109,40,217];
    const header=()=>{
      if(mis){
        doc.setTextColor(0); doc.setFont('helvetica','bold');
        doc.setFontSize(13); doc.text(RP.title,W/2,M+8,{align:'center'});
        doc.setFontSize(11.5); doc.text(RP.sub,W/2,M+26,{align:'center'});
        doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(120); doc.text(repCompany()+' · generated '+repStamp(),W/2,M+40,{align:'center'});
        return;
      }
      doc.setFillColor(...brand); doc.rect(0,0,W,56,'F');
      doc.setTextColor(255); doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.text(repCompany(),M,24);
      doc.setFontSize(11); doc.text(RP.title,M,42);
      doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.text('Generated '+repStamp(),W-M,24,{align:'right'}); doc.text('JAIN-E Post Sales',W-M,42,{align:'right'});
      doc.setTextColor(71,85,105); doc.setFontSize(9); doc.text(RP.sub,M,72);
    };
    const tot=cols.map((c,i)=>i===0?(mis?'TOTAL':'Total ('+RP.rows.length+')'):(c.sum?cellText(c,{[c.k]:RP.rows.reduce((s,r)=>s+num(r[c.k]),0)}):''));
    const colStyles={}; cols.forEach((c,i)=>{ if(isNumCol(c)) colStyles[i]={halign:'right'}; else if(c.t==='d') colStyles[i]={halign:'center'}; });
    doc.autoTable({
      head:[cols.map(c=>c.h+(c.t==='inr'&&!mis?' (Rs)':''))],
      body:RP.rows.map(r=>cols.map(c=>cellText(c,r))),
      foot:cols.some(c=>c.sum)&&RP.rows.length?[tot]:undefined,
      startY:mis?M+52:84, margin:{left:M,right:M,top:mis?M+52:70,bottom:34},
      theme:mis?'grid':'striped',
      styles:{font:'helvetica',fontSize:cols.length>11?6.6:7.6,cellPadding:mis?5:3.6,overflow:'linebreak',valign:'top',lineColor:mis?[0,0,0]:[228,228,231],lineWidth:mis?0.6:0.3,textColor:[15,23,42],fontStyle:mis?'bold':'normal'},
      headStyles:mis?{fillColor:[255,255,0],textColor:0,fontStyle:'bold',halign:'center',valign:'middle',lineColor:[0,0,0],lineWidth:0.6}:{fillColor:brand,textColor:255,fontStyle:'bold',halign:'center',valign:'middle'},
      footStyles:mis?{fillColor:[241,245,249],textColor:0,fontStyle:'bold',lineColor:[0,0,0],lineWidth:0.6}:{fillColor:[237,233,254],textColor:[46,16,101],fontStyle:'bold'},
      alternateRowStyles:mis?{}:{fillColor:[248,245,255]},
      columnStyles:Object.assign({},colStyles,mis?{2:{halign:'right',fontStyle:'normal'},3:{halign:'right',fontStyle:'normal'},4:{halign:'right',fontStyle:'normal'}}:{}),
      didParseCell:d=>{ if(d.section==='foot'&&isNumCol(cols[d.column.index]||{})) d.cell.styles.halign='right'; },
      didDrawPage:()=>{ header(); const p=doc.internal.getNumberOfPages(); doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(148,163,184);
        doc.text(repCompany()+' · '+RP.title,M,H-16); doc.text('Page '+p+' of {total}',W-M,H-16,{align:'right'}); }
    });
    if(typeof doc.putTotalPages==='function') doc.putTotalPages('{total}');
    doc.save(repFile('pdf'));
    toast('PDF downloaded','ok');
  }catch(e){ toast('Could not build the PDF: '+((e&&e.message)||e),'err'); }
  finally{ if(btn){btn.disabled=false;btn.innerHTML=restore;} }
};

let RPT_SEQ=0;
window.psrpRender=async function(host,seg){
  host.classList.add('ps-root');
  css(); bcss();
  seg=seg||[];
  const mine=++RPT_SEQ, stale=()=>mine!==RPT_SEQ||!host.isConnected;
  loader(host);
  if(!S.projects.length) await loadProjects();
  if(stale()) return;
  const key=seg[0];
  if(!REPORTS.some(r=>r[0]===key)){
    host.innerHTML='<div class="pss-cards">'+REPORTS.map(r=>'<div class="pss-card" onclick="navTo(\'postsales/reports/'+r[0]+'\')"><h4><i class="fa-solid '+r[2]+'" style="color:#7e22ce;margin-right:6px"></i>'+esc(r[1])+'</h4><div class="m">'+esc(r[3])+'</div></div>').join('')+'</div>';
    return;
  }
  RP.from=RP.from||fyStart(); RP.to=RP.to||today(); RP.asOf=RP.asOf||today();
  if(!RP.pid) RP.pid=S.pid||((S.projects.find(p=>p.id===1)||S.projects[0]||{}).id);
  if(S.pid!==RP.pid){ await loadProject(RP.pid); S.pid=RP.pid; }
  if(stale()) return;
  RP.booking=key==='ledger'?(parseInt(seg[1],10)||null):null;
  RP.theme=key==='mis'?'mis':'';
  const R_=REPORTS.find(r=>r[0]===key);
  const fl=(lbl,inner)=>'<label class="fl">'+lbl+inner+'</label>';
  const asOf=fl('As on','<input type="date" value="'+esc(RP.asOf)+'" onchange="RP_set(\'asOf\',this.value)">');
  const range=fl('From','<input type="date" value="'+esc(RP.from)+'" onchange="RP_set(\'from\',this.value)">')+fl('To','<input type="date" value="'+esc(RP.to)+'" onchange="RP_set(\'to\',this.value)">');
  const filters=key==='mis'?asOf
    :fl('Project',projSelect('psrpP',RP.pid,'RP_set(\'pid\',this.value?Number(this.value):null)',''))
     +fl('Tower','<select onchange="RP_set(\'tower\',this.value)"><option value="">All towers</option>'+S.towers.map(t=>'<option value="'+t.id+'"'+(String(t.id)===String(RP.tower)?' selected':'')+'>'+esc(t.name)+'</option>').join('')+'</select>')
     +(key==='outstanding'?asOf:(key==='collection'||key==='demand'||key==='register'||key==='cancellation')?range:'')
     +(key!=='availability'&&key!=='demand'?fl('Search','<span class="mu-sw"><i class="fa-solid fa-magnifying-glass"></i><input id="psrpQ" value="'+esc(RP.q)+'" placeholder="Booking, flat or customer" oninput="RP_q(this.value)"></span>'):'');
  host.innerHTML='<div style="margin-bottom:8px"><a href="javascript:void 0" onclick="navTo(\'postsales/reports\')" style="font-size:13px"><i class="fa-solid fa-arrow-left"></i> All reports</a></div>'
    +'<div class="ps-head"><div class="t"><div class="sec-title"><i class="fa-solid '+R_[2]+'" style="color:#7e22ce"></i> '+esc(R_[1])+'</div><div class="pss-hint" style="margin:2px 0 0">'+esc(R_[3])+'</div></div>'
    +'<div class="acts"><button class="btn" onclick="psrpExcel(this)"><i class="fa-solid fa-file-excel" style="color:#15803d"></i> Excel</button><button class="btn" onclick="psrpPdf(this)"><i class="fa-solid fa-file-pdf" style="color:#dc2626"></i> PDF</button></div></div>'
    +'<div class="ps-filters">'+filters+'</div>'
    +'<div id="psrpBody"><div class="loader"><div class="spin"></div></div></div>';
  const body=$('psrpBody');
  const fn={ledger:repLedger,availability:repAvailability,outstanding:repOutstanding,collection:repCollection,demand:repDemand,cancellation:repCancellation,register:repRegister,mis:repMis}[key];
  await fn(body,stale);
};
window.RP_set=function(k,v){ RP[k]=v; if(k==='pid'){ RP.tower=''; RP.booking=null; } const key=location.hash.split('/')[2]; navTo('postsales/reports/'+key); };
let RPQ_T=null;
window.RP_q=function(v){ RP.q=v; clearTimeout(RPQ_T); RPQ_T=setTimeout(()=>{ if(RP._redraw) RP._redraw(); },200); };
const pName=id=>{const p=S.projects.find(x=>x.id===id);return p?p.name:'';};
const tName=id=>{const t=S.towers.find(x=>x.id===id);return t?t.name:'';};
const subLine=extra=>pName(RP.pid)+(RP.tower?' · '+tName(Number(RP.tower)):'')+(extra?' · '+extra:'');
const matchQ=(b)=>!RP.q||[b.booking_no,flatLbl(b),apName(b)].join(' ').toLowerCase().includes(RP.q.toLowerCase());

/* 1. Applicant ledger */
async function repLedger(host,stale){
  const pid=RP.pid;
  const [bks,invs,rcs,pos]=await Promise.all([
    allRows(()=>PS().from('bookings').select(BK_SEL).eq('project_id',pid).order('booking_no')),
    allRows(()=>PS().from('invoices').select('id,booking_id,invoice_no,invoice_date,due_date,title,total,status,cancelled_at,cancel_reason,kind').eq('project_id',pid)),
    allRows(()=>PS().from('receipts').select('id,booking_id,receipt_no,receipt_date,mode,instrument_no,amount,status,reversal_no,reversal_date,reversal_reason,against_interest').eq('project_id',pid)),
    allRows(()=>PS().from('payouts').select('*').eq('project_id',pid))]);
  if(stale()) return;
  const al=await (async()=>{const ids=invs.map(i=>i.id);let out=[];for(let k=0;k<ids.length;k+=300){const {data}=await PS().from('receipt_allocations').select('invoice_id,amount').in('invoice_id',ids.slice(k,k+300));out=out.concat(data||[]);}return out;})();
  if(stale()) return;
  const paidBy={}; al.forEach(a=>paidBy[a.invoice_id]=(paidBy[a.invoice_id]||0)+num(a.amount));
  const entries=bid=>{
    const e=[];
    invs.filter(i=>i.booking_id===bid).forEach(i=>{
      e.push({d:i.invoice_date,o:1,doc:i.invoice_no,part:i.title+(i.kind!=='milestone'?' ('+KIND_LBL[i.kind]+')':''),dr:num(i.total),cr:0,link:'postsales/invoices/'+i.id});
      if(i.status==='cancelled') e.push({d:(i.cancelled_at||'').slice(0,10)||i.invoice_date,o:2,doc:i.invoice_no,part:'Cancelled - '+(i.cancel_reason||''),dr:0,cr:num(i.total),link:'postsales/invoices/'+i.id});
    });
    rcs.filter(r=>r.booking_id===bid).forEach(r=>{
      e.push({d:r.receipt_date,o:3,doc:r.receipt_no,part:'Received - '+(MODE_LBL[r.mode]||r.mode)+(r.instrument_no?' '+r.instrument_no:'')+(r.against_interest?' (against interest)':''),dr:0,cr:num(r.amount),link:'postsales/receipts/'+r.id});
      if(r.status==='reversed') e.push({d:r.reversal_date,o:4,doc:r.reversal_no||'',part:'Receipt reversed - '+(r.reversal_reason||''),dr:num(r.amount),cr:0,link:'postsales/receipts/'+r.id});
    });
    pos.filter(p=>p.booking_id===bid).forEach(p=>e.push({d:p.payout_date,o:5,doc:p.payout_no,part:p.kind==='refund'?'Refund paid'+(p.instrument_no?' - '+p.instrument_no:''):'Transferred to another flat',dr:num(p.amount),cr:0}));
    e.sort((a,b)=>String(a.d).localeCompare(String(b.d))||a.o-b.o);
    let bal=0; e.forEach(x=>{bal=r2(bal+x.dr-x.cr);x.bal=bal;});
    return e;
  };
  RP._redraw=function(){
    const tw=RP.tower?Number(RP.tower):null;
    if(RP.booking){
      const b=bks.find(x=>x.id===RP.booking); if(!b){ host.innerHTML='<div class="empty"><div>Booking not found</div></div>'; return; }
      const e=entries(b.id), td=today();
      const open=invs.filter(i=>i.booking_id===b.id&&i.status==='open').map(i=>({...i,bal:num(i.total)-(paidBy[i.id]||0)})).filter(i=>i.bal>0.5);
      const nd=open.filter(i=>i.due_date>=td).reduce((s,i)=>s+i.bal,0), od=open.filter(i=>i.due_date<td).reduce((s,i)=>s+i.bal,0);
      const closing=e.length?e[e.length-1].bal:0;
      const cols=[{h:'Date',k:'d',t:'d'},{h:'Document',k:'doc'},{h:'Particulars',k:'part'},{h:'Debit',k:'dr',t:'inr',sum:1},{h:'Credit',k:'cr',t:'inr',sum:1},{h:'Balance',k:'bal',t:'inr',text:r=>Math.round(num(r.bal)).toLocaleString('en-IN')+(num(r.bal)<0?' Cr':' Dr'),html:r=>inr(Math.abs(r.bal))+(num(r.bal)<0?' <span class="tag t-green">Cr</span>':'')}];
      repSet('Applicant Ledger - '+b.booking_no,pName(b.project_id)+' · '+flatLbl(b)+' · '+apName(b)+' · booked '+dmy(b.booking_date),cols,e.map(x=>({...x,_link:x.link})));
      host.innerHTML='<div class="toolbar"><button class="btn btn-sm btn-ghost" onclick="navTo(\'postsales/reports/ledger\')"><i class="fa-solid fa-arrow-left"></i> All customers</button><div style="flex:1"><b>'+esc(b.booking_no)+'</b> · '+esc(flatLbl(b))+' · '+esc(apName(b))+' <span class="pss-hint">booked '+dmy(b.booking_date)+' · '+esc(b.status)+'</span></div><button class="btn btn-sm" onclick="navTo(\'postsales/bookings/'+b.id+'\')">Open booking</button></div>'
        +mKpis([['Consideration (incl. GST)',inr(b.grand_total),''],['Closing balance',inr(Math.abs(closing)),closing<0?'in credit (advance / refund due)':'receivable'],['Not yet due',inr(nd),'on raised invoices'],['Overdue',inr(od),'',od>0?'#b91c1c':undefined]])
        +'<div style="margin-top:14px">'+repTable(cols,RP.rows,{empty:'No entries yet'})+'</div>';
      return;
    }
    const rows=bks.filter(b=>(!tw||b.tower_id===tw)&&matchQ(b)).map(b=>{const e=entries(b.id);const dr=e.reduce((s,x)=>s+x.dr,0),cr=e.reduce((s,x)=>s+x.cr,0);
      const od=invs.filter(i=>i.booking_id===b.id&&i.status==='open'&&i.due_date<today()).reduce((s,i)=>s+Math.max(0,num(i.total)-(paidBy[i.id]||0)),0);
      return {booking_no:b.booking_no,flat:flatLbl(b),app:apName(b),status:b.status,bdate:b.booking_date,dr,cr,bal:r2(dr-cr),od,entries:e.length,_link:'postsales/reports/ledger/'+b.id};});
    const cols=[{h:'Booking',k:'booking_no'},{h:'Flat',k:'flat'},{h:'Applicant',k:'app'},{h:'Booked',k:'bdate',t:'d'},{h:'Status',k:'status'},{h:'Entries',k:'entries',t:'n'},{h:'Debits',k:'dr',t:'inr',sum:1},{h:'Credits',k:'cr',t:'inr',sum:1},{h:'Balance',k:'bal',t:'inr',sum:1},{h:'Overdue',k:'od',t:'inr',sum:1}];
    repSet('Applicant Ledger - all customers',subLine(),cols,rows);
    host.innerHTML='<div class="pss-hint">Click a customer to open their full ledger. Excel exports this summary; open a customer to export their entries.</div>'+repTable(cols,rows,{empty:'No bookings in this project yet'});
  };
  RP._redraw();
}

/* 2. Flat availability */
async function repAvailability(host,stale){
  const g=S.setup||{};
  const price=f=>{const t=S.towers.find(x=>x.id===f.tower_id),fl=S.floors.find(x=>x.id===f.floor_id),sba=num(f.sba_sqft);if(!t||t.base_rate==null||!sba) return null;
    const unit=num(t.base_rate)*sba,plc=(f.position_id?plcRateFor(f.position_id):0)*sba,frc=(fl?frcFor(t,fl.floor_no):0)*sba;
    let net=unit+plc+frc,gst=unit*num(g.unit_gst_rate)/100+plc*num(g.plc_gst_rate)/100+frc*num(g.frc_gst_rate)/100;
    S.charges.filter(c=>c.charge_group==='edc').forEach(c=>{const a=c.basis==='per_sqft'?num(c.rate)*sba:c.basis==='fixed'?num(c.rate):unit*num(c.rate)/100;net+=a;gst+=a*num(c.gst_rate)/100;});
    return {net:Math.round(net),gross:Math.round(net+gst)};};
  RP._redraw=function(){
    const tw=RP.tower?Number(RP.tower):null, towers=S.towers.filter(t=>!tw||t.id===tw);
    const flats=S.flats.filter(f=>towers.some(t=>t.id===f.tower_id));
    const rows=flats.map(f=>{const fl=S.floors.find(x=>x.id===f.floor_id),p=f.status==='available'?price(f):null,pos=S.positions.find(x=>x.id===f.position_id);
      return {tower:tName(f.tower_id),floor:fl?fl.floor_no:null,floorL:fl?(fl.label||ordinal(fl.floor_no)):'',flat:f.flat_code,bhk:f.bhk||'',sba:num(f.sba_sqft),plc:(pos?plcIdsFor(pos.id).map(i=>(S.plcs.find(x=>x.id===i)||{}).name).filter(Boolean).join(', '):''),status:STATUS_LBL[f.status],net:p?p.net:null,gross:p?p.gross:null};})
      .sort((a,b)=>a.tower.localeCompare(b.tower)||a.floor-b.floor||a.flat.localeCompare(b.flat));
    const cols=[{h:'Tower',k:'tower'},{h:'Floor',k:'floorL'},{h:'Flat',k:'flat'},{h:'BHK',k:'bhk'},{h:'SBA (sq ft)',k:'sba',t:'n',sum:1},{h:'PLC',k:'plc'},{h:'Status',k:'status'},{h:'Price excl. GST (list rate)',k:'net',t:'inr'},{h:'Price incl. GST',k:'gross',t:'inr'}];
    repSet('Flat Availability',subLine('as on '+dmy(today())),cols,rows);
    const summary={}; flats.forEach(f=>{const k=tName(f.tower_id)+'|'+(f.bhk||'—');summary[k]=summary[k]||{tower:tName(f.tower_id),bhk:f.bhk||'—',total:0,available:0,booked:0,other:0,availSba:0};const s=summary[k];s.total++;if(f.status==='available'){s.available++;s.availSba+=num(f.sba_sqft);}else if(f.status==='booked')s.booked++;else s.other++;});
    const scols=[{h:'Tower',k:'tower'},{h:'BHK',k:'bhk'},{h:'Flats',k:'total',t:'n',sum:1},{h:'Available',k:'available',t:'n',sum:1},{h:'Booked',k:'booked',t:'n',sum:1},{h:'Registered / possession / blocked',k:'other',t:'n',sum:1},{h:'Available area (sq ft)',k:'availSba',t:'n',sum:1}];
    host.innerHTML='<div class="pss-subs"><span class="chip'+(RP.view==='grid'?' active':'')+'" onclick="RP.view=\'grid\';RP._redraw()">Grid</span><span class="chip'+(RP.view==='list'?' active':'')+'" onclick="RP.view=\'list\';RP._redraw()">List with price</span><span class="chip'+(RP.view==='summary'?' active':'')+'" onclick="RP.view=\'summary\';RP._redraw()">Summary</span></div>'
      +(RP.view==='summary'?repTable(scols,Object.values(summary)):RP.view==='list'?repTable(cols,rows):'<div class="pss-legend">'+Object.keys(STATUS_LBL).map(k=>'<span class="pss-flat '+k+'">'+STATUS_LBL[k]+' ('+flats.filter(f=>f.status===k).length+')</span>').join('')+'</div>'+towers.map(t=>'<div class="sec-title" style="margin:14px 0 6px">'+esc(t.name)+'</div>'+flatGrid(t).replace(/onclick="pssFlatModal\(\d+\)"/g,'').replace(/<div style="margin-top:10px"><button[^]*?<\/button><\/div>/,'')).join(''));
    if(RP.view==='summary') repSet('Flat Availability - summary',subLine('as on '+dmy(today())),scols,Object.values(summary));
  };
  RP._redraw();
}

/* 3. Customer outstanding with interest */
async function repOutstanding(host,stale){
  const [{data,error},bks]=await Promise.all([PS().rpc('report_outstanding',{p_project_id:RP.pid,p_as_of:RP.asOf}),allRows(()=>PS().from('bookings').select(BK_SEL).eq('project_id',RP.pid))]);
  if(stale()) return;
  if(error){ host.innerHTML='<div class="empty"><div>'+esc(error.message)+'</div></div>'; return; }
  const by={}; bks.forEach(b=>by[b.id]=b);
  RP._redraw=function(){
    const tw=RP.tower?Number(RP.tower):null;
    const rows=(data||[]).map(r=>({...r,b:by[r.booking_id]})).filter(r=>r.b&&(!tw||r.b.tower_id===tw)&&matchQ(r.b)&&(num(r.invoiced)||num(r.received)))
      .map(r=>({booking_no:r.b.booking_no,flat:flatLbl(r.b),app:apName(r.b),status:r.b.status,invoiced:r.invoiced,received:r.received,outstanding:r.outstanding,overdue:r.overdue,days:r.days_overdue||null,accrued:r.interest_accrued,billed:r.interest_billed,waived:r.interest_waived,irecv:r.interest_received,total:r.total_due,_link:'postsales/bookings/'+r.booking_id}))
      .sort((a,b)=>num(b.total)-num(a.total));
    const cols=[{h:'Booking',k:'booking_no'},{h:'Flat',k:'flat'},{h:'Customer',k:'app'},{h:'Total invoiced',k:'invoiced',t:'inr',sum:1},{h:'Received',k:'received',t:'inr',sum:1},{h:'Outstanding',k:'outstanding',t:'inr',sum:1},{h:'Of which overdue',k:'overdue',t:'inr',sum:1},{h:'Days overdue',k:'days',t:'n'},{h:'Interest built up @18%',k:'accrued',t:'inr',sum:1},{h:'Interest billed',k:'billed',t:'inr',sum:1},{h:'Interest waived',k:'waived',t:'inr',sum:1},{h:'Interest received',k:'irecv',t:'inr',sum:1},{h:'Total due',k:'total',t:'inr',sum:1}];
    repSet('Customer Outstanding with Interest',subLine('as on '+dmy(RP.asOf)),cols,rows);
    host.innerHTML='<div class="pss-hint">Only invoices raised and payments received by the as-on date count. Interest is worked out to that date on every demand paid late or still unpaid; total due = outstanding + interest built up (less waived) − interest already received.</div>'+repTable(cols,rows,{empty:'No invoices or payments for this project yet'});
  };
  RP._redraw();
}

/* 4. Collection report */
async function repCollection(host,stale){
  const rcs=await allRows(()=>PS().from('receipts').select('id,receipt_no,receipt_date,mode,instrument_no,amount,status,against_interest,bank_accounts(name),bookings(id,tower_id,booking_no,flats(flat_code),towers(name),booking_applicants(full_name,seq))').eq('project_id',RP.pid).gte('receipt_date',RP.from).lte('receipt_date',RP.to).order('receipt_date'));
  if(stale()) return;
  RP._redraw=function(){
    const tw=RP.tower?Number(RP.tower):null;
    const rows=rcs.filter(r=>r.bookings&&(!tw||r.bookings.tower_id===tw)&&matchQ(r.bookings)).map(r=>({date:r.receipt_date,no:r.receipt_no,booking:r.bookings.booking_no,flat:flatLbl(r.bookings),app:apName(r.bookings),mode:MODE_LBL[r.mode]||r.mode,ref:r.instrument_no||'',bank:r.bank_accounts&&r.bank_accounts.name||'',type:r.against_interest?'Interest':'Principal',amount:r.status==='active'?num(r.amount):0,status:r.status==='active'?'Received':'Reversed',_link:'postsales/receipts/'+r.id,_style:r.status!=='active'?'opacity:.55':''}));
    const cols=[{h:'Date',k:'date',t:'d'},{h:'Receipt',k:'no'},{h:'Booking',k:'booking'},{h:'Flat',k:'flat'},{h:'Received from',k:'app'},{h:'Mode',k:'mode'},{h:'Ref.',k:'ref'},{h:'Deposited in',k:'bank'},{h:'Towards',k:'type'},{h:'Amount',k:'amount',t:'inr',sum:1},{h:'Status',k:'status'}];
    repSet('Collection Report',subLine(dmy(RP.from)+' to '+dmy(RP.to)+' · reversed receipts shown at nil'),cols,rows);
    const grp=k=>{const m={};rows.filter(r=>r.status==='Received').forEach(r=>{m[r[k]||'—']=(m[r[k]||'—']||0)+r.amount;});return Object.entries(m).sort((a,b)=>b[1]-a[1]);};
    const mini=(t,arr)=>'<div class="psb-sec" style="flex:1;min-width:260px"><h3>'+t+'</h3><table class="psb-tbl"><tbody>'+arr.map(x=>'<tr><td>'+esc(x[0])+'</td><td class="r">'+inr(x[1])+'</td></tr>').join('')+'</tbody></table></div>';
    host.innerHTML=repTable(cols,rows,{empty:'No receipts in this period'})+(rows.length?'<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:14px">'+mini('By mode',grp('mode'))+mini('By bank account',grp('bank'))+'</div>':'');
  };
  RP._redraw();
}

/* 5. Demand vs collection */
async function repDemand(host,stale){
  const {data,error}=await PS().rpc('report_demand_collection',{p_project_id:RP.pid,p_from:RP.from,p_to:RP.to});
  if(stale()) return;
  if(error){ host.innerHTML='<div class="empty"><div>'+esc(error.message)+'</div></div>'; return; }
  RP._redraw=function(){
    const tw=RP.tower?Number(RP.tower):null;
    const rows=(data||[]).filter(r=>!tw||r.tower_id===tw).map(r=>({tower:tName(r.tower_id),milestone:r.milestone,invoices:r.invoices,demanded:r.demanded,collected:r.collected,balance:r.balance,pct:num(r.demanded)?100*num(r.collected)/num(r.demanded):null}));
    const cols=[{h:'Tower',k:'tower'},{h:'Milestone',k:'milestone'},{h:'Invoices',k:'invoices',t:'n',sum:1},{h:'Demanded',k:'demanded',t:'inr',sum:1},{h:'Collected',k:'collected',t:'inr',sum:1},{h:'Balance',k:'balance',t:'inr',sum:1},{h:'% collected',k:'pct',t:'pct'}];
    repSet('Demand vs Collection',subLine('invoices dated '+dmy(RP.from)+' to '+dmy(RP.to)),cols,rows);
    const d=rows.reduce((s,r)=>s+num(r.demanded),0),c=rows.reduce((s,r)=>s+num(r.collected),0);
    host.innerHTML=mKpis([['Demanded',inr(d),''],['Collected',inr(c),''],['Balance',inr(d-c),''],['% collected',d?(100*c/d).toFixed(1)+'%':'—','']])+'<div style="margin-top:14px">'+repTable(cols,rows,{empty:'No invoices in this period'})+'</div>';
  };
  RP._redraw();
}

/* 6. Cancellation / refund register */
async function repCancellation(host,stale){
  const bks=(await allRows(()=>PS().from('bookings').select(BK_SEL).eq('project_id',RP.pid).in('status',['cancelled','transferred']))).filter(b=>!b.cancelled_on||(b.cancelled_on>=RP.from&&b.cancelled_on<=RP.to));
  const ids=bks.map(b=>b.id);
  let bal=[],pos=[];
  if(ids.length){ [bal,pos]=await Promise.all([PS().from('booking_balances').select('*').in('booking_id',ids).then(r=>r.data||[]),PS().from('payouts').select('*').in('booking_id',ids).then(r=>r.data||[])]); }
  if(stale()) return;
  RP._redraw=function(){
    const tw=RP.tower?Number(RP.tower):null;
    const rows=bks.filter(b=>(!tw||b.tower_id===tw)&&matchQ(b)).map(b=>{const bl=bal.find(x=>x.booking_id===b.id)||{},p=pos.filter(x=>x.booking_id===b.id);
      const refunded=p.filter(x=>x.kind==='refund').reduce((s,x)=>s+num(x.amount),0),moved=p.filter(x=>x.kind==='transfer').reduce((s,x)=>s+num(x.amount),0);
      return {booking_no:b.booking_no,flat:flatLbl(b),app:apName(b),type:b.status==='cancelled'?'Cancelled':'Transferred',booked:b.booking_date,closed:b.cancelled_on,reason:b.cancel_reason||'',calc:b.status==='cancelled'?b.cancel_charge_calc:null,charge:b.status==='cancelled'?b.cancel_charge:null,waiver:b.cancel_waiver_reason||'',received:num(bl.principal_received)+num(bl.interest_received),refunded,moved,refundDue:Math.max(0,num(bl.advance)),recoverable:Math.max(0,num(bl.principal_outstanding)+num(bl.interest_outstanding)),_link:'postsales/bookings/'+b.id};});
    const cols=[{h:'Booking',k:'booking_no'},{h:'Flat',k:'flat'},{h:'Customer',k:'app'},{h:'Type',k:'type'},{h:'Booked',k:'booked',t:'d'},{h:'Closed',k:'closed',t:'d'},{h:'Reason',k:'reason'},{h:'Charge (calc.)',k:'calc',t:'inr',sum:1},{h:'Charge (final)',k:'charge',t:'inr',sum:1},{h:'Waiver reason',k:'waiver'},{h:'Received',k:'received',t:'inr',sum:1},{h:'Refunded',k:'refunded',t:'inr',sum:1},{h:'Moved to new flat',k:'moved',t:'inr',sum:1},{h:'Refund pending',k:'refundDue',t:'inr',sum:1},{h:'Recoverable',k:'recoverable',t:'inr',sum:1}];
    repSet('Cancellation / Refund Register',subLine(dmy(RP.from)+' to '+dmy(RP.to)),cols,rows);
    host.innerHTML=repTable(cols,rows,{empty:'No cancellations or transfers in this period'});
  };
  RP._redraw();
}

/* 7. Sales / booking register */
async function repRegister(host,stale){
  const bks=await allRows(()=>PS().from('bookings').select(BK_SEL).eq('project_id',RP.pid).gte('booking_date',RP.from).lte('booking_date',RP.to).order('booking_date'));
  if(stale()) return;
  RP._redraw=function(){
    const tw=RP.tower?Number(RP.tower):null;
    const rows=bks.filter(b=>(!tw||b.tower_id===tw)&&matchQ(b)).map(b=>({date:b.booking_date,no:b.booking_no,flat:flatLbl(b),bhk:b.flats&&b.flats.bhk||'',app:apName(b),sba:num(b.sba_sqft),rate:b.rate,disc:b.discount_type==='none'?'':b.discount_type==='per_sqft'?'₹'+num(b.discount_value)+'/sq ft':inr(b.discount_value),cons:b.total_consideration,gross:b.grand_total,plan:(b.plan_name||'')+(b.is_non_standard?' (non-standard)':''),sp:b.sales_person||'',src:b.source||'',lead:b.crm_lead_id||'',status:b.status,_link:'postsales/bookings/'+b.id}));
    const cols=[{h:'Date',k:'date',t:'d'},{h:'Booking',k:'no'},{h:'Flat',k:'flat'},{h:'BHK',k:'bhk'},{h:'Applicants',k:'app'},{h:'SBA',k:'sba',t:'n',sum:1},{h:'Rate',k:'rate',t:'inr'},{h:'Discount',k:'disc'},{h:'Consideration',k:'cons',t:'inr',sum:1},{h:'Incl. GST',k:'gross',t:'inr',sum:1},{h:'Plan',k:'plan'},{h:'Sales person',k:'sp'},{h:'Source',k:'src'},{h:'CRM Lead',k:'lead'},{h:'Status',k:'status'}];
    repSet('Sales / Booking Register',subLine(dmy(RP.from)+' to '+dmy(RP.to)),cols,rows);
    const act=rows.filter(r=>r.status==='active');
    host.innerHTML=mKpis([['Bookings',String(rows.length),act.length+' active'],['Area booked',act.reduce((s,r)=>s+r.sba,0).toLocaleString('en-IN')+' sq ft','active'],['Consideration',inr(act.reduce((s,r)=>s+num(r.cons),0)),'active, excl. GST'],['Average rate',act.length?inr(act.reduce((s,r)=>s+num(r.rate)*r.sba,0)/Math.max(1,act.reduce((s,r)=>s+r.sba,0)))+'/sq ft':'—','weighted by area']])+'<div style="margin-top:14px">'+repTable(cols,rows,{empty:'No bookings in this period'})+'</div>';
  };
  RP._redraw();
}
/* 0. MIS Report - "Project Wise Outstanding Status VS Collection Status As Per ERP", the weekly sheet
   the MIS tab used to build by hand from Farvision files, now straight from Post Sales data with the
   same three rules and the same fixed row order (so one week reads against the last):
     Outstanding till date : active bookings whose net outstanding (invoiced - received, as on the
                             date) is above zero - an advance on one booking never nets off another.
     Current month         : receipts dated from the 1st of the as-on month to the as-on date,
     Previous month        : receipts dated in the month before -
                             both counting only active bookings and receipts not reversed; a flat
                             transfer moves money between bookings and is not a collection. */
const MIS_ORDER=[['DREAM GURUKUL','DREAM GURUKUL(DOLTALA MADHYAMGRAM)'],['DREAM WORLD CITY','DREAM JAIN-PAILAN'],['DREAM WORLD CITY','DREAM GATEWAY PAILAN PROJECTS'],['DREAM ONE','DREAM ONE BLK 3 \\ 4'],['DREAM VALLEY','DREAM VALLEY'],['DREAM ECOCITY','DREAM ECOCITY'],['DREAM ONE','DREAM ONE BLK 1 \\ 2'],['DREAM RESIDENCY MANOR','DREAM RESIDENCY MANOR'],['DREAM EXOTICA','DREAM EXOTICA'],['DREAM ECOCITY','DREAM ECOCITY BUNGALOW'],['DREAM ANANTA','DREAM ANANTA'],['DREAM DIAMOND','DREAM DIAMOND.']];
const misKey=s=>String(s||'').toUpperCase().replace(/[\\\/]/g,' ').replace(/[^A-Z0-9 ]/g,'').replace(/\s+/g,' ').trim();
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
async function repMis(host,stale){
  const d=new Date(RP.asOf+'T00:00:00'), y=d.getFullYear(), m=d.getMonth();
  const iso=x=>x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
  const curFrom=iso(new Date(y,m,1)), prevFrom=iso(new Date(y,m-1,1)), prevTo=iso(new Date(y,m,0));
  const lbl=(yy,mm)=>MON[mm]+"'"+String(yy).slice(2), curL=lbl(y,m), pd=new Date(y,m-1,1), prevL=lbl(pd.getFullYear(),pd.getMonth());
  const dd=String(d.getDate()).padStart(2,'0')+'.'+String(m+1).padStart(2,'0')+'.'+y;
  const [{data:out,error},bks,rcs]=await Promise.all([
    PS().rpc('report_outstanding',{p_project_id:null,p_as_of:RP.asOf}),
    allRows(()=>PS().from('bookings').select('id,project_id,status')),
    allRows(()=>PS().from('receipts').select('project_id,receipt_date,amount,mode,bookings!inner(status)').eq('status','active').neq('mode','transfer').eq('bookings.status','active').gte('receipt_date',prevFrom).lte('receipt_date',RP.asOf))]);
  if(stale()) return;
  if(error){ host.innerHTML='<div class="empty"><div>'+esc(error.message)+'</div></div>'; return; }
  const bk={}; bks.forEach(b=>bk[b.id]=b);
  const acc={}; S.projects.forEach(p=>acc[p.id]={o:0,c:0,p:0,n:0});
  (out||[]).forEach(r=>{const b=bk[r.booking_id]; if(!b||b.status!=='active'||!acc[b.project_id]) return; const net=num(r.invoiced)-num(r.received); if(net>0.5){acc[b.project_id].o+=net;acc[b.project_id].n++;}});
  rcs.forEach(r=>{const a=acc[r.project_id]; if(!a) return; if(r.receipt_date>=curFrom) a.c+=num(r.amount); else if(r.receipt_date<=prevTo) a.p+=num(r.amount);});
  const byKey={}; S.projects.forEach(p=>byKey[misKey(p.name)]=p);
  const seen=new Set();
  const rows=MIS_ORDER.map(o=>{const p=byKey[misKey(o[1])]; if(p) seen.add(p.id); const a=p?acc[p.id]:null; return {project:o[0],bu:o[1],o:a?Math.round(a.o):null,c:a?Math.round(a.c):null,p:a?Math.round(a.p):null,n:a?a.n:0};})
    .concat(S.projects.filter(p=>!seen.has(p.id)).map(p=>{const a=acc[p.id];return {project:p.name,bu:p.name,o:Math.round(a.o),c:Math.round(a.c),p:Math.round(a.p),n:a.n};}));
  const cols=[{h:'Project Name',k:'project'},{h:'Business Unit Name',k:'bu'},{h:'Current Outstanding Amount Till Date '+dd,k:'o',t:'inr',sum:1},{h:'Current Month Collection Amount Upto - '+curL,k:'c',t:'inr',sum:1},{h:'Previous Month Collection Amount Upto - '+prevL,k:'p',t:'inr',sum:1}];
  repSet('Project Wise Outstanding Status VS Collection Status As Per ERP','Weekly Basis MIS Report - Date: '+dd,cols,rows);
  const T=k=>rows.reduce((s,r)=>s+num(r[k]),0);
  const dash=v=>num(v)?indN(v):'<span style="color:#94a3b8">—</span>';
  host.innerHTML=mKpis([['Outstanding till '+dd,'₹'+indN(T('o')),rows.reduce((s,r)=>s+r.n,0)+' customers with dues'],['Collection '+curL,'₹'+indN(T('c')),'1st to '+dd],['Collection '+prevL,'₹'+indN(T('p')),'whole month']])
    +'<div class="card" style="padding:0;margin-top:14px"><div style="overflow-x:auto"><table class="tbl"><thead><tr style="background:#fef9c3">'+cols.map((c,i)=>'<th style="background:#fef08a;color:#111;white-space:normal;min-width:'+(i<2?140:150)+'px'+(i>1?';text-align:right':'')+'">'+esc(c.h)+'</th>').join('')+'</tr></thead><tbody>'
    +rows.map(r=>'<tr><td><b>'+esc(r.project)+'</b></td><td>'+esc(r.bu)+'</td><td class="pss-num">'+dash(r.o)+'</td><td class="pss-num">'+dash(r.c)+'</td><td class="pss-num">'+dash(r.p)+'</td></tr>').join('')
    +'</tbody><tfoot><tr><td style="font-weight:700">TOTAL</td><td></td><td class="pss-num" style="font-weight:700">'+indN(T('o'))+'</td><td class="pss-num" style="font-weight:700">'+indN(T('c'))+'</td><td class="pss-num" style="font-weight:700">'+indN(T('p'))+'</td></tr></tfoot></table></div></div>'
    +'<div class="pss-hint" style="margin-top:10px">Outstanding: active customers with net outstanding above zero as on '+dd+'. Collection: receipts on active units, not reversed, dated '+dmy(curFrom)+' to '+dmy(RP.asOf)+' (current) and '+dmy(prevFrom)+' to '+dmy(prevTo)+' (previous). Flat transfers are not counted as collection.</div>';
  RP._redraw=null;
}
window.RP=RP;

window.psiRaiseOne=async function(bmId,name){
  if(!await confirmDialog('Raise the invoice for "'+name+'" dated today (due in 30 days)?',{danger:false,okLabel:'Raise invoice',title:'Raise invoice'})) return;
  const {data,error}=await PS().rpc('raise_invoice',{p_bm_id:bmId,p_date:today()});
  if(fail(error,'Could not raise the invoice')) return;
  toast('Invoice raised','ok'); route();
};

})();
