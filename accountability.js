/* ===========================================================================
   JAIN-E · ACCOUNTABILITY — Tasks (delegation workflow)  [loads after nexus-core.js]
   =========================================================================== */
(function(){
  if (typeof sb === 'undefined' || typeof VIEWS === 'undefined') return;
  const ACC = () => sb.schema('acc');
  const me  = () => ((state && state.email) || '').toLowerCase();
  const myDepts = () => (state && state.profile && Array.isArray(state.profile.department)) ? state.profile.department : [];
  function tagVisible(p){ // task tags (Assigned/Delegated AND Self): departmental only, no private tags
    const dep=p&&p.department;
    if(dep&&dep.length){ const md=myDepts(); return dep.some(d=>md.includes(d)); }
    const owner=(p&&(p.created_by||p.owner))||'';
    return !owner; // no department + no owner = legacy global tag
  }
  const eq  = (a,b)=> String(a||'').toLowerCase()===String(b||'').toLowerCase();
  const esc2 = s => (typeof esc==='function'?esc(s==null?'':s):String(s==null?'':s));
  const mdBold = s => esc2(s).replace(/\*\*([^\n*]+?)\*\*/g,'<b>$1</b>');
  function parseD(d){ if(!d)return null; if(typeof d==='string'){ const m=d.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m)return new Date(+m[1],+m[2]-1,+m[3]); } const x=new Date(d); return isNaN(x)?null:x; }
  const fmtDate = d => { const x=parseD(d); return x?x.toLocaleDateString('en-IN',{day:'numeric',month:'short'}):''; };
  const fmtDateY = d => { const x=parseD(d); return x?x.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'—'; };
  const nowISO = () => new Date().toISOString();
  const todayStr = () => new Date().toDateString();
  const todayISO = () => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  // Kolkata (IST, UTC+5:30 fixed, no DST) wall-clock "now" — computed from the epoch timestamp
  // (Date.now(), which is timezone-independent) plus a fixed offset, read back via the UTC getters.
  // This is deliberately NOT `new Date()`/todayISO() above: those reflect whatever timezone the
  // browser's OS happens to be set to, which every Meeting-related backend piece (acc.meetings
  // cron functions, google-meet-live-completion) does NOT assume — they all compute against
  // Asia/Kolkata specifically. If a device's clock/timezone is off, todayISO()-based checks can
  // silently disagree with the backend ("the time sometimes is weird") — istNow()/istTodayISO()/
  // istNowMinutes() give the real Kolkata time no matter what the local machine thinks it is.
  const istNow = () => new Date(Date.now() + 5.5*60*60*1000);
  const istTodayISO = () => { const d=istNow(); return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0'); };
  const istNowMinutes = () => { const d=istNow(); return d.getUTCHours()*60+d.getUTCMinutes(); };
  const STATUSES = ['Pending','Awaiting Approval','Completed'];

  function injectCss(){
    if (document.getElementById('accCss')) return;
    const s=document.createElement('style'); s.id='accCss';
    s.textContent = `
    .ac-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;border-bottom:1px solid var(--line)}
    .ac-tab{padding:9px 15px;font-size:13.5px;font-weight:600;color:var(--slate);cursor:pointer;border-bottom:2px solid transparent;display:flex;align-items:center;gap:7px}
    .ac-tab.active{color:var(--brand);border-bottom-color:var(--brand)}
    @media(max-width:700px){.ac-tabs{display:flex;flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;gap:7px;border-bottom:0;padding:2px 2px 6px}.ac-tabs::-webkit-scrollbar{display:none}.ac-tab{flex:0 0 auto;white-space:nowrap;justify-content:center;border:1px solid var(--line);border-radius:20px;padding:7px 13px;font-size:12.5px;gap:5px}.ac-tab.active{background:var(--brand-a10,#eef2ff);border-color:var(--brand)}}
    .ac-3p{display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap}
    .ac-pbtn{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 14px;border:1px solid var(--line);border-radius:20px;background:var(--bg-card);color:var(--body);font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit}
    .ac-pbtn.on{background:var(--brand);border-color:var(--brand);color:#fff}
    .ac-btn{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 13px;border:1px solid var(--line);border-radius:9px;background:var(--bg-card);color:var(--ink);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
    .ac-btn:hover{border-color:var(--brand);color:var(--brand)}
    .ac-btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}.ac-btn.primary:hover{color:#fff;filter:brightness(.94)}
    .ac-btn.ok{background:#16a34a;border-color:#16a34a;color:#fff}.ac-btn.ok:hover{color:#fff}
    .ac-btn.danger{color:#b91c1c}.ac-btn.danger:hover{border-color:#b91c1c}
    .ac-btn.ic{padding:0;width:36px;justify-content:center}
    .ac-hdrow{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:8px}
    @media(max-width:900px){.ac-hdrow{grid-template-columns:1fr}}
    .ac-hdrow .h{font-size:15px;font-weight:800;color:var(--ink);display:flex;align-items:center;gap:8px}
    .ac-cardgrid{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr;gap:16px}
    @media(max-width:900px){.ac-cardgrid{grid-template-columns:1fr}}
    .ac-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
    @media(max-width:900px){.ac-cols{grid-template-columns:1fr}}
    .ac-col{display:flex;flex-direction:column;gap:16px;min-width:0}
    .ac-colh{font-size:15px;font-weight:800;color:var(--ink);display:flex;align-items:center;gap:8px;margin-bottom:-4px}
    .ac-row .ti{min-width:0}
    .tp-title{word-break:break-word}
    .ac-card{border:1px solid var(--line);border-radius:14px;background:var(--bg-card);display:flex;flex-direction:column;min-width:0}
    .ac-card > .hd{padding:13px 15px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:700;color:var(--ink)}
    .ac-card > .hd .cnt{margin-left:auto;background:var(--brand-a10,#eef2ff);color:var(--brand);border-radius:20px;padding:1px 9px;font-size:11.5px;font-weight:700}
    .ac-card > .bd{padding:12px 13px;overflow:auto;height:320px}
    .ac-seclbl{font-size:10.5px;font-weight:700;color:var(--slate);text-transform:uppercase;letter-spacing:.05em;margin:8px 2px 6px}
    .ac-seclbl:first-child{margin-top:0}
    .ac-seclist{min-height:6px}
    .ac-arch-list{display:flex;flex-direction:column;gap:8px}
    .ac-row{display:flex;align-items:center;gap:11px;background:var(--bg-card);border:1px solid var(--line);border-radius:10px;padding:6px 12px;margin-bottom:0;cursor:pointer;transition:border-color .1s}
    .ac-row:hover{border-color:var(--brand);box-shadow:0 1px 6px rgba(2,6,23,.05)}
    .ac-row.drag{opacity:.4}
    .ac-row .grip{color:#cbd5e1;cursor:grab;font-size:13px;padding:5px 4px}
    .ac-rowchk{width:16px;height:16px;flex:none;cursor:pointer;accent-color:var(--brand);margin:0}
    .grip{touch-action:none;color:#cbd5e1;cursor:grab;font-size:13px;padding:5px 4px}
    @media(hover:none){ .grip{font-size:16px;padding:13px 10px} }
    .ac-row .ti{flex:1;min-width:0}
    .ac-row .ti .t{font-weight:700;font-size:13.5px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ac-row .ti .m{font-size:11.5px;color:var(--slate);display:flex;gap:10px;align-items:center;margin-top:3px;flex-wrap:wrap}
    .ac-avs{display:flex;flex:none}
    .ac-av{width:24px;height:24px;border-radius:50%;color:#fff;font-size:9.5px;font-weight:700;display:grid;place-items:center;margin-left:-6px;border:2px solid var(--bg-card)}
    .ac-av:first-child{margin-left:0}
    .ac-row .rt .rtd{font-size:11px;color:var(--slate);white-space:nowrap;display:flex;align-items:center;gap:4px}
    .ac-row .rt{display:flex;align-items:center;gap:8px;flex:none}
    .ac-pnum{flex:none;width:20px;height:20px;border-radius:6px;background:var(--brand-a10,#eef2ff);color:var(--brand);font-size:11px;font-weight:800;display:grid;place-items:center}
    .grip-sp{width:21px;flex:none}
    .ac-row.swap-tgt{outline:2px dashed var(--brand);outline-offset:-2px}
    .ac-grpbox{display:flex;flex-direction:column;gap:2px}
    .ac-secwrap.drag{opacity:.4}
    .ac-sechdr{display:flex;align-items:center;gap:6px}
    .ac-sechdr .grip{cursor:grab}
    .ac-ins{height:8px;margin:0;border-radius:4px;cursor:cell;position:relative;display:flex;align-items:center;justify-content:center}
    .ac-ins::before{content:'';position:absolute;left:4px;right:4px;top:50%;border-top:1px dashed var(--line);transform:translateY(-50%)}
    .ac-ins::after{content:'+ Add task here';position:relative;z-index:1;background:var(--bg-card);color:var(--brand);font-size:10px;font-weight:700;padding:0 8px;opacity:0;transition:opacity .12s}
    .ac-ins:hover::after{opacity:1}
    @media(hover:none){ .ac-ins{display:none} }
    .tp-attach-chip{display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:5px 10px;border-radius:8px;background:rgba(0,0,0,.06);font-size:12px;cursor:pointer;width:fit-content}
    .tp-attach-chip:hover{background:rgba(0,0,0,.1)}
    .ac-empty{color:var(--slate);font-size:12.5px;text-align:center;padding:14px 8px;cursor:cell;border:1px dashed var(--line);border-radius:10px}
    .ac-empty:hover{border-color:var(--brand);color:var(--brand)}
    /* Workflow builder */
    .wf-lbl{display:block;font-size:12px;font-weight:700;color:var(--ink);margin:14px 0 5px}
    .wf-lbl:first-child{margin-top:0}
    .wf-hint{font-weight:500;color:var(--slate)}
    .wf-steps-head{margin-top:20px}
    .wf-step{display:flex;align-items:flex-start;gap:10px;padding:10px;border:1px solid var(--line);border-radius:11px;margin-bottom:9px;background:var(--bg-card)}
    .wf-step-num{flex:0 0 26px;height:26px;border-radius:50%;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:700;margin-top:6px}
    .wf-step-fields{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px}
    .wf-step-sub{display:flex;gap:7px}
    .wf-step-sub .wf-s-person{flex:2;min-width:0}
    .wf-step-sub .wf-s-dur{flex:0 0 92px}
    .wf-step-sub .wf-s-unit{flex:0 0 96px}
    .wf-s-del{margin-top:4px;flex:0 0 auto}
    .wf-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
    .wf-trig{font-size:11.5px;color:var(--brand);margin-top:3px}
    .wf-desc{color:var(--slate);font-size:13px;margin-bottom:10px}
    .wf-trig-box{background:var(--brand-a10,#eef2ff);border:1px solid var(--line);border-radius:10px;padding:9px 12px;font-size:13px;margin-bottom:18px}
    .wf-timeline{display:flex;flex-direction:column}
    .wf-tl-item{display:flex;gap:12px;padding-bottom:16px;position:relative}
    .wf-tl-item:not(:last-child)::before{content:'';position:absolute;left:13px;top:28px;bottom:0;width:2px;background:var(--line)}
    .wf-tl-num{flex:0 0 28px;height:28px;border-radius:50%;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;z-index:1}
    .wf-tl-body{flex:1;min-width:0;padding-top:3px}
    .wf-tl-title{font-weight:600;font-size:14px;color:var(--ink)}
    .wf-tl-meta{display:flex;align-items:center;gap:14px;margin-top:6px;flex-wrap:wrap}
    .wf-who{display:inline-flex;align-items:center}
    .wf-av{width:22px;height:22px;border-radius:50%;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;margin-right:7px}
    .wf-who-nm{font-size:12.5px;color:var(--ink);font-weight:600}
    .wf-dept{font-size:11.5px;color:var(--slate);margin-left:7px}
    .wf-dur{font-size:12px;color:var(--slate);display:inline-flex;align-items:center;gap:5px}
    @media(max-width:700px){.wf-step-sub{flex-wrap:wrap}.wf-step-sub .wf-s-person,.wf-step-sub .wf-pp{flex:1 1 100%}.wf-step-sub .wf-s-dur,.wf-step-sub .wf-s-unit{flex:1 1 44%}}
    /* Workflow step person picker (avatar + department-grouped) */
    .wf-step-sub .wf-pp{flex:2;min-width:0}
    .wf-pp{position:relative}
    .wf-pp-btn{width:100%;display:flex;align-items:center;gap:9px;text-align:left;cursor:pointer;padding:6px 10px;min-height:40px}
    .wf-pp-av{width:24px;height:24px;border-radius:50%;color:#fff;font-size:10px;font-weight:700;display:grid;place-items:center;flex:none}
    .wf-pp-nm{font-size:13px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .wf-pp-ph{font-size:13px;color:var(--slate)}
    .wf-pp-caret{margin-left:auto;color:var(--slate);font-size:11px}
    .wf-pp-panel{position:absolute;top:calc(100% + 4px);left:0;right:0;min-width:220px;z-index:60;background:var(--bg-card);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:6px;display:none;max-height:280px;overflow:auto}
    .wf-pp.open .wf-pp-panel{display:block}
    .wf-pp-panel .ms-search{margin-bottom:6px}
    .wf-tl-desc{font-size:12.5px;color:var(--slate);margin-top:3px;line-height:1.5}
    .ac-addrow{display:flex;gap:8px;margin:3px 0}
    .ac-addrow-ghost{display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:9px;border:1px dashed var(--line);color:var(--slate);font-size:13px;cursor:pointer;margin:3px 0;transition:.15s}
    .ac-addrow-ghost:hover{border-color:var(--brand);color:var(--brand);background:var(--brand-a10)}
    .ac-addrow input{flex:1;border:1px solid var(--brand);border-radius:9px;padding:9px 11px;font-size:13px;font-family:inherit;box-shadow:0 0 0 3px var(--brand-a10)}
    @media(hover:none){ .ac-in,.ac-addrow input{font-size:16px} }
    .ac-chip{display:inline-flex;align-items:center;font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;white-space:nowrap}
    .ac-c-Pending{background:#fef3c7;color:#92400e}.ac-c-Awaiting{background:#dbeafe;color:#1e40af}.ac-c-Completed{background:#dcfce7;color:#166534}
    /* calendar (Google-Calendar-inspired shell) */
    .gcal-shell{display:flex;gap:16px;align-items:flex-start;color:#1f2937}
    .gcal-sidebar{width:250px;flex:none;display:flex;flex-direction:column;gap:16px}
    .gcal-create{display:flex;align-items:center;justify-content:center;gap:8px;background:#fff;border:1px solid #e5e7eb;border-radius:24px;padding:12px 18px;font-weight:600;font-size:14px;color:#1f2937;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.08);transition:box-shadow .15s,background .15s}
    .gcal-create:hover{box-shadow:0 2px 8px rgba(0,0,0,.12);background:#f8fafc}
    .gcal-create i{color:#2563eb;font-size:16px}
    .gcal-create.disabled{color:#9ca3af;cursor:not-allowed;box-shadow:none}
    .gcal-create.disabled:hover{box-shadow:none;background:#fff}
    .gcal-create.disabled i{color:#c3cad4}
    .gcal-mini{border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#fff}
    .gcal-mini-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
    .gcal-mini-title{font-size:13px;font-weight:700;color:#1f2937}
    .gcal-mini-nav{display:flex;gap:2px}
    .gcal-mini-nav button{border:0;background:transparent;color:#6b7280;width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:11px}
    .gcal-mini-nav button:hover{background:#f1f5f9;color:#1f2937}
    .gcal-mini-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;text-align:center;justify-content:center}
    .gcal-mini-dow{font-size:10px;color:#6b7280;font-weight:700;padding:2px 0}
    .gcal-mini-day{width:24px;height:24px;line-height:24px;margin:1px auto;font-size:11.5px;color:#1f2937;border-radius:50%;cursor:pointer;transition:background .1s;box-sizing:border-box}
    .gcal-mini-day:hover{background:#f1f5f9}
    .gcal-mini-day.other{color:#c3cad4}
    .gcal-mini-day.today{color:#2563eb;font-weight:700}
    .gcal-mini-day.selected{background:#2563eb;color:#fff;font-weight:700}
    .gcal-mini-day.has::after{content:'';display:block;width:4px;height:4px;border-radius:50%;background:#2563eb;margin:-3px auto 0}
    .gcal-mini-day.selected.has::after{background:#fff}
    .gcal-filters{border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#fff}
    .gcal-filters-title{font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px}
    .gcal-filter-row{display:flex;align-items:center;gap:9px;padding:5px 0;font-size:13.5px;color:#1f2937;cursor:pointer}
    .gcal-filter-row input{width:15px;height:15px;cursor:pointer}
    .gcal-filter-dot{width:10px;height:10px;border-radius:3px;flex:none}
    .gcal-filter-row.soon{color:#9ca3af;cursor:default}
    .gcal-main{flex:1;min-width:0;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#fff}
    .gcal-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid #e5e7eb}
    .gcal-tb-nav{display:flex;align-items:center;gap:8px}
    .gcal-tbtn{border:1px solid #e5e7eb;background:#fff;color:#1f2937;border-radius:8px;height:34px;padding:0 12px;font-size:13px;font-weight:600;cursor:pointer;transition:background .12s;flex-shrink:0}
    .gcal-tbtn:hover{background:#f8fafc}
    .gcal-tbtn.ic{width:34px;padding:0}
    .gcal-toolbar-title{font-size:19px;font-weight:600;color:#1f2937;margin:0 6px;white-space:nowrap}
    .gcal-views{display:flex;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-left:auto}
    .gcal-view-btn{border:0;background:#fff;color:#6b7280;font-size:12.5px;font-weight:600;padding:0 13px;height:34px;cursor:pointer;border-left:1px solid #e5e7eb}
    .gcal-view-btn:first-child{border-left:0}
    .gcal-view-btn.active{background:#eff6ff;color:#2563eb}
    .gcal-search{display:flex;align-items:center;gap:8px;border:1px solid #e5e7eb;border-radius:8px;height:34px;padding:0 10px;color:#6b7280;font-size:13px;flex:1 1 240px;min-width:200px;max-width:480px}
    .gcal-search input{border:0;outline:0;font-size:13px;flex:1;color:#1f2937;background:transparent;min-width:0}
    .gcal-body{padding:0}
    .gcal-mgrid{display:grid;grid-template-columns:repeat(7,1fr)}
    .gcal-mdow{text-align:center;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.03em;padding:8px 0;border-bottom:1px solid #e5e7eb}
    .gcal-mcell{min-height:104px;border-right:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;padding:6px;display:flex;flex-direction:column;gap:3px;cursor:pointer;transition:background .1s}
    .gcal-mcell:nth-child(7n){border-right:0}
    .gcal-mcell:hover{background:#f8fafc}
    .gcal-mcell.other{background:#fafafa}
    .gcal-mcell.other .gcal-mnum{color:#c3cad4}
    .gcal-mcell.today .gcal-mnum{background:#2563eb;color:#fff}
    .gcal-mnum{font-size:12.5px;font-weight:600;color:#1f2937;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:50%;flex:none}
    .gcal-mevents{display:flex;flex-direction:column;gap:3px;overflow:hidden}
    .gcal-mev{font-size:11px;padding:2px 6px;border-radius:5px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;font-weight:600;max-width:100%}
    .gcal-mev[data-task]{cursor:grab;position:relative;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
    .gcal-mev[data-task]::before{content:'';position:absolute;top:-6px;left:-6px;right:-6px;bottom:-6px}
    .gcal-mev.gcal-dragging{opacity:.35;cursor:grabbing}
    .gcal-mev.gcal-armed{outline:2px solid rgba(37,99,235,.55);outline-offset:1px}
    .gcal-mcell.gcal-drop-hover,.gcal-allday-col.gcal-drop-hover{outline:2px dashed #2563eb;outline-offset:-2px;background:rgba(37,99,235,.08)}
    .gcal-wrap{display:flex;flex-direction:column;max-height:66vh;overflow:auto}
    .gcal-allday{display:flex;border-bottom:1px solid #e5e7eb;position:sticky;top:0;background:#fff;z-index:2}
    .gcal-allday-label{width:56px;flex:none;font-size:10.5px;color:#6b7280;padding:6px 6px 6px 0;text-align:right}
    .gcal-allday-cols{flex:1;display:grid;gap:0}
    .gcal-allday-col{border-left:1px solid #e5e7eb;padding:4px;display:flex;flex-direction:column;gap:3px;min-height:32px}
    .gcal-timegrid{display:flex}
    .gcal-hours{width:56px;flex:none}
    .gcal-hour{height:48px;font-size:10.5px;color:#6b7280;text-align:right;padding-right:6px;position:relative;top:-6px}
    .gcal-daycols{flex:1;display:grid;position:relative}
    .gcal-daycol{border-left:1px solid #e5e7eb;position:relative}
    .gcal-hourline{height:48px;border-bottom:1px solid #eef1f4}
    .gcal-nowline{position:absolute;left:0;right:0;height:0;border-top:2px solid #ea4335;z-index:3}
    .gcal-nowdot{position:absolute;left:-4px;top:-4px;width:8px;height:8px;border-radius:50%;background:#ea4335}
    .gcal-daycolhead{text-align:center;padding:8px 0;border-left:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;font-size:11px;font-weight:600;color:#6b7280}
    .gcal-daycolhead .n{font-size:16px;color:#1f2937;font-weight:700;display:block;margin-top:2px}
    .gcal-daycolhead.today .n{color:#2563eb}
    /* Name + time sit on ONE line (flex row) instead of stacking — keeps short meetings from
       looking "thick"/oversized. left/width are set inline per-block by gcalMtgLayout() so
       meetings that overlap in time sit side-by-side instead of drawing on top of each other. */
    .gcal-mtgblock{position:absolute;display:flex;align-items:center;gap:6px;border-radius:6px;color:#fff;padding:3px 7px;overflow:hidden;cursor:pointer;font-size:11px;line-height:1.35;box-shadow:0 1px 2px rgba(0,0,0,.15);z-index:2}
    .gcal-mtgblock b{flex:1;min-width:0;font-size:11.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .gcal-mtgblock span{flex:none;font-size:10px;opacity:.9;white-space:nowrap}
    .gcal-mtgblock[data-meeting-time]{cursor:grab;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:none}
    .gcal-mtgblock.gcal-dragging{opacity:.55;cursor:grabbing;box-shadow:0 4px 10px rgba(0,0,0,.3)}
    .gcal-tbtn:disabled{opacity:.4;cursor:not-allowed;pointer-events:none}
    /* Agenda list (used by Week view, and by Month's day-click slide-in panel) */
    .gcal-list-wrap{max-height:66vh;overflow:auto}
    .gcal-list{padding:4px 0}
    .gcal-lday{border-bottom:1px solid #eef1f4;padding:10px 16px}
    .gcal-lday:last-child{border-bottom:0}
    .gcal-lday-head{font-size:13px;font-weight:700;color:#1f2937;margin-bottom:8px;display:flex;align-items:center;gap:8px}
    .gcal-lday.today .gcal-lday-head{color:#2563eb}
    .gcal-lday-badge{background:#2563eb;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px}
    .gcal-lday-rows{display:flex;flex-direction:column;gap:5px}
    .gcal-lrow{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:8px;font-size:13px;color:#1f2937;cursor:pointer;transition:background .1s}
    .gcal-lrow:hover{background:#f8fafc}
    .gcal-lrow.empty{color:#9ca3af;cursor:default;font-size:12.5px}
    .gcal-lrow.empty:hover{background:transparent}
    .gcal-lrow-dot{width:9px;height:9px;border-radius:50%;flex:none}
    .gcal-lrow-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
    .gcal-lrow-tag{font-size:11px;color:#6b7280;flex:none}
    .gcal-lrow[data-task],.gcal-lrow[data-meeting]{cursor:grab;position:relative;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
    .gcal-lrow.gcal-dragging{opacity:.4;cursor:grabbing;background:#eff6ff}
    .gcal-lrow.gcal-armed{outline:2px solid rgba(37,99,235,.55);outline-offset:-2px}
    .gcal-lday.gcal-drop-hover{background:rgba(37,99,235,.06);outline:2px dashed #2563eb;outline-offset:-2px}
    .gcal-yeargrid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:18px}
    .gcal-year-month{border:1px solid #e5e7eb;border-radius:10px;padding:10px}
    .gcal-year-month-title{font-size:12.5px;font-weight:700;color:#1f2937;margin-bottom:6px;cursor:pointer;text-align:center}
    .gcal-year-month-title:hover{color:#2563eb}
    .gcal-empty-view{padding:60px 20px;text-align:center;color:#9ca3af;font-size:13.5px}
    .gcal-panel{position:fixed;top:0;right:0;height:100%;width:360px;max-width:92vw;background:#fff;border-left:1px solid #e5e7eb;box-shadow:-6px 0 24px rgba(15,23,42,.10);transform:translateX(100%);transition:transform .22s ease;z-index:200;display:flex;flex-direction:column}
    .gcal-panel.open{transform:translateX(0)}
    .gcal-panel-head{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#1f2937}
    .gcal-panel-head .x{margin-left:auto;cursor:pointer;color:#6b7280;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center}
    .gcal-panel-head .x:hover{background:#f1f5f9;color:#1f2937}
    .gcal-panel-body{flex:1;overflow-y:auto;padding:18px}
    .gcal-panel-title{font-size:16px;font-weight:700;color:#1f2937;margin-bottom:14px;line-height:1.4}
    .gcal-panel-row{display:flex;gap:10px;align-items:flex-start;margin-bottom:14px;font-size:13.5px;color:#374151;line-height:1.5}
    .gcal-panel-row i{width:16px;color:#6b7280;margin-top:2px;flex:none}
    .gcal-panel-foot{padding:14px 18px;border-top:1px solid #e5e7eb;display:flex;gap:8px}
    .gcal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.15);z-index:199;opacity:0;pointer-events:none;transition:opacity .18s}
    .gcal-backdrop.open{opacity:1;pointer-events:auto}
    .gcal-fab{position:fixed;right:28px;bottom:28px;width:56px;height:56px;border-radius:50%;background:#2563eb;color:#fff;border:0;box-shadow:0 4px 14px rgba(37,99,235,.35);font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .12s,box-shadow .12s;z-index:150}
    .gcal-fab:hover{transform:scale(1.06);box-shadow:0 6px 18px rgba(37,99,235,.45)}
    .gcal-fab.disabled{background:#cbd5e1;box-shadow:none;cursor:not-allowed}
    .gcal-fab.disabled:hover{transform:none;box-shadow:none}
    @media(max-width:900px){
      .gcal-shell{flex-direction:column;align-items:stretch}
      .gcal-main{width:100%}
      .gcal-sidebar{width:100%;flex-direction:row;flex-wrap:wrap}
      .gcal-mini{flex:1;min-width:220px}
      .gcal-filters{flex:1;min-width:200px}
      .gcal-create{width:100%}
      .gcal-toolbar{flex-direction:column;align-items:stretch}
      .gcal-tb-nav{width:100%;justify-content:center}
      .gcal-toolbar-title{font-size:16px;flex:1;text-align:center;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .gcal-search{width:100%;max-width:none;flex:none}
      .gcal-views{width:100%;margin-left:0;flex-wrap:wrap}
      .gcal-views .gcal-view-btn{flex:1 1 auto}
      .gcal-yeargrid{grid-template-columns:repeat(1,1fr);gap:12px;padding:12px}
      .gcal-mcell{min-height:56px}
      .gcal-mevents{flex-direction:row;flex-wrap:wrap;gap:4px}
      .gcal-mevents .gcal-mev{font-size:0;line-height:0;padding:0;width:6px;height:6px;min-width:6px;border-radius:50%;white-space:normal;overflow:visible}
      .gcal-panel{width:100%;max-width:100%}
      .gcal-fab{right:18px;bottom:18px}
    }
    /* meetings */
    .mtg-page{color:#1f2937}
    .mtg-main{width:100%;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#fff}
    .mtg-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:16px;border-bottom:1px solid #e5e7eb}
    .mtg-toolbar-title{font-size:19px;font-weight:600;color:#1f2937}
    .mtg-create{display:flex;align-items:center;justify-content:center;gap:8px;background:var(--brand);border:1px solid var(--brand);border-radius:20px;padding:0 16px;height:38px;font-weight:600;font-size:13.5px;color:#fff;cursor:pointer;margin-left:auto}
    .mtg-gstatus{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:16px}
    .mtg-gstatus.connected{background:#dcfce7;color:#16a34a}
    .mtg-gstatus.connect{background:#fff;border:1px solid #d1d5db;color:#374151;cursor:pointer}
    .mtg-gstatus.connect:hover{background:#f9fafb}
    .mtg-gate{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:14px;padding:70px 24px;min-height:320px}
    .mtg-gate .mtg-gate-icon{font-size:34px;color:#4285f4}
    .mtg-gate h3{font-size:17px;font-weight:600;color:#1f2937;margin:0}
    .mtg-gate p{font-size:13px;color:var(--slate);max-width:340px;margin:0}
    .mtg-gate-warn{font-size:12.5px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 12px;max-width:360px;display:flex;align-items:center;gap:6px;text-align:left}
    .mtg-gate button{display:flex;align-items:center;justify-content:center;gap:8px;background:#fff;border:1px solid #d1d5db;border-radius:20px;padding:0 20px;height:42px;font-weight:600;font-size:13.5px;color:#374151;cursor:pointer}
    .mtg-gate button:hover{background:#f9fafb}
    .mtg-gate button i{color:#4285f4}
    .mtg-auto-link{font-size:12.5px;color:#166534;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 10px;display:flex;align-items:center;gap:6px}
    .mtg-auto-link.warn{background:#fffbeb;border-color:#fde68a;color:#92400e}
    .mtg-auto-link a{color:inherit;font-weight:600;text-decoration:underline}
    /* Non-blocking scheduling-conflict warning shown in the meeting form's attendee picker */
    .mtg-conflict-warn{font-size:12.5px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;margin-top:6px;line-height:1.5}
    .mtg-conflict-mark{margin-left:2px}
    .mtg-log-attendee{font-size:13px;color:var(--body);padding:4px 0;display:flex;align-items:center;gap:8px}
    .mtg-create:hover{filter:brightness(.94)}
    .mtg-grouptabs{display:flex;gap:6px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid #e5e7eb;background:#f8fafc}
    .mtg-gtab{border:1px solid #e5e7eb;background:#fff;color:#475569;font-size:13px;font-weight:600;padding:0 16px;height:34px;border-radius:8px;cursor:pointer}
    .mtg-gtab.active{background:var(--brand);border-color:var(--brand);color:#fff}
    .mtg-body{padding:16px}
    .mtg-sec-label{font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.03em;margin:18px 0 10px}
    .mtg-sec-label:first-child{margin-top:0}
    .mtg-log-row{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #e5e7eb;border-radius:10px;padding:11px 14px;margin-bottom:8px;cursor:pointer;transition:box-shadow .12s,border-color .12s}
    .mtg-log-row:hover{border-color:#c7d2fe;box-shadow:0 2px 10px rgba(15,23,42,.06)}
    .mtg-log-title{font-size:13.5px;font-weight:700;color:#1f2937}
    .mtg-log-meta{font-size:12px;color:#6b7280;margin-top:2px}
    .mtg-log-badge{flex:none;font-size:11px;font-weight:600;padding:4px 10px;border-radius:99px;white-space:nowrap}
    .mtg-log-badge.ready{background:#dcfce7;color:#16a34a}
    .mtg-log-badge.pending{background:#fef9c3;color:#a16207}
    .mtg-log-badge.none{background:#f1f5f9;color:#94a3b8}
    .mtg-log-transcript{margin-top:6px;font-size:13px;color:#334155;line-height:1.6;max-height:260px;overflow:auto;background:#f8fafc;border-radius:8px;padding:12px}
    .mtg-card{display:flex;align-items:stretch;gap:14px;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin-bottom:10px;transition:box-shadow .12s,border-color .12s}
    .mtg-card:hover{border-color:#c7d2fe;box-shadow:0 2px 10px rgba(15,23,42,.06)}
    .mtg-bar{width:4px;border-radius:3px;flex:none}
    .mtg-time{width:132px;flex:none;font-size:12.5px;color:#6b7280;font-weight:600;padding-top:2px;line-height:1.35}
    .mtg-info{flex:1;min-width:0}
    .mtg-title{font-size:14px;font-weight:700;color:#1f2937;margin-bottom:4px}
    .mtg-recur-tag{font-size:10.5px;font-weight:600;color:#7c3aed;background:#f5f3ff;padding:2px 7px;border-radius:10px;margin-left:6px;white-space:nowrap;display:inline-flex;align-items:center;gap:4px}
    .mtg-meta{display:flex;align-items:center;gap:8px;font-size:12px;color:#6b7280;flex-wrap:wrap}
    .mtg-avatars{display:flex;margin-left:6px}
    .mtg-avatar{width:20px;height:20px;border-radius:50%;color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff;margin-left:-6px}
    .mtg-avatar:first-child{margin-left:0}
    .mtg-actions{display:flex;align-items:center;flex:none}
    .mtg-join{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:8px;height:32px;padding:0 14px;font-size:12.5px;font-weight:600;cursor:pointer;text-decoration:none}
    .mtg-join:hover{filter:brightness(.94)}
    .mtg-join.disabled{border-color:#e5e7eb;background:#f8fafc;color:#9ca3af;cursor:not-allowed}
    .mtg-join.ghost{border-color:#e5e7eb;background:#fff;color:#475569;cursor:default}
    .mtg-del{border:0;background:transparent;color:#94a3b8;cursor:pointer;font-size:13px;padding:0 8px;height:32px;border-radius:6px;margin-left:6px}
    .mtg-del:hover{color:#dc2626;background:#fef2f2}
    .mtg-static-hint{height:38px;display:flex;align-items:center;color:#94a3b8;font-size:13px;font-style:italic}
    @media(max-width:900px){
      .mtg-toolbar{flex-direction:column;align-items:stretch}
      .mtg-create{margin-left:0;width:100%}
      .mtg-grouptabs{gap:6px;flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:10px 14px}
      .mtg-grouptabs::-webkit-scrollbar{display:none}
      .mtg-gtab{flex:0 0 auto;white-space:nowrap;padding:0 13px;font-size:12.5px}
      .mtg-card{flex-direction:column;align-items:stretch;gap:2px;position:relative;padding:6px 10px 6px 14px;margin-bottom:6px}
      .mtg-bar{position:absolute;left:0;top:5px;bottom:5px;width:3px;border-radius:2px}
      .mtg-time{width:auto;order:1;padding-top:0;line-height:1.15;font-size:11px}
      .mtg-info{order:2}
      .mtg-title{font-size:13px;margin-bottom:1px}
      .mtg-meta{font-size:11px}
      .mtg-actions{order:3;width:100%;justify-content:flex-end;gap:0;margin-top:2px}
      .mtg-join{height:26px;padding:0 10px;font-size:11.5px}
      .mtg-del{height:26px;width:26px}
    }
    /* task page */
    .tp-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px}
    .tp-title{font-size:20px;font-weight:800;color:var(--ink);display:flex;align-items:center;gap:10px}
    .tp-sub{font-size:12.5px;color:var(--slate);margin-top:3px}
    .tp-acts{display:flex;gap:7px;flex-wrap:wrap;align-items:center}
    .tp-card{border:1px solid var(--line);border-radius:14px;background:var(--bg-card);padding:16px;margin-bottom:14px;min-width:0;overflow-wrap:anywhere}
    .tp-desc{font-size:13px;color:var(--body);line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
    .tp-card h3{margin:0 0 12px;font-size:14px;color:var(--ink);display:flex;align-items:center;gap:8px}
    .tp-card h3 .r{margin-left:auto;display:flex;gap:6px}
    .tp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
    @media(max-width:640px){.tp-grid{grid-template-columns:1fr 1fr;gap:10px}}
    .tp-f .k{font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--slate);font-weight:700}
    .tp-f .v{font-size:13px;color:var(--ink);margin-top:3px;font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .tp-f .v a{color:var(--brand);cursor:pointer;font-weight:600}
    .tp-chat{display:flex;flex-direction:column;gap:8px;max-height:230px;overflow:auto;padding:2px}
    .tp-msg{max-width:82%;padding:8px 11px;border-radius:12px;font-size:13px;line-height:1.4;overflow-wrap:anywhere;word-break:break-word}
    .tp-msg.them{background:#f1f5f9;color:var(--ink);border-radius:12px 12px 12px 2px}
    .tp-msg.mine{background:var(--brand);color:#fff;align-self:flex-end;border-radius:12px 12px 2px 12px}
    .tp-msg .who{font-size:10px;opacity:.75;margin-bottom:2px}
    .tp-sub-item{display:flex;align-items:center;gap:9px;background:var(--bg-card);border:1px solid var(--line);border-radius:9px;padding:8px 10px;margin-bottom:2px}
    .tp-sub-item.drag{opacity:.4}
    .ac-in{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:9px;padding:10px 12px;font-size:13.5px;font-family:inherit;background:var(--bg-card);color:var(--ink)}
    .ac-in:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
    textarea.ac-in{min-height:150px;resize:vertical}
    .ac-lbl{display:block;font-size:12.5px;font-weight:600;color:#334155;margin:12px 0 6px}
    .ac-msrow{display:flex;flex-wrap:wrap;gap:6px;border:1px solid var(--line);border-radius:9px;padding:8px;max-height:150px;overflow:auto}
    .ac-mschk{display:flex;align-items:center;gap:6px;font-size:12.5px;background:#f1f5f9;border-radius:20px;padding:4px 10px;cursor:pointer}
    .ms-list{border:1px solid var(--line);border-radius:10px;max-height:300px;overflow-y:auto;overflow-x:hidden;padding:4px;box-sizing:border-box;width:100%}
    .ms-grp{font-size:10.5px;font-weight:700;color:var(--slate);text-transform:uppercase;letter-spacing:.05em;padding:8px 10px 4px;background:var(--bg-card)}
    .ms-row{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;cursor:pointer;min-width:0}
    .ms-row:hover{background:#f1f5f9}.ms-row.on{background:var(--brand-a10,#eef2ff)}
    .ms-av{width:28px;height:28px;border-radius:50%;color:#fff;font-size:10px;font-weight:700;display:grid;place-items:center;flex:none}
    .ms-nm{flex:1;min-width:0;font-size:13px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ms-ck{color:var(--brand);opacity:0}.ms-row.on .ms-ck{opacity:1}
    select.ac-in{appearance:none;-webkit-appearance:none;padding-right:32px;background-image:linear-gradient(45deg,transparent 50%,#64748b 50%),linear-gradient(135deg,#64748b 50%,transparent 50%);background-position:calc(100% - 18px) 55%,calc(100% - 13px) 55%;background-size:5px 5px,5px 5px;background-repeat:no-repeat;cursor:pointer}
    .ac-dd{position:relative}
    .ac-dd-btn{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:9px;padding:10px 12px;font-size:13.5px;background:var(--bg-card);color:var(--ink);cursor:pointer;box-sizing:border-box}
    .ac-dd-btn i{margin-left:auto;color:var(--slate);font-size:11px}
    .ac-dd-menu{position:fixed;z-index:100000;background:var(--bg-card);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 32px rgba(2,6,23,.22);max-height:240px;overflow:auto;padding:4px}
    .ac-dd-item{padding:9px 11px;border-radius:7px;font-size:13px;color:var(--ink);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ac-dd-item:hover{background:var(--brand-a10,#eef2ff);color:var(--brand)}
    .ac-dd-item.new{color:var(--brand);font-weight:600;border-top:1px solid var(--line-2);margin-top:4px}
    .bell-ring{animation:bellRing 1.1s ease-in-out infinite;transform-origin:top center}
    @keyframes bellRing{0%,60%,100%{transform:rotate(0)}10%{transform:rotate(16deg)}20%{transform:rotate(-14deg)}30%{transform:rotate(10deg)}40%{transform:rotate(-6deg)}50%{transform:rotate(2deg)}}
    #notifBtn{position:relative}
    #notifBtn .dot{position:absolute;top:-1px;right:-1px;min-width:14px;height:14px;padding:0 2px;border-radius:7px;font-size:8.5px;font-weight:700;color:#fff;background:#dc2626;display:none;align-items:center;justify-content:center;box-sizing:border-box}
    .nt-item{display:flex;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line-2);cursor:pointer}.nt-item:hover{background:#f8fafc}.nt-item.unread{background:var(--brand-a10,#f5f7ff)}
    .nt-item.urg{background:#fef2f2}
    #notifDd{width:340px;max-width:92vw}
    `;
    document.head.appendChild(s);
  }

  let PPL=null;
  async function people(){ if(PPL)return PPL; try{ const {data}=await sb.schema('acc').rpc('people'); if(data&&data.length){PPL=data.map(p=>({email:p.email,name:p.full_name||p.email,depts:Array.isArray(p.department)?p.department:[]}));return PPL;} }catch(e){} try{ if(typeof getPeople==='function'){const g=await getPeople(); PPL=(g||[]).map(p=>({email:p.email,name:p.name||p.email,depts:Array.isArray(p.depts)?p.depts:(Array.isArray(p.department)?p.department:[])}));return PPL;} }catch(e){} PPL=[]; return PPL; }
  const nameOf=(l,e)=>{const p=(l||[]).find(x=>eq(x.email,e));return p?p.name:e;};
  const iniOf=(n)=> (typeof initials==='function'?initials(n):(String(n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('')))||'?';
  function avatars(list,emails){ emails=emails||[]; return '<div class="ac-avs">'+emails.slice(0,4).map(e=>`<span class="ac-av" style="background:${colorFor(e)}" title="${esc2(nameOf(list,e))}">${esc2(iniOf(nameOf(list,e)).toUpperCase())}</span>`).join('')+(emails.length>4?`<span class="ac-av" style="background:#94a3b8" title="${esc2(emails.slice(4).map(e=>nameOf(list,e)).join(', '))}">+${emails.length-4}</span>`:'')+'</div>'; }
  const stChip = s => { const k=(s||'Pending').replace(/\s.*/,''); return `<span class="ac-chip ac-c-${k}">${esc2(s||'Pending')}</span>`; };
  function msWidget(id,list,sel){ sel=sel||[];
    // Each person appears exactly ONCE here, grouped under a heading naming every
    // department they belong to (comma-joined) — no more duplicate rows for people
    // in multiple departments, which made it look like only one row actually worked.
    const groups={}; list.forEach(p=>{ const ds=(Array.isArray(p.depts)?p.depts:[]).map(d=>String(d||'').trim()).filter(Boolean); const key=ds.length?ds.slice().sort().join(', '):'Unassigned'; (groups[key]=groups[key]||[]).push(p); });
    const order=Object.keys(groups).sort((a,b)=> a==='Unassigned'?1:(b==='Unassigned'?-1:a.localeCompare(b)));
    let h=`<input class="ac-in ms-search" placeholder="Search people…" style="margin-bottom:8px" oninput="accMsFilter('${id}',this.value)"><div class="ms-list" id="${id}">`;
    order.forEach(d=>{ h+=`<div class="ms-grp">${esc2(d)}</div>`; groups[d].forEach(p=>{ const on=sel.some(x=>eq(x,p.email)); h+=`<div class="ms-row${on?' on':''}" data-n="${esc2((String(p.name||'')+' '+String(p.email||'')).toLowerCase())}" onclick="accMsToggle(this)"><input type="checkbox" value="${esc2(p.email)}" ${on?'checked':''} style="display:none"><span class="ms-av" style="background:${colorFor(p.email)}">${esc2(iniOf(p.name).toUpperCase())}</span><span class="ms-nm">${esc2(p.name)}</span><i class="fa-solid fa-check ms-ck"></i></div>`; }); });
    return h+`</div>`; }
  const msGet = id => [...new Set([...document.querySelectorAll('#'+id+' input:checked')].map(c=>c.value))];
  window.accMsToggle=function(el){
    const cb=el.querySelector('input'); if(!cb)return;
    const val=cb.value, willCheck=!cb.checked;
    const list=el.closest('.ms-list')||el.parentElement;
    (list?list.querySelectorAll('.ms-row'):[el]).forEach(row=>{
      const c=row.querySelector('input');
      if(c&&c.value===val){ c.checked=willCheck; row.classList.toggle('on',willCheck); }
    });
  };
  window.accMsFilter=function(id,q){ q=(q||'').toLowerCase(); const box=document.getElementById(id); if(!box)return; box.querySelectorAll('.ms-row').forEach(l=>{ l.style.display=(!q||(l.dataset.n||'').includes(q))?'':'none'; }); box.querySelectorAll('.ms-grp').forEach(g=>{ let n=g.nextElementSibling,vis=false; while(n&&n.classList&&n.classList.contains('ms-row')){ if(n.style.display!=='none')vis=true; n=n.nextElementSibling; } g.style.display=vis?'':'none'; }); };

  /* ---------- notifications ---------- */
  let NOTIFS=[], URGENT=[];
  async function notifLoad(){
    try{ const {data}=await ACC().from('notifications').select('*').eq('recipient',me()).order('created_at',{ascending:false}).limit(50); NOTIFS=data||[]; }catch(e){ NOTIFS=[]; }
    notifPaint();
  }
  function paintBell(){
    const bell=$('notifBtn'); if(!bell)return;
    const n=NOTIFS.filter(x=>!x.read).length+URGENT.length;
    let dot=bell.querySelector('.dot'); if(dot){ dot.textContent=n>99?'99+':String(n); dot.style.display=n>0?'flex':'none'; }
    bell.classList.toggle('bell-ring',n>0);
  }
  // nexus-core.js's own refreshNotifState() reads legacy/empty tables and would otherwise
  // stomp the badge we just painted above with a stale zero. Since this file loads after
  // nexus-core.js, take over the function entirely so every caller (including nexus-core's
  // renderPage() on each navigation) gets the real, correct unread count.
  window.refreshNotifState=async function(){ paintBell(); };
  function notifPaint(){
    paintBell();
    const dd=$('notifDd'); if(dd&&dd.classList.contains('show')) notifDd();
  }
  async function computeUrgent(){
    URGENT=[];
    try{
      const {data:aRows}=await ACC().from('ptask_assignees').select('task_id').eq('email',me());
      const ids=[...new Set((aRows||[]).map(r=>r.task_id))]; if(!ids.length)return;
      const {data:ts}=await ACC().from('ptasks').select('id,title,due_date,order_index,approval_state').in('id',ids);
      const open=(ts||[]).filter(t=>t.approval_state!=='approved');
      const td=new Date(); td.setHours(0,0,0,0);
      URGENT=open.filter(t=>t.due_date).map(t=>{ const d=parseD(t.due_date); if(d)d.setHours(0,0,0,0); return {t:t,d:d}; }).filter(x=>x.d&&x.d<=td).map(x=>({task_id:x.t.id,title:x.t.title,reason:x.d<td?'Overdue':'Due today'}));
    }catch(e){}
  }
  async function notifDd(){
    const dd=$('notifDd'); if(!dd)return;
    notifPaint2(); await computeUrgent(); notifPaint2(); paintBell();
  }
  function notifPaint2(){
    const dd=$('notifDd'); if(!dd)return;
    const urg=URGENT.map(u=>`<div class="nt-item urg" onclick="accNotifGoto(${u.task_id})"><i class="fa-solid fa-fire" style="color:#dc2626;margin-top:2px"></i><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:12.5px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc2(u.title)}</div><div style="font-size:11.5px;color:#dc2626">${u.reason}</div></div></div>`).join('');
    const rows=NOTIFS.filter(n=>!n.read).length?NOTIFS.filter(n=>!n.read).map(n=>`<div class="nt-item ${n.read?'':'unread'}" onclick="accNotifOpen(${n.id})"><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:12.5px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc2(n.title||'')}</div><div style="font-size:11.5px;color:var(--slate)">${esc2(n.body||'')}</div></div>${n.kind==='approval'?`<div style="display:flex;gap:5px"><button class="ac-btn ok ic" style="height:28px;width:28px" title="Approve" onclick="event.stopPropagation();accApprove(${n.task_id},true,${n.id})"><i class="fa-solid fa-check"></i></button><button class="ac-btn danger ic" style="height:28px;width:28px" title="Decline" onclick="event.stopPropagation();accDecline(${n.task_id},${n.id})"><i class="fa-solid fa-xmark"></i></button></div>`:''}</div>`).join(''):'';
    const body=(urg+rows)||'<div class="ac-empty" style="cursor:default;border:0">No notifications</div>';
    dd.innerHTML=`<div style="padding:11px 12px;border-bottom:1px solid var(--line);display:flex;align-items:center"><b style="font-size:13px">Notifications</b><button class="ac-btn" style="margin-left:auto;height:26px;padding:0 9px;font-size:11px" onclick="accNotifReadAll()">Mark all read</button></div><div style="max-height:440px;overflow:auto">${body}</div>`;
  }
  window.accNotifGoto=function(tid){ const dd=$('notifDd'); if(dd)dd.classList.remove('show'); if(PAGE==='tasks'){location.hash='#/task/'+tid;renderPage();} else location.href='tasks.html#/task/'+tid; };
  window.accNotifOpen=async function(id){ const n=NOTIFS.find(x=>x.id===id); if(!n)return; if(!n.read){try{await ACC().from('notifications').update({read:true}).eq('id',id);n.read=true;notifPaint();}catch(e){}} if(n.kind==='meeting'||n.kind==='meeting_cancel'||n.kind==='meeting_update'||n.kind==='meeting_reminder'){ const dd=$('notifDd'); if(dd)dd.classList.remove('show'); navTo('tasks/meetings'); return; } accNotifGoto(n.task_id); };
  window.accNotifReadAll=async function(){ try{await ACC().from('notifications').update({read:true}).eq('recipient',me()).eq('read',false).neq('kind','approval');}catch(e){} await notifLoad(); await computeUrgent(); paintBell(); const dd=$('notifDd'); if(dd&&dd.classList.contains('show'))notifPaint2(); };
  function wireBell(){ const b=$('notifBtn'); if(b)b._accW=true; }

  window.toggleNotif=function(){ const dd=$('notifDd'); if(!dd)return; if(dd.classList.contains('show')){dd.classList.remove('show');return;} document.querySelectorAll('.dropdown.show').forEach(d=>{if(d!==dd)d.classList.remove('show');}); notifDd(); dd.classList.add('show'); };
  window.__accQ1=true;

  /* ---------- data (parallelized) ---------- */
  async function loadAssignees(ids){ if(!ids.length)return {}; try{const {data}=await ACC().from('ptask_assignees').select('*').in('task_id',ids);const m={};(data||[]).forEach(a=>{(m[a.task_id]=m[a.task_id]||[]).push(a.email);});return m;}catch(e){return {};} }
  async function loadProjectsMap(){ try{const {data}=await ACC().from('projects').select('id,name');const m={};(data||[]).forEach(p=>m[p.id]=p.name);return m;}catch(e){return {};} }
  async function loadAll(){
    const my=me();
    const [tR,aR,pR]=await Promise.all([
      ACC().from('ptasks').select('*').order('order_index',{ascending:true}),
      ACC().from('ptask_assignees').select('*'),
      ACC().from('projects').select('id,name')
    ]);
    let tasks=tR.data||[]; const pm={}; (pR.data||[]).forEach(x=>pm[x.id]=x.name);
    const asg={}; (aR.data||[]).forEach(a=>{(asg[a.task_id]=asg[a.task_id]||[]).push(a.email);});
    tasks=tasks.filter(t=>(eq(t.delegator,my)||(asg[t.id]||[]).some(e=>eq(e,my))) && (asg[t.id]||[]).length>0);
    tasks.forEach(t=>t._projName=t.project_id?pm[t.project_id]:'');
    return {tasks,asg,pm};
  }
  const isOwner = t => eq(t.delegator,me());
  const isMemb  = (t,asg)=>(asg[t.id]||[]).some(e=>eq(e,me()));
  const isSelf  = (t,asg)=>isOwner(t)&&isMemb(t,asg);
  const stOf    = t => t.approval_state==='approved'?'approved':(t.approval_state==='awaiting_approval'?'await':'open');
  const iDeleg  = (t,tasks)=> tasks.some(c=>c.parent_task_id===t.id && eq(c.delegator,me()));

  /* ---------- per-viewer priority rank (private per person: your own ranking of tasks
     given to you is independent of the owner's ranking of tasks they assigned out) ---------- */
  async function loadMyRanks(){
    try{ const {data}=await ACC().from('task_rank').select('task_id,rank').eq('viewer_email',me()); const m={}; (data||[]).forEach(r=>{m[r.task_id]=r.rank;}); return m; }catch(e){ return {}; }
  }
  async function nextRankForMe(){
    try{ const {data}=await ACC().from('task_rank').select('rank').eq('viewer_email',me()).order('rank',{ascending:false}).limit(1); return (data&&data.length?data[0].rank:0)+1; }catch(e){ return 1; }
  }
  async function setMyRank(taskId,rank){
    try{ await ACC().from('task_rank').upsert({task_id:taskId,viewer_email:me(),rank:rank},{onConflict:'task_id,viewer_email'}); }catch(e){}
  }
  /* Insert a new task's priority strictly between two neighboring tasks (by rank value), never
     renumbering anything else — e.g. between ranks 1 and 9 gives 4.5; inserting again right after
     that gives a value between 4.5 and whatever comes next. These numbers are never shown to the
     user, only the relative order (and derived letters) matter. beforeId/afterId are the actual
     neighboring task ids in the FULL global priority order (not just whatever subset is on screen
     — important in Project/Person view, where a task's on-screen neighbor may not be its true
     global neighbor). allOrderIds is the full global order, used only to crystallize any
     not-yet-ranked tasks into explicit ranks (matching their current display order) before we
     look up beforeId/afterId's numbers. */
  async function rankBetweenIds(allOrderIds,beforeId,afterId){
    const my=me();
    try{
      const {data:existing}=await ACC().from('task_rank').select('task_id,rank').eq('viewer_email',my).in('task_id',allOrderIds);
      const haveMap={}; (existing||[]).forEach(r=>{haveMap[r.task_id]=r.rank;});
      if(allOrderIds.some(id=>!haveMap.hasOwnProperty(id))){
        const rows=allOrderIds.map((id,i)=>({task_id:id,viewer_email:my,rank:i+1}));
        await ACC().from('task_rank').upsert(rows,{onConflict:'task_id,viewer_email'});
        allOrderIds.forEach((id,i)=>{haveMap[id]=i+1;});
      }
      const before=beforeId!=null?haveMap[beforeId]:null;
      const after=afterId!=null?haveMap[afterId]:null;
      if(before==null&&after==null) return 1;
      if(before==null) return after-1;
      if(after==null) return before+1;
      return (before+after)/2;
    }catch(e){ return 1; }
  }
  /* Translate a LOCAL gap (within one Project/Person group's own displayed subset) into the
     correct GLOBAL neighbor ids for rankBetweenIds — the group's next item may not be the true
     global next item, since other groups' tasks can be interleaved between them. */
  function globalNeighborsFor(flatIds,beforeLocalId,afterLocalId){
    if(beforeLocalId!=null){ const gi=flatIds.indexOf(beforeLocalId); return {beforeId:beforeLocalId, afterId:(gi>=0&&gi+1<flatIds.length)?flatIds[gi+1]:null}; }
    if(afterLocalId!=null){ const gi=flatIds.indexOf(afterLocalId); return {beforeId:(gi>0)?flatIds[gi-1]:null, afterId:afterLocalId}; }
    return {beforeId:null,afterId:null};
  }
  function letterFor(n){ let s=''; n=Math.max(1,n|0); while(n>0){ n--; s=String.fromCharCode(65+(n%26))+s; n=Math.floor(n/26); } return s; }

  /* ---------- router ---------- */
  let ROUTE={tab:'work',taskId:null};
  VIEWS.tasks = async function(v, seg){
    injectCss();
    if (seg[0]==='task' && seg[1]) { ROUTE={tab:'task',taskId:Number(seg[1])}; return taskPage(v, seg[1], seg[2]==='ro'); }
    if (seg[0]==='meetings' && seg[1]==='logs' && seg[2]) { ROUTE={tab:'meetings',taskId:null}; return mtgLogsPage(v, Number(seg[2])); }
    if (seg[0]==='meetings' && seg[1]==='log' && seg[2]) { ROUTE={tab:'meetings',taskId:null}; return mtgLogPage(v, Number(seg[2])); }
    if (seg[0]==='profile' && typeof taskProfile==='function') { ROUTE={tab:'profile',taskId:null}; return taskProfile(v); }
    let tab = seg[0] || 'work'; if(tab==='home')tab='work';
    ROUTE={tab:tab,taskId:null};
    setCrumb(['Accountability', tab==='work'?'Tasks':(tab.charAt(0).toUpperCase()+tab.slice(1))]);
    v.innerHTML = `<div class="page-head"><div><h1><i class="fa-solid fa-list-check" style="color:#1d4ed8"></i> Accountability</h1><p>Tasks, delegation & scoreboard</p></div></div>
    <div class="ac-tabs">
      <div class="ac-tab ${tab==='work'?'active':''}" onclick="navTo('tasks/work')"><i class="fa-solid fa-list-check"></i> Tasks</div>
      <div class="ac-tab ${tab==='calendar'?'active':''}" onclick="navTo('tasks/calendar')"><i class="fa-solid fa-calendar-days"></i> Calendar</div>
      <div class="ac-tab ${tab==='meetings'?'active':''}" onclick="navTo('tasks/meetings')"><i class="fa-solid fa-video"></i> Meetings</div>
      <div class="ac-tab ${tab==='archive'?'active':''}" onclick="navTo('tasks/archive')"><i class="fa-solid fa-box-archive"></i> Archive</div>
      <div class="ac-tab ${tab==='workflow'?'active':''}" onclick="navTo('tasks/workflow')"><i class="fa-solid fa-diagram-project"></i> Workflow</div>
      <div class="ac-tab ${tab==='scoreboard'?'active':''}" onclick="navTo('tasks/scoreboard')"><i class="fa-solid fa-ranking-star"></i> Scoreboard</div>
    </div><div id="acBody"><div class="loader"><div class="spin"></div></div></div>`;
    if (tab==='scoreboard') return scoreboardTab();
    if (tab==='meetings') return meetingsTab();
    if (tab==='calendar') return calendarTab();
    if (tab==='archive') return archiveTab();
    if (tab==='workflow') return workflowTab();
    return tasksScreen();
  };

  /* ---------- shared row/card renderers ---------- */
  function dueBadge(due,completedAt){
    const d=parseD(due); if(!d) return '';
    d.setHours(0,0,0,0);
    if(completedAt){
      const c=parseD(completedAt); if(!c) return '';
      c.setHours(0,0,0,0);
      if(c.getTime()>d.getTime()) return '<span class="ac-chip" title="Overdue" style="background:#fee2e2;color:#b91c1c;margin-left:6px">O</span>';
      return '<span class="ac-chip" style="background:#dcfce7;color:#15803d;margin-left:6px">On time</span>';
    }
    const today=new Date(); today.setHours(0,0,0,0);
    if(d.getTime()<today.getTime()) return '<span class="ac-chip" style="background:#fee2e2;color:#b91c1c;margin-left:6px">Overdue</span>';
    if(d.getTime()===today.getTime()) return '<span class="ac-chip" style="background:#ffedd5;color:#c2410c;margin-left:6px">Due today</span>';
    return '';
  }
  function miniRow(t,list,asg,opt){
    opt=opt||{};
    const emails=opt.ownerAvatar?[t.delegator].filter(Boolean):((asg&&asg[t.id])||[]);
    const metaParts=[];
    if(opt.showDoneDate){
      // Completed / Archive rows: show only the marked-done date (date icon) — no tag/due-date.
      if(t.completed_at) metaParts.push(`<span title="Marked done"><i class="fa-regular fa-calendar"></i> ${fmtDate(t.completed_at)}</span>`);
    } else {
      if(t._projName) metaParts.push(`<i class="fa-solid fa-diagram-project"></i> ${esc2(t._projName)}`);
      if(t.due_date) metaParts.push(`<i class="fa-regular fa-calendar"></i> ${fmtDate(t.due_date)}`);
    }
    const meta=metaParts.length?`<div class="rtd">${metaParts.join(' · ')}</div>`:'';
    return `<div class="ac-row" onclick="navTo('tasks/task/${t.id}${opt.ro?'/ro':''}')"><div class="ti"><div class="t">${esc2(t.title)}</div></div><div class="rt">${meta}${dueBadge(t.due_date,t.completed_at)}${emails.length?avatars(list,emails):''}</div></div>`;
  }
  function summaryCard(title,icon,color,count,inner){ return `<div class="ac-card sm"><div class="hd"><i class="fa-solid ${icon}" style="color:${color}"></i> ${title}<span class="cnt">${count}</span></div><div class="bd" style="height:180px;max-height:180px;min-height:0">${inner}</div></div>`; }
  // Client-side title filter for every task row currently on screen (Tasks tab) — no re-fetch.
  window.accTaskSearch=function(val){
    const q=(val||'').trim().toLowerCase();
    document.querySelectorAll('#acBody .ac-row').forEach(function(row){
      const el=row.querySelector('.ti .t');
      const txt=el?el.textContent.toLowerCase():'';
      row.style.display=(!q||txt.includes(q))?'':'none';
    });
  };

  /* ---------- WORKFLOW ----------
     A workflow = a named business process with a triggering event and an ordered
     list of steps. Each step is carried out by one designated person within a set
     duration. Stored in acc.flows (the workflow) + acc.flow_steps (its steps). */
  let WF_PEOPLE=null, WF_PID=0;

  // Single-select person picker for a workflow step: shows a coloured avatar circle + name,
  // and the dropdown groups people by department (mirrors the msWidget attendee list). The
  // chosen email lives in a hidden .wf-s-person input so wfSave reads it exactly as before.
  function wfPersonPickerHtml(sel){
    const pid='wfpp'+(++WF_PID);
    const p=(WF_PEOPLE||[]).find(function(x){return eq(x.email,sel);});
    const trig=p
      ? '<span class="wf-pp-av" style="background:'+colorFor(p.email)+'">'+esc2(iniOf(p.name).toUpperCase())+'</span><span class="wf-pp-nm">'+esc2(p.name)+'</span>'
      : '<span class="wf-pp-ph">Assign person…</span>';
    const groups={}; (WF_PEOPLE||[]).forEach(function(pp){ const ds=(Array.isArray(pp.depts)?pp.depts:[]).map(function(d){return String(d||'').trim();}).filter(Boolean); const key=ds.length?ds.slice().sort().join(', '):'Unassigned'; (groups[key]=groups[key]||[]).push(pp); });
    const order=Object.keys(groups).sort(function(a,b){ return a==='Unassigned'?1:(b==='Unassigned'?-1:a.localeCompare(b)); });
    let listHtml='';
    order.forEach(function(d){ listHtml+='<div class="ms-grp">'+esc2(d)+'</div>'; groups[d].forEach(function(pp){ const on=eq(pp.email,sel); listHtml+='<div class="ms-row'+(on?' on':'')+'" data-n="'+esc2((String(pp.name||'')+' '+String(pp.email||'')).toLowerCase())+'" data-email="'+esc2(pp.email)+'" data-name="'+esc2(pp.name)+'" onclick="wfPersonPick(this)"><span class="ms-av" style="background:'+colorFor(pp.email)+'">'+esc2(iniOf(pp.name).toUpperCase())+'</span><span class="ms-nm">'+esc2(pp.name)+'</span><i class="fa-solid fa-check ms-ck"></i></div>'; }); });
    return '<div class="wf-pp" id="'+pid+'">'
      +'<input type="hidden" class="wf-s-person" value="'+esc2(sel||'')+'">'
      +'<button type="button" class="ac-in wf-pp-btn" onclick="wfPersonToggle(this)">'+trig+'<i class="fa-solid fa-chevron-down wf-pp-caret"></i></button>'
      +'<div class="wf-pp-panel"><input class="ac-in ms-search" placeholder="Search people…" oninput="wfPersonFilter(this)"><div class="ms-list">'+listHtml+'</div></div>'
    +'</div>';
  }
  window.wfPersonToggle=function(btn){
    const pp=btn.closest('.wf-pp'); if(!pp)return;
    const isOpen=pp.classList.contains('open');
    document.querySelectorAll('.wf-pp.open').forEach(function(x){x.classList.remove('open');});
    if(!isOpen){ pp.classList.add('open'); const s=pp.querySelector('.ms-search'); if(s){ s.value=''; wfPersonFilter(s); try{s.focus();}catch(_){} } }
  };
  window.wfPersonPick=function(row){
    const pp=row.closest('.wf-pp'); if(!pp)return;
    const email=row.getAttribute('data-email')||'', name=row.getAttribute('data-name')||email;
    const hid=pp.querySelector('.wf-s-person'); if(hid)hid.value=email;
    const btn=pp.querySelector('.wf-pp-btn'); if(btn)btn.innerHTML='<span class="wf-pp-av" style="background:'+colorFor(email)+'">'+esc2(iniOf(name).toUpperCase())+'</span><span class="wf-pp-nm">'+esc2(name)+'</span><i class="fa-solid fa-chevron-down wf-pp-caret"></i>';
    pp.querySelectorAll('.ms-row.on').forEach(function(x){x.classList.remove('on');});
    row.classList.add('on');
    pp.classList.remove('open');
  };
  window.wfPersonFilter=function(inp){
    const panel=inp.closest('.wf-pp-panel'); if(!panel)return; const box=panel.querySelector('.ms-list'); if(!box)return;
    const q=(inp.value||'').toLowerCase();
    box.querySelectorAll('.ms-row').forEach(function(l){ l.style.display=(!q||(l.dataset.n||'').includes(q))?'':'none'; });
    box.querySelectorAll('.ms-grp').forEach(function(g){ let n=g.nextElementSibling,vis=false; while(n&&n.classList&&n.classList.contains('ms-row')){ if(n.style.display!=='none')vis=true; n=n.nextElementSibling; } g.style.display=vis?'':'none'; });
  };

  async function workflowTab(){
    const b=$('acBody');
    b.innerHTML='<div class="loader"><div class="spin"></div></div>';
    try{ WF_PEOPLE=await people(); }catch(e){ WF_PEOPLE=[]; }
    await wfRenderList();
  }

  async function wfRenderList(){
    const b=$('acBody');
    let flows=[], stepCounts={};
    try{ const {data}=await ACC().from('flows').select('*').order('id',{ascending:false}); flows=data||[]; }
    catch(e){ toast('Could not load workflows: '+((e&&e.message)||e),'err'); }
    try{ const {data}=await ACC().from('flow_steps').select('flow_id'); (data||[]).forEach(function(s){ stepCounts[s.flow_id]=(stepCounts[s.flow_id]||0)+1; }); }catch(e){}
    const cards=flows.map(function(f){
      const n=stepCounts[f.id]||0;
      const trig=f.trigger_event?('<div class="wf-trig"><i class="fa-solid fa-bolt"></i> When: '+esc2(f.trigger_event)+'</div>'):'';
      return '<div class="ac-row" onclick="wfOpen('+f.id+')"><div class="ti"><div class="t">'+esc2(f.name||'Untitled workflow')+'</div>'+(f.description?'<div class="m">'+esc2(f.description)+'</div>':'')+trig+'</div><div class="rt"><span class="ac-chip">'+n+' step'+(n===1?'':'s')+'</span></div></div>';
    }).join('');
    const inner=flows.length?('<div class="ac-arch-list">'+cards+'</div>'):'<div class="ac-empty" style="cursor:default">No workflows yet — create your first one with the button above.</div>';
    b.innerHTML='<div style="display:flex;justify-content:flex-end;margin-bottom:12px"><button class="ac-btn primary" onclick="wfNew()"><i class="fa-solid fa-plus"></i> New Workflow</button></div>'
      +'<div class="ac-card"><div class="hd"><i class="fa-solid fa-diagram-project"></i> Workflows<span class="cnt">'+flows.length+'</span></div><div class="bd" style="height:auto;max-height:none;overflow:visible">'+inner+'</div></div>';
  }

  window.wfNew=function(){ wfForm(null); };
  window.wfEdit=function(id){ wfForm(id); };
  window.wfCancel=function(){ wfRenderList(); };

  function wfStepRowHtml(idx,step){
    step=step||{};
    const unit=(step.duration_unit||'days');
    return '<div class="wf-step">'
      +'<span class="wf-step-num">'+idx+'</span>'
      +'<div class="wf-step-fields">'
        +'<input class="ac-in wf-s-title" placeholder="What happens in this step?" value="'+esc2(step.title||'')+'">'
        +'<input class="ac-in wf-s-desc" placeholder="Write the Description" value="'+esc2(step.description||'')+'">'
        +'<div class="wf-step-sub">'
          +wfPersonPickerHtml(step.owner_email)
          +'<input class="ac-in wf-s-dur" type="number" min="1" placeholder="Duration" value="'+(step.duration_value!=null?step.duration_value:'')+'">'
          +'<select class="ac-in wf-s-unit">'
            +'<option value="hours"'+(unit==='hours'?' selected':'')+'>Hours</option>'
            +'<option value="days"'+(unit==='days'?' selected':'')+'>Days</option>'
            +'<option value="weeks"'+(unit==='weeks'?' selected':'')+'>Weeks</option>'
          +'</select>'
        +'</div>'
      +'</div>'
      +'<button class="ac-btn ic danger wf-s-del" title="Remove step" onclick="wfRemoveStep(this)"><i class="fa-solid fa-xmark"></i></button>'
    +'</div>';
  }

  async function wfForm(id){
    const b=$('acBody');
    b.innerHTML='<div class="loader"><div class="spin"></div></div>';
    if(!WF_PEOPLE){ try{ WF_PEOPLE=await people(); }catch(e){ WF_PEOPLE=[]; } }
    if(!window._wfPpWired){ document.addEventListener('click',function(e){ if(!e.target||!e.target.closest||!e.target.closest('.wf-pp')) document.querySelectorAll('.wf-pp.open').forEach(function(x){x.classList.remove('open');}); }); window._wfPpWired=true; }
    let flow={name:'',description:'',trigger_event:''}, steps=[];
    if(id){
      try{ const {data}=await ACC().from('flows').select('*').eq('id',id).maybeSingle(); if(data)flow=data; }catch(e){}
      try{ const {data}=await ACC().from('flow_steps').select('*').eq('flow_id',id).order('seq',{ascending:true}); steps=data||[]; }catch(e){}
    }
    if(!steps.length) steps=[{},{}]; // start with two blank step rows
    const stepsHtml=steps.map(function(s,i){ return wfStepRowHtml(i+1,s); }).join('');
    b.innerHTML='<div class="ac-card"><div class="hd"><i class="fa-solid fa-diagram-project"></i> '+(id?'Edit workflow':'Create a workflow')+'</div>'
      +'<div class="bd" style="height:auto;max-height:none;overflow:visible">'
      +'<div class="wf-form" data-id="'+(id||'')+'">'
        +'<label class="wf-lbl">Workflow name</label>'
        +'<input id="wfName" class="ac-in" placeholder="e.g. Invoice Processing" value="'+esc2(flow.name||'')+'">'
        +'<label class="wf-lbl">Triggering event <span class="wf-hint">— what starts this workflow</span></label>'
        +'<input id="wfTrigger" class="ac-in" placeholder="e.g. Receiving an invoice" value="'+esc2(flow.trigger_event||'')+'">'
        +'<label class="wf-lbl">Description <span class="wf-hint">— optional</span></label>'
        +'<input id="wfDesc" class="ac-in" placeholder="Short note about this workflow" value="'+esc2(flow.description||'')+'">'
        +'<div class="wf-steps-head"><label class="wf-lbl" style="margin:0">Steps <span class="wf-hint">— in order; each done by one person within a set time</span></label></div>'
        +'<div id="wfSteps">'+stepsHtml+'</div>'
        +'<button class="ac-btn" style="margin-top:4px" onclick="wfAddStep()"><i class="fa-solid fa-plus"></i> Add step</button>'
        +'<div class="wf-actions">'
          +'<button class="ac-btn" onclick="wfCancel()">Cancel</button>'
          +'<button class="ac-btn primary" onclick="wfSave()"><i class="fa-solid fa-floppy-disk"></i> Save workflow</button>'
        +'</div>'
      +'</div></div></div>';
  }

  window.wfAddStep=function(){
    const wrap=$('wfSteps'); if(!wrap)return;
    const idx=wrap.querySelectorAll('.wf-step').length+1;
    wrap.insertAdjacentHTML('beforeend', wfStepRowHtml(idx,{}));
  };
  window.wfRemoveStep=function(btn){
    const wrap=$('wfSteps'); const row=btn.closest('.wf-step'); if(!row||!wrap)return;
    if(wrap.querySelectorAll('.wf-step').length<=2){ toast('A workflow needs at least two steps','warn'); return; }
    row.remove(); wfRenumber();
  };
  function wfRenumber(){
    const wrap=$('wfSteps'); if(!wrap)return;
    [].slice.call(wrap.querySelectorAll('.wf-step')).forEach(function(r,i){ const n=r.querySelector('.wf-step-num'); if(n)n.textContent=(i+1); });
  }

  window.wfSave=async function(){
    const name=($('wfName')?$('wfName').value:'').trim();
    const trigger=($('wfTrigger')?$('wfTrigger').value:'').trim();
    const desc=($('wfDesc')?$('wfDesc').value:'').trim();
    if(!name){ toast('Please enter a workflow name','warn'); return; }
    if(!trigger){ toast('Please enter the triggering event','warn'); return; }
    const rows=[].slice.call(document.querySelectorAll('#wfSteps .wf-step'));
    if(rows.length<2){ toast('A workflow needs at least two steps','warn'); return; }
    const steps=[]; let bad='';
    rows.forEach(function(r,i){
      const t=((r.querySelector('.wf-s-title')||{}).value||'').trim();
      const desc=((r.querySelector('.wf-s-desc')||{}).value||'').trim();
      const person=(r.querySelector('.wf-s-person')||{}).value||'';
      const durRaw=(r.querySelector('.wf-s-dur')||{}).value;
      const unit=(r.querySelector('.wf-s-unit')||{}).value||'days';
      const dur=(durRaw!==''&&durRaw!=null)?parseInt(durRaw,10):NaN;
      if(!bad){
        if(!t) bad='Step '+(i+1)+': add a title (what happens in this step).';
        else if(!person) bad='Step '+(i+1)+': assign a person.';
        else if(!(dur>=1)) bad='Step '+(i+1)+': set a duration.';
      }
      steps.push({seq:steps.length+1,title:t,description:desc||null,owner_email:person||null,duration_value:(!isNaN(dur)?dur:null),duration_unit:unit});
    });
    if(bad){ toast(bad,'warn'); return; }
    const form=document.querySelector('.wf-form');
    const editId=(form&&form.getAttribute('data-id'))?Number(form.getAttribute('data-id')):null;
    try{
      let flowId=editId;
      if(editId){
        const {error}=await ACC().from('flows').update({name:name,description:desc||null,trigger_event:trigger,updated_at:new Date().toISOString()}).eq('id',editId); if(error)throw error;
        await ACC().from('flow_steps').delete().eq('flow_id',editId);
      }else{
        const {data,error}=await ACC().from('flows').insert({name:name,description:desc||null,trigger_event:trigger}).select().single(); if(error)throw error; flowId=data.id;
      }
      const stepRows=steps.map(function(s){ return {flow_id:flowId,seq:s.seq,title:s.title,description:s.description,owner_email:s.owner_email,duration_value:s.duration_value,duration_unit:s.duration_unit}; });
      const {error:se}=await ACC().from('flow_steps').insert(stepRows); if(se)throw se;
      toast('Workflow saved','ok');
      await wfRenderList();
    }catch(e){ toast('Could not save workflow: '+((e&&e.message)||e),'err'); }
  };

  window.wfOpen=async function(id){
    const b=$('acBody'); b.innerHTML='<div class="loader"><div class="spin"></div></div>';
    if(!WF_PEOPLE){ try{ WF_PEOPLE=await people(); }catch(e){ WF_PEOPLE=[]; } }
    let flow=null, steps=[];
    try{ const {data}=await ACC().from('flows').select('*').eq('id',id).maybeSingle(); flow=data; }catch(e){}
    try{ const {data}=await ACC().from('flow_steps').select('*').eq('flow_id',id).order('seq',{ascending:true}); steps=data||[]; }catch(e){}
    if(!flow){ toast('Workflow not found','err'); return wfRenderList(); }
    const durLabel=function(s){ if(s.duration_value==null||s.duration_value==='')return ''; const u=s.duration_unit||'days'; return s.duration_value+' '+(Number(s.duration_value)===1?u.replace(/s$/,''):u); };
    const stepItems=steps.map(function(s,i){
      const p=(WF_PEOPLE||[]).find(function(x){return eq(x.email,s.owner_email);});
      const dept=(p&&Array.isArray(p.depts)&&p.depts.length)?('<span class="wf-dept">'+esc2(p.depts.join(', '))+'</span>'):'';
      const who=s.owner_email
        ?('<span class="wf-who"><span class="wf-av" style="background:'+colorFor(s.owner_email)+'">'+esc2(iniOf(p?p.name:s.owner_email).toUpperCase())+'</span><span class="wf-who-nm">'+esc2(p?p.name:s.owner_email)+'</span>'+dept+'</span>')
        :'<span class="wf-who-nm" style="color:var(--slate)">Unassigned</span>';
      const dur=durLabel(s); const durHtml=dur?('<span class="wf-dur"><i class="fa-regular fa-clock"></i> '+esc2(dur)+'</span>'):'';
      return '<div class="wf-tl-item"><div class="wf-tl-num">'+(i+1)+'</div><div class="wf-tl-body"><div class="wf-tl-title">'+esc2(s.title||'')+'</div>'+(s.description?('<div class="wf-tl-desc">'+esc2(s.description)+'</div>'):'')+'<div class="wf-tl-meta">'+who+durHtml+'</div></div></div>';
    }).join('');
    b.innerHTML='<div style="display:flex;gap:8px;margin-bottom:12px"><button class="ac-btn" onclick="wfCancel()"><i class="fa-solid fa-arrow-left"></i> Back</button><div style="flex:1"></div><button class="ac-btn" onclick="wfEdit('+id+')"><i class="fa-solid fa-pen"></i> Edit</button><button class="ac-btn danger" onclick="wfDelete('+id+')"><i class="fa-solid fa-trash"></i> Delete</button></div>'
      +'<div class="ac-card"><div class="hd"><i class="fa-solid fa-diagram-project"></i> '+esc2(flow.name||'Workflow')+'</div><div class="bd" style="height:auto;max-height:none;overflow:visible">'
      +(flow.description?'<div class="wf-desc">'+esc2(flow.description)+'</div>':'')
      +'<div class="wf-trig-box"><i class="fa-solid fa-bolt"></i> <b>Trigger:</b> '+esc2(flow.trigger_event||'—')+'</div>'
      +'<div class="wf-timeline">'+(stepItems||'<div class="ac-empty" style="cursor:default">No steps yet</div>')+'</div>'
      +'</div></div>';
  };

  window.wfDelete=async function(id){
    if(!window.confirm('Delete this workflow and all its steps? This cannot be undone.'))return;
    try{
      try{ await ACC().from('flow_cases').delete().eq('flow_id',id); }catch(e){}
      await ACC().from('flow_steps').delete().eq('flow_id',id);
      const {error}=await ACC().from('flows').delete().eq('id',id); if(error)throw error;
      toast('Workflow deleted','ok');
      await wfRenderList();
    }catch(e){ toast('Could not delete workflow: '+((e&&e.message)||e),'err'); }
  };

  /* ---------- SCOREBOARD ---------- */
  async function scoreboardTab(){ const b=$('acBody'); let rows=[]; try{const {data}=await ACC().rpc('scoreboard');rows=data||[];}catch(e){} const medal=i=>i===0?'🥇':i===1?'🥈':i===2?'🥉':'<b style="color:var(--slate)">'+(i+1)+'</b>';
    rows=rows.map(r=>Object.assign({},r,{score:(r.tasks_completed||0)*1+(r.tasks_on_time||0)*1-(r.tasks_late||0)*1})).sort((a,b)=>b.score-a.score);
    b.innerHTML=`<div class="tp-card" style="padding:0"><div style="padding:14px 16px;border-bottom:1px solid var(--line)"><b>Scoreboard</b><div style="font-size:12px;color:var(--slate)">task completed +1 · on-time +1 · overdue −1 (declines automatically reverse the credit)</div></div><div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr><th>#</th><th>Person</th><th>Tasks</th><th>Sub</th><th>On-time</th><th>Overdue</th><th>Score</th></tr></thead><tbody>${rows.length?rows.map((r,i)=>`<tr><td>${medal(i)}</td><td><b>${esc2(r.full_name||r.email)}</b></td><td>${r.tasks_completed}</td><td>${r.checklist_items_done}</td><td style="color:#16a34a">${r.tasks_on_time}</td><td style="color:#dc2626">${r.tasks_late}</td><td style="font-weight:800">${r.score}</td></tr>`).join(''):'<tr><td colspan="7"><div class="ac-empty" style="cursor:default;border:0">No activity yet</div></td></tr>'}</tbody></table></div></div>`; }

  /* ---------- CALENDAR (Google-Calendar-inspired UI) ---------- */
  let GCAL_VIEW='month', GCAL_DATE=null, GCAL_MINI_MONTH=null, GCAL_Q='';
  let GCAL_FILTERS=new Set(['toMe','byMe','meeting']);
  let GCAL_LAST=null; // {byDate,list,asg}
  let GCAL_PANEL_ANCHOR=null; // date the slide-in panel's day-list is anchored to, or null when the panel shows something else (a task/meeting detail) or is closed
  function calShiftISO(iso,delta){ const d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()+delta); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function gcalWeekBounds(dateStr){
    const d=new Date(dateStr+'T00:00:00'); const off=(d.getDay()+6)%7;
    const mon=new Date(d); mon.setDate(d.getDate()-off);
    const sun=new Date(mon); sun.setDate(mon.getDate()+6);
    const iso=x=>x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
    return [iso(mon),iso(sun)];
  }
  async function gcalLoadData(){
    const [list,{tasks,asg}]=await Promise.all([people(), loadAll(), mtgLoadData()]).then(r=>[r[0],r[1]]);
    // Completed tasks never appear on the calendar (matches the old behaviour) — only active, dated tasks.
    const withDue=tasks.filter(t=>t.due_date && stOf(t)!=='approved');
    const byDate={};
    const add=(t,kind)=>{ (byDate[t.due_date]=byDate[t.due_date]||[]).push({t,kind}); };
    withDue.filter(t=>isMemb(t,asg)).forEach(t=>add(t,'toMe'));
    withDue.filter(t=>isOwner(t)&&!isSelf(t,asg)).forEach(t=>add(t,'byMe'));
    GCAL_LAST={byDate,list,asg};
    return GCAL_LAST;
  }
  function gcalVisibleItems(dateStr){
    const items=(GCAL_LAST&&GCAL_LAST.byDate[dateStr])||[];
    const mtgItems=(MTG_LIST||[]).filter(function(m){return mtgOccursOn(m,dateStr);}).map(function(m){return {t:m,kind:'meeting'};});
    return items.concat(mtgItems).filter(x=>{
      if(!GCAL_FILTERS.has(x.kind))return false;
      if(GCAL_Q && !String(x.t.title||'').toLowerCase().includes(GCAL_Q))return false;
      return true;
    });
  }
  function gcalEvColor(kind){ return kind==='toMe'?'#2563eb':(kind==='meeting'?'#ea580c':'#16a34a'); }
  function gcalItemKey(x){ return x.kind==='meeting' ? ('m'+x.t.id) : String(x.t.id); }
  window.gcalOpenItem=function(key){
    key=String(key);
    if(key.charAt(0)==='m'){ window.gcalOpenMeetingPanel(Number(key.slice(1))); }
    else { window.gcalOpenTask(Number(key)); }
  };

  /* ---- sidebar: mini month calendar ---- */
  function gcalMiniHtml(){
    if(!GCAL_MINI_MONTH) GCAL_MINI_MONTH=new Date();
    const y=GCAL_MINI_MONTH.getFullYear(), m=GCAL_MINI_MONTH.getMonth();
    const first=new Date(y,m,1);
    const startOffset=(first.getDay()+6)%7;
    const daysInMonth=new Date(y,m+1,0).getDate();
    const prevDays=new Date(y,m,0).getDate();
    const todayStr=todayISO();
    const label=first.toLocaleDateString('en-IN',{month:'long',year:'numeric'});
    let cells='';
    for(let i=0;i<startOffset;i++){ const dnum=prevDays-startOffset+i+1; cells+='<div class="gcal-mini-day other">'+dnum+'</div>'; }
    for(let d=1;d<=daysInMonth;d++){
      const dateStr=y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
      const has=!!(GCAL_LAST&&gcalVisibleItems(dateStr).length);
      const cls='gcal-mini-day'+(dateStr===todayStr?' today':'')+(dateStr===GCAL_DATE?' selected':'')+(has?' has':'');
      cells+='<div class="'+cls+'" onclick="gcalMiniPick(\''+dateStr+'\')">'+d+'</div>';
    }
    const trailing=(7-((startOffset+daysInMonth)%7))%7;
    for(let i=1;i<=trailing;i++) cells+='<div class="gcal-mini-day other">'+i+'</div>';
    const dow=['M','T','W','T','F','S','S'];
    return '<div class="gcal-mini"><div class="gcal-mini-head"><div class="gcal-mini-title">'+esc2(label)+'</div><div class="gcal-mini-nav"><button onclick="gcalMiniNav(-1)"><i class="fa-solid fa-chevron-left"></i></button><button onclick="gcalMiniNav(1)"><i class="fa-solid fa-chevron-right"></i></button></div></div><div class="gcal-mini-grid">'+dow.map(d=>'<div class="gcal-mini-dow">'+d+'</div>').join('')+cells+'</div></div>';
  }
  window.gcalMiniNav=function(delta){ if(!GCAL_MINI_MONTH)GCAL_MINI_MONTH=new Date(); const d=new Date(GCAL_MINI_MONTH); d.setMonth(d.getMonth()+delta); GCAL_MINI_MONTH=d; gcalRenderOnly(); };
  // Picking a date from the mini calendar always jumps straight to that day, whichever view (Year/Month/Week) you were on.
  window.gcalMiniPick=function(dateStr){ GCAL_DATE=dateStr; const d=new Date(dateStr+'T00:00:00'); GCAL_MINI_MONTH=new Date(d.getFullYear(),d.getMonth(),1); GCAL_VIEW='day'; gcalRenderOnly(); };

  /* ---- sidebar: quick filters ---- */
  function gcalFiltersHtml(){
    const rows=[['toMe','Assigned to me','#2563eb'],['byMe','Assigned by me','#16a34a']].map(function(f){
      return '<label class="gcal-filter-row"><input type="checkbox" '+(GCAL_FILTERS.has(f[0])?'checked':'')+' onchange="gcalToggleFilter(\''+f[0]+'\',this.checked)"><span class="gcal-filter-dot" style="background:'+f[2]+'"></span>'+f[1]+'</label>';
    }).join('');
    return '<div class="gcal-filters"><div class="gcal-filters-title">Quick filters</div>'+rows
      +'<label class="gcal-filter-row"><input type="checkbox" '+(GCAL_FILTERS.has('meeting')?'checked':'')+' onchange="gcalToggleFilter(\'meeting\',this.checked)"><span class="gcal-filter-dot" style="background:#ea580c"></span>Meetings</label>'
      +'</div>';
  }
  window.gcalToggleFilter=function(k,on){ if(on)GCAL_FILTERS.add(k); else GCAL_FILTERS.delete(k); gcalRenderOnly(); };

  /* ---- toolbar ---- */
  function gcalToolbarHtml(){
    let title='';
    if(GCAL_VIEW==='month'){ title=new Date(GCAL_DATE+'T00:00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'}); }
    else if(GCAL_VIEW==='week'){
      // Week is now a 10-day agenda list anchored on GCAL_DATE (2 days before it, itself, 7 days
      // after) rather than a Mon–Sun grid — the title reflects that span instead of a calendar week.
      const days=gcalListRange(GCAL_DATE), sd=new Date(days[0]+'T00:00:00'), ed=new Date(days[days.length-1]+'T00:00:00');
      title = sd.getMonth()===ed.getMonth() ? (sd.toLocaleDateString('en-IN',{month:'long'})+' '+sd.getDate()+'–'+ed.getDate()+', '+ed.getFullYear()) : (sd.toLocaleDateString('en-IN',{month:'short',day:'numeric'})+' – '+ed.toLocaleDateString('en-IN',{month:'short',day:'numeric',year:'numeric'}));
    }
    else if(GCAL_VIEW==='year'){ title=String(new Date(GCAL_DATE+'T00:00:00').getFullYear()); }
    else { title=new Date(GCAL_DATE+'T00:00:00').toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'}); } // day
    const views=[['day','Day'],['week','Week'],['month','Month'],['year','Year']];
    // Week's list is anchored on the chosen date, not paged — Prev/Next don't apply there (pick a new
    // date instead, via the mini calendar, Month, or Year), so they're disabled in that view.
    const weekNavDisabled = GCAL_VIEW==='week';
    return '<div class="gcal-toolbar">'
      +'<div class="gcal-tb-nav">'
      +'<button class="gcal-tbtn" onclick="gcalToday()">Today</button>'
      +'<button class="gcal-tbtn ic" '+(weekNavDisabled?'disabled':'onclick="gcalNav(-1)"')+' title="Previous"><i class="fa-solid fa-chevron-left"></i></button>'
      +'<button class="gcal-tbtn ic" '+(weekNavDisabled?'disabled':'onclick="gcalNav(1)"')+' title="Next"><i class="fa-solid fa-chevron-right"></i></button>'
      +'<div class="gcal-toolbar-title">'+esc2(title)+'</div>'
      +'</div>'
      +'<div class="gcal-search"><i class="fa-solid fa-magnifying-glass"></i><input placeholder="Search" value="'+esc2(GCAL_Q)+'" oninput="gcalSearch(this.value)"></div>'
      +'<div class="gcal-views">'+views.map(function(v){ return '<button class="gcal-view-btn '+(GCAL_VIEW===v[0]?'active':'')+'" onclick="gcalSetView(\''+v[0]+'\')">'+v[1]+'</button>'; }).join('')+'</div>'
      +'</div>';
  }
  window.gcalSetView=function(v){ GCAL_VIEW=v; gcalRenderOnly(); };
  window.gcalToday=function(){ GCAL_DATE=todayISO(); const d=new Date(); GCAL_MINI_MONTH=new Date(d.getFullYear(),d.getMonth(),1); gcalRenderOnly(); };
  window.gcalNav=function(delta){
    if(GCAL_VIEW==='week') return; // no-op — see the toolbar note above
    const d=new Date(GCAL_DATE+'T00:00:00');
    if(GCAL_VIEW==='month'){ d.setDate(1); d.setMonth(d.getMonth()+delta); }
    else if(GCAL_VIEW==='day'){ d.setDate(d.getDate()+delta); }
    else { d.setFullYear(d.getFullYear()+delta); } // year
    GCAL_DATE=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    GCAL_MINI_MONTH=new Date(d.getFullYear(),d.getMonth(),1);
    gcalRenderOnly();
  };
  window.gcalSearch=function(v){ GCAL_Q=(v||'').trim().toLowerCase(); const body=$('gcalBody'); if(body){body.innerHTML=gcalBodyHtml(); gcalWireDrag(body); gcalWireTimeDrag();} };

  /* ---- Month view ---- */
  function gcalMonthHtml(){
    const anchor=new Date(GCAL_DATE+'T00:00:00');
    const y=anchor.getFullYear(), m=anchor.getMonth();
    const first=new Date(y,m,1);
    const startOffset=(first.getDay()+6)%7;
    const daysInMonth=new Date(y,m+1,0).getDate();
    const prevDays=new Date(y,m,0).getDate();
    const todayStr=todayISO();
    const dow=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    let cells='';
    for(let i=0;i<startOffset;i++){ const dnum=prevDays-startOffset+i+1; cells+='<div class="gcal-mcell other"><div class="gcal-mnum">'+dnum+'</div></div>'; }
    for(let d=1;d<=daysInMonth;d++){
      const dateStr=y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
      const items=gcalVisibleItems(dateStr);
      // Show every task for the day (row height grows to fit) — the title itself still truncates with an ellipsis so long names don't widen the cell.
      const evs=items.map(function(x){
        const dragAttrs=x.kind!=='meeting'?(' data-task="'+x.t.id+'" data-date="'+dateStr+'"'):'';
        return '<div class="gcal-mev" style="background:'+gcalEvColor(x.kind)+'"'+dragAttrs+' onclick="event.stopPropagation();if(this._suppressClick){this._suppressClick=false;return;}gcalOpenItem(\''+gcalItemKey(x)+'\')" title="'+esc2(x.t.title)+'">'+esc2(x.t.title)+'</div>';
      }).join('');
      const cls='gcal-mcell'+(dateStr===todayStr?' today':'');
      cells+='<div class="'+cls+'" data-date="'+dateStr+'" onclick="gcalOpenDay(\''+dateStr+'\')"><div class="gcal-mnum">'+d+'</div><div class="gcal-mevents">'+evs+'</div></div>';
    }
    const trailing=(7-((startOffset+daysInMonth)%7))%7;
    for(let i=1;i<=trailing;i++) cells+='<div class="gcal-mcell other"><div class="gcal-mnum">'+i+'</div></div>';
    return '<div class="gcal-mgrid">'+dow.map(d=>'<div class="gcal-mdow">'+d+'</div>').join('')+cells+'</div>';
  }

  /* ---- Year view ---- */
  function gcalYearHtml(){
    const y=new Date(GCAL_DATE+'T00:00:00').getFullYear();
    const todayStr=todayISO();
    let months='';
    for(let mi=0;mi<12;mi++){
      const first=new Date(y,mi,1);
      const startOffset=(first.getDay()+6)%7;
      const daysInMonth=new Date(y,mi+1,0).getDate();
      const monthLabel=first.toLocaleDateString('en-IN',{month:'long'});
      let cells='';
      for(let i=0;i<startOffset;i++) cells+='<div class="gcal-mini-day other"></div>';
      for(let d=1;d<=daysInMonth;d++){
        const dateStr=y+'-'+String(mi+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
        const has=!!(GCAL_LAST&&gcalVisibleItems(dateStr).length);
        const cls='gcal-mini-day'+(dateStr===todayStr?' today':'')+(has?' has':'');
        cells+='<div class="'+cls+'" onclick="gcalYearPick(\''+dateStr+'\')">'+d+'</div>';
      }
      months+='<div class="gcal-year-month"><div class="gcal-year-month-title" onclick="gcalYearMonthOpen('+y+','+mi+')">'+esc2(monthLabel)+'</div><div class="gcal-mini-grid">'+cells+'</div></div>';
    }
    return '<div class="gcal-yeargrid">'+months+'</div>';
  }
  window.gcalYearPick=function(dateStr){ GCAL_DATE=dateStr; GCAL_VIEW='week'; const d=new Date(dateStr+'T00:00:00'); GCAL_MINI_MONTH=new Date(d.getFullYear(),d.getMonth(),1); gcalRenderOnly(); };
  window.gcalYearMonthOpen=function(y,mi){ GCAL_DATE=y+'-'+String(mi+1).padStart(2,'0')+'-01'; GCAL_VIEW='month'; GCAL_MINI_MONTH=new Date(y,mi,1); gcalRenderOnly(); };

  /* ---- Week view ---- */
  function gcalHourLabel(h){ return h===0?'12 AM':(h<12?h+' AM':(h===12?'12 PM':(h-12)+' PM')); }
  // Week is now a 10-day agenda list (2 days before GCAL_DATE, GCAL_DATE itself, 7 days after) instead
  // of a Mon–Sun grid — see gcalListHtml above. Prev/Next are disabled for this view (see toolbar).
  function gcalWeekHtml(){
    return gcalListHtml(GCAL_DATE);
  }

  /* ---- Day view ---- */
  // Tasks (no time-of-day) stay in the All-day strip. Meetings are positioned in the hour grid by
  // their actual start/end time and can be dragged vertically to change the time — see
  // gcalWireTimeDrag/gcalMeetingTimeDrop. Full rescheduling (a different date, or recurrence) goes
  // through the meeting panel's Reschedule button instead, since only one day is visible here.
  function gcalMtgMinutes(t){ if(!t)return 0; const p=String(t).split(':'); return (parseInt(p[0],10)||0)*60+(parseInt(p[1],10)||0); }
  // Classic day-view collision layout: meetings that overlap in time are grouped into a cluster
  // and each gets a column index within that cluster (+ the cluster's total column count), so
  // gcalMtgBlockHtml can render them side-by-side instead of stacked on top of each other.
  // Returns a map of meeting id -> {col, cols}.
  function gcalMtgLayout(items){
    const withRange=items.map(function(m){
      const s=gcalMtgMinutes(m.start_time);
      const e=m.end_time?gcalMtgMinutes(m.end_time):(s+45);
      return {m:m, s:s, e:Math.max(s+20,e)};
    }).sort(function(a,b){ return a.s-b.s || a.e-b.e; });
    const layout={};
    let cluster=[], clusterEnd=-Infinity;
    function flush(){
      if(!cluster.length) return;
      const colEnds=[];
      cluster.forEach(function(it){
        let col=0;
        while(colEnds[col]!=null && colEnds[col]>it.s) col++;
        colEnds[col]=it.e;
        it.col=col;
      });
      const cols=colEnds.length;
      cluster.forEach(function(it){ layout[it.m.id]={col:it.col,cols:cols}; });
      cluster=[]; clusterEnd=-Infinity;
    }
    withRange.forEach(function(it){
      if(cluster.length && it.s>=clusterEnd) flush();
      cluster.push(it);
      clusterEnd=Math.max(clusterEnd,it.e);
    });
    flush();
    return layout;
  }
  function gcalMtgBlockHtml(m,dateStr,pos){
    const startMin=gcalMtgMinutes(m.start_time);
    const endMin=m.end_time?gcalMtgMinutes(m.end_time):(startMin+45);
    const durMin=Math.max(20,endMin-startMin);
    const topPx=(startMin/60)*48;
    const hPx=Math.max(20,(durMin/60)*48);
    const cols=(pos&&pos.cols)||1, col=(pos&&pos.col)||0;
    const leftCss='calc(4px + (100% - 8px) * '+col+' / '+cols+')';
    const widthCss=cols>1?('calc((100% - 8px) / '+cols+' - 3px)'):'calc(100% - 8px)';
    const draggable=!m.recur_type||m.recur_type==='none';
    const dragAttrs=draggable?(' data-meeting-time="'+m.id+'" data-start="'+startMin+'" data-dur="'+durMin+'" data-date="'+dateStr+'"'):'';
    return '<div class="gcal-mtgblock" style="top:'+topPx+'px;height:'+hPx+'px;left:'+leftCss+';width:'+widthCss+';background:'+gcalEvColor('meeting')+'"'+dragAttrs+' onclick="if(this._suppressClick){this._suppressClick=false;return;}gcalOpenMeetingPanel('+m.id+')" title="'+esc2(m.title)+'"><b>'+esc2(m.title)+'</b><span>'+mtgFmtTime(m.start_time)+(m.end_time?(' – '+mtgFmtTime(m.end_time)):'')+'</span></div>';
  }
  function gcalDayHtml(){
    const dateStr=GCAL_DATE;
    const items=gcalVisibleItems(dateStr);
    const taskItems=items.filter(function(x){return x.kind!=='meeting';});
    const mtgItems=items.filter(function(x){return x.kind==='meeting';});
    const chips=taskItems.map(function(x){
      const dragAttrs=' data-task="'+x.t.id+'" data-date="'+dateStr+'"';
      return '<div class="gcal-mev" style="background:'+gcalEvColor(x.kind)+'"'+dragAttrs+' onclick="if(this._suppressClick){this._suppressClick=false;return;}gcalOpenItem(\''+gcalItemKey(x)+'\')" title="'+esc2(x.t.title)+'">'+esc2(x.t.title)+'</div>';
    }).join('');
    const hours=[]; for(let h=0;h<24;h++) hours.push(h);
    const hourLabels=hours.map(function(h){ return '<div class="gcal-hour">'+gcalHourLabel(h)+'</div>'; }).join('');
    const todayStr=todayISO();
    let dayInner=hours.map(function(){ return '<div class="gcal-hourline"></div>'; }).join('');
    if(dateStr===todayStr){ const now=new Date(); const pct=((now.getHours()*60+now.getMinutes())/1440)*100; dayInner+='<div class="gcal-nowline" style="top:'+pct+'%"><div class="gcal-nowdot"></div></div>'; }
    const mtgLayout=gcalMtgLayout(mtgItems.map(function(x){return x.t;}));
    dayInner+=mtgItems.map(function(x){ return gcalMtgBlockHtml(x.t,dateStr,mtgLayout[x.t.id]); }).join('');
    return '<div class="gcal-wrap">'
      +'<div class="gcal-allday"><div class="gcal-allday-label">All-day</div><div class="gcal-allday-cols" style="grid-template-columns:1fr"><div class="gcal-allday-col">'+(chips||'<span style="font-size:11.5px;color:#9ca3af">No tasks due</span>')+'</div></div></div>'
      +'<div class="gcal-timegrid"><div class="gcal-hours">'+hourLabels+'</div><div class="gcal-daycols" style="grid-template-columns:1fr"><div class="gcal-daycol" data-date="'+dateStr+'">'+dayInner+'</div></div></div>'
      +'</div>';
  }

  function gcalBodyHtml(){
    if(GCAL_VIEW==='month') return gcalMonthHtml();
    if(GCAL_VIEW==='week') return gcalWeekHtml();
    if(GCAL_VIEW==='year') return gcalYearHtml();
    return gcalDayHtml();
  }

  /* ---- shared 10-day agenda list: 2 days before the anchor date, the anchor date itself, and 7 days
     after (2+1+7 = 10 days). This single renderer backs two places: the Week view body, and the
     list that opens in the slide-in panel when a day is clicked in Month view. Both places wire the
     same drag-and-drop (gcalWireDrag) so tasks and one-time meetings can be dragged onto a different
     day's section to reschedule them. ---- */
  function gcalListRange(anchorDate){
    const days=[];
    for(let i=-2;i<=7;i++) days.push(calShiftISO(anchorDate,i));
    return days;
  }
  function gcalListDayHtml(dateStr,todayStr){
    const items=gcalVisibleItems(dateStr);
    const d=new Date(dateStr+'T00:00:00');
    const label=d.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'});
    const isToday=dateStr===todayStr;
    const rows=items.length?items.map(function(x){
      const oneTimeMeeting = x.kind==='meeting' && (!x.t.recur_type||x.t.recur_type==='none');
      const draggable = x.kind!=='meeting' || oneTimeMeeting;
      let dragAttrs='';
      if(draggable) dragAttrs = x.kind==='meeting' ? (' data-meeting="'+x.t.id+'" data-date="'+dateStr+'"') : (' data-task="'+x.t.id+'" data-date="'+dateStr+'"');
      const tag = x.kind==='meeting' ? (mtgFmtTime(x.t.start_time)+(x.t.end_time?(' – '+mtgFmtTime(x.t.end_time)):'')) : (x.kind==='toMe'?'To me':'By me');
      return '<div class="gcal-lrow"'+dragAttrs+' onclick="if(this._suppressClick){this._suppressClick=false;return;}gcalOpenItem(\''+gcalItemKey(x)+'\')" title="'+esc2(x.t.title)+'"><span class="gcal-lrow-dot" style="background:'+gcalEvColor(x.kind)+'"></span><span class="gcal-lrow-title">'+esc2(x.t.title)+'</span><span class="gcal-lrow-tag">'+esc2(tag)+'</span></div>';
    }).join(''):'<div class="gcal-lrow empty">Nothing scheduled</div>';
    return '<div class="gcal-lday'+(isToday?' today':'')+'" data-date="'+dateStr+'"><div class="gcal-lday-head">'+esc2(label)+(isToday?' <span class="gcal-lday-badge">Today</span>':'')+'</div><div class="gcal-lday-rows">'+rows+'</div></div>';
  }
  function gcalListHtml(anchorDate){
    const todayStr=todayISO();
    const days=gcalListRange(anchorDate);
    return '<div class="gcal-list-wrap"><div class="gcal-list">'+days.map(function(dateStr){ return gcalListDayHtml(dateStr,todayStr); }).join('')+'</div></div>';
  }

  /* ---- right details panel ---- */
  function gcalShowPanel(bodyHtml,tid){
    GCAL_PANEL_ANCHOR=null;
    const panel=$('gcalPanel'), backdrop=$('gcalBackdrop'); if(!panel)return;
    const bodyEl=panel.querySelector('.gcal-panel-body'); if(bodyEl)bodyEl.innerHTML=bodyHtml;
    const foot=panel.querySelector('.gcal-panel-foot');
    if(foot)foot.innerHTML = tid
      ? '<button class="ac-btn" onclick="gcalClosePanel()">Close</button><button class="ac-btn primary" onclick="navTo(\'tasks/task/'+tid+'\')"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open full task</button>'
      : '<button class="ac-btn" onclick="gcalClosePanel()">Close</button>';
    panel.classList.add('open'); if(backdrop)backdrop.classList.add('open');
  }
  window.gcalClosePanel=function(){ GCAL_PANEL_ANCHOR=null; const panel=$('gcalPanel'), backdrop=$('gcalBackdrop'); if(panel)panel.classList.remove('open'); if(backdrop)backdrop.classList.remove('open'); };
  // Clicking a day in Month view opens this same 10-day agenda list (anchored on the clicked day) in
  // the slide-in panel — not a single flat day list — and picking that day also becomes the calendar's
  // chosen date (so the mini calendar highlight, and Week view if you switch to it, follow along).
  function gcalRenderDayPanel(dateStr){
    GCAL_PANEL_ANCHOR=dateStr;
    const panel=$('gcalPanel'), backdrop=$('gcalBackdrop'); if(!panel)return;
    const label=new Date(dateStr+'T00:00:00').toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    const bodyEl=panel.querySelector('.gcal-panel-body');
    if(bodyEl){ bodyEl.innerHTML='<div class="gcal-panel-title">'+esc2(label)+'</div>'+gcalListHtml(dateStr); gcalWireDrag(bodyEl); }
    const foot=panel.querySelector('.gcal-panel-foot');
    if(foot)foot.innerHTML='<button class="ac-btn" onclick="gcalClosePanel()">Close</button>';
    panel.classList.add('open'); if(backdrop)backdrop.classList.add('open');
  }
  window.gcalOpenDay=function(dateStr){
    GCAL_DATE=dateStr;
    gcalRenderDayPanel(dateStr);
  };
  window.gcalOpenTask=function(tid){
    GCAL_PANEL_ANCHOR=null;
    if(!GCAL_LAST)return;
    let t=null,kind=null;
    for(const k in GCAL_LAST.byDate){ const hit=GCAL_LAST.byDate[k].find(function(x){return x.t.id===tid;}); if(hit){ t=hit.t; kind=hit.kind; break; } }
    if(!t)return;
    const selfTask=isSelf(t,GCAL_LAST.asg);
    const ownerName=nameOf(GCAL_LAST.list,t.delegator);
    const emails=(GCAL_LAST.asg&&GCAL_LAST.asg[t.id])||[];
    const memberNames=emails.filter(function(e){return !eq(e,t.delegator);}).map(function(e){return nameOf(GCAL_LAST.list,e);}).filter(Boolean).join(', ');
    let html='<div class="gcal-panel-title">'+esc2(t.title)+'</div>';
    if(t._projName) html+='<div class="gcal-panel-row"><i class="fa-solid fa-tag"></i> '+esc2(t._projName)+'</div>';
    html+='<div class="gcal-panel-row"><i class="fa-regular fa-circle-check"></i> '+stChip(t.status)+'</div>';
    html+='<div class="gcal-panel-row"><i class="fa-regular fa-calendar"></i> '+fmtDateY(t.due_date)+'</div>';
    html+='<div class="gcal-panel-row"><i class="fa-regular fa-user"></i> Owner: '+esc2(ownerName)+'</div>';
    if(!selfTask && memberNames) html+='<div class="gcal-panel-row"><i class="fa-solid fa-users"></i> Members: '+esc2(memberNames)+'</div>';
    html+='<div class="gcal-panel-row"><i class="fa-solid '+(kind==='toMe'?'fa-arrow-down':'fa-arrow-up')+'"></i> '+(kind==='toMe'?'Assigned to me':'Assigned by me')+'</div>';
    if(t.description) html+='<div class="gcal-panel-row"><i class="fa-solid fa-align-left"></i> <div>'+mdBold(t.description)+'</div></div>';
    gcalShowPanel(html, tid);
  };

  /* ---- Create button + floating action button ----
     Task-creation from the calendar is disabled for now — once Meetings exist this
     will be redesigned around them rather than quietly creating a plain Task. */
  window.gcalQuickAdd=function(){ window._mtgAutoOpenCreate=true; navTo('tasks/meetings'); };

  /* ---- drag & drop: dragging a task or one-time-meeting chip/row onto another day moves its date ----
     Uses pointer events (not native HTML5 DnD) to match the touch-friendly drag pattern already used
     elsewhere in this file (wirePointerDrag/wireSwapDrag). Works in three places: Month view's grid
     chips (.gcal-mev[data-task] — meetings aren't draggable there), and the shared 10-day agenda list
     used by Week view and Month's day-click panel (.gcal-lrow[data-task]/.gcal-lrow[data-meeting] —
     one-time meetings ARE draggable there, recurring ones aren't since "the date" isn't a single field
     for them). `root` scopes the query so it can be wired inside the slide-in panel too, not just #gcalBody.
     Mouse/pen: a small movement threshold distinguishes a drag from a normal click.
     Touch: a movement threshold alone doesn't work on phones — the very first finger move is
     indistinguishable from "the user is trying to scroll the calendar", so instant-arm-on-move would
     fight the page's native scrolling. Instead touch uses a long-press-to-pick-up gesture (like
     reordering a card in Trello/Asana's mobile apps): hold still for ~380ms to arm the drag; moving
     more than a few px before that timer fires cancels arming and lets the normal scroll happen.
     Exception: inside the Month grid itself, touch dragging is skipped entirely — the chips there are
     tiny mobile dots that are too fragile to drag reliably even with long-press. On mobile, tap a day
     in Month view instead to open the agenda-list panel, which has properly-sized draggable rows. */
  function gcalWireDrag(root){
    const body=root||$('gcalBody'); if(!body)return;
    body.querySelectorAll('.gcal-mev[data-task], .gcal-lrow[data-task], .gcal-lrow[data-meeting]').forEach(function(chip){
      if(chip._dragWired)return; chip._dragWired=true;
      const inMonthGrid=!!chip.closest('.gcal-mcell');
      chip.style.touchAction='none';
      chip.addEventListener('pointerdown',function(e){
        if(e.button!=null && e.button!==0)return;
        const isTouch=e.pointerType==='touch';
        if(isTouch && inMonthGrid) return; // Month grid dots: no touch drag — see note above.
        const startX=e.clientX, startY=e.clientY;
        const tid=chip.dataset.task!=null?Number(chip.dataset.task):null;
        const mid=chip.dataset.meeting!=null?Number(chip.dataset.meeting):null;
        const fromDate=chip.dataset.date;
        let armed=false, curTarget=null, longPressTimer=null;
        function arm(){
          if(armed)return;
          armed=true; window._dragging=true;
          chip.classList.remove('gcal-armed'); chip.classList.add('gcal-dragging');
          try{ if(isTouch && navigator.vibrate) navigator.vibrate(12); }catch(_e){}
        }
        function clearTimer(){ if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer=null; chip.classList.remove('gcal-armed'); } }
        function onMove(ev){
          const dx=ev.clientX-startX, dy=ev.clientY-startY;
          if(!armed){
            if(isTouch){
              // Waiting on the long-press timer — real finger travel means "scrolling", not "holding".
              if(Math.abs(dx)>10||Math.abs(dy)>10) clearTimer();
              return;
            }
            if(Math.abs(dx)>6||Math.abs(dy)>6){ arm(); }
            else return;
          }
          ev.preventDefault();
          const el=document.elementFromPoint(ev.clientX,ev.clientY);
          let cell=el&&el.closest&&el.closest('.gcal-mcell[data-date],.gcal-allday-col[data-date],.gcal-lday[data-date]');
          if(cell && !body.contains(cell)) cell=null; // dragging inside the slide-in panel shouldn't be able to drop onto the Month grid visible behind it
          if(curTarget&&curTarget!==cell) curTarget.classList.remove('gcal-drop-hover');
          if(cell){ cell.classList.add('gcal-drop-hover'); curTarget=cell; } else curTarget=null;
        }
        function onUp(){
          clearTimer();
          document.removeEventListener('pointermove',onMove);
          document.removeEventListener('pointerup',onUp);
          document.removeEventListener('pointercancel',onUp);
          chip.classList.remove('gcal-dragging','gcal-armed'); window._dragging=false;
          if(curTarget) curTarget.classList.remove('gcal-drop-hover');
          if(armed){
            // No pointer capture is taken, so the mouseup/click this gesture produces (if any) lands
            // on whatever element the pointer is actually over — not necessarily this chip. The flag
            // below is a belt-and-suspenders guard: the chip's own onclick (in the render template)
            // checks it first, in case the browser still resolves the click back onto the chip.
            chip._suppressClick=true;
            if(curTarget){
              const newDate=curTarget.dataset.date;
              if(newDate && newDate!==fromDate){
                if(tid!=null) gcalTaskDrop(tid,newDate);
                else if(mid!=null) gcalMeetingDateDrop(mid,newDate);
              }
            }
          }
        }
        document.addEventListener('pointermove',onMove);
        document.addEventListener('pointerup',onUp);
        document.addEventListener('pointercancel',onUp);
        if(isTouch){ chip.classList.add('gcal-armed'); longPressTimer=setTimeout(arm,380); }
      });
    });
  }
  // Lightweight post-drop refresh: rebuilds just #gcalBody (and the day-panel list, if one is open)
  // instead of gcalRenderOnly()'s full shell rebuild, which would tear down and re-close the slide-in
  // panel mid-gesture (its markup is regenerated closed every time). Full rebuilds are still fine (and
  // wanted, to close any open panel) for real navigation — Today/Nav/SetView — just not after a drop.
  async function gcalRefresh(){
    const body=$('gcalBody');
    if(body){ body.innerHTML=gcalBodyHtml(); gcalWireDrag(body); gcalWireTimeDrag(); }
    if(GCAL_PANEL_ANCHOR!=null) gcalRenderDayPanel(GCAL_PANEL_ANCHOR);
  }
  window.gcalTaskDrop=async function(tid,newDate){
    try{
      if(newDate<todayISO()){ toast('Cannot move a task to a date before today','err'); return; }
      const {data:old}=await ACC().from('ptasks').select('due_date').eq('id',tid).single();
      const prevDue=old?old.due_date:null;
      if((prevDue||'')===(newDate||''))return;
      await ACC().from('ptasks').update({due_date:newDate,overdue_emailed:false,due_emailed:false}).eq('id',tid);
      await ACC().from('ptask_activity').insert({task_id:tid,action:'due date changed',detail:'Due date '+(prevDue?fmtDateY(prevDue):'none')+' → '+fmtDateY(newDate)});
      await sysMsg(tid, prevDue?('changed the due date from '+fmtDateY(prevDue)+' to '+fmtDateY(newDate)):('set the due date to '+fmtDateY(newDate)));
      const _d=parseD(newDate), _t=new Date(); _t.setHours(0,0,0,0);
      if(_d&&_d<=_t){ try{ fetch('https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/overdue-mailer',{method:'POST',headers:{apikey:'sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n'}}); }catch(_e){} }
      toast('Moved to '+fmtDateY(newDate),'ok');
      await gcalLoadData();
      await gcalRefresh();
    }catch(e){ toast('Failed to move task','err'); }
  };
  // Dragging a one-time meeting onto another day's section changes its meeting_date. This resyncs
  // meeting_attendees (delete+reinsert, same as a normal edit) so the existing meeting-mailer trigger
  // re-emails attendees with the new date/time, and posts an in-app "meeting_update" notification too —
  // consistent with what a full edit via the meeting form already does on any change.
  window.gcalMeetingDateDrop=async function(mid,newDate){
    const m=(MTG_LIST||[]).find(function(x){return x.id===mid;});
    if(!m) return;
    if(m.recur_type && m.recur_type!=='none'){ toast('Recurring meetings can\'t be rescheduled by dragging — use Reschedule instead','err'); return; }
    if(newDate===m.meeting_date) return;
    try{
      await ACC().from('meetings').update({meeting_date:newDate}).eq('id',mid);
      const attendees=(MTG_ATT&&MTG_ATT[mid])||[];
      if(attendees.length){
        try{ await ACC().from('meeting_attendees').delete().eq('meeting_id',mid); }catch(e){}
        try{ await ACC().from('meeting_attendees').insert(attendees.map(function(e){return {meeting_id:mid,email:e};})); }catch(e){}
        try{
          const plist=await people(); const organizerName=nameOf(plist,me());
          const when=fmtDateY(newDate)+' · '+mtgFmtTime(m.start_time)+(m.end_time?(' – '+mtgFmtTime(m.end_time)):'');
          await ACC().from('notifications').insert(attendees.map(function(e){return {recipient:e,kind:'meeting_update',title:'Meeting rescheduled: '+m.title,body:when+' — updated by '+organizerName};}));
        }catch(e){}
      }
      toast('Meeting moved to '+fmtDateY(newDate),'ok');
      if(m.mode==='online'){ await mtgSyncGoogle(mid,'sync'); }
      await gcalLoadData();
      await gcalRefresh();
    }catch(e){ toast('Failed to move meeting','err'); }
  };
  /* ---- Day view: dragging a meeting block vertically changes its time ----
     Vertical-only (only one day is visible in Day view, so there's nothing to drop onto to change the
     date — that goes through the Reschedule button instead). Same touch-long-press vs mouse-threshold
     split as gcalWireDrag, but repositions the block live instead of highlighting a drop target. */
  function gcalWireTimeDrag(){
    const body=$('gcalBody'); if(!body)return;
    body.querySelectorAll('.gcal-mtgblock[data-meeting-time]').forEach(function(block){
      if(block._dragWired)return; block._dragWired=true;
      block.addEventListener('pointerdown',function(e){
        if(e.button!=null && e.button!==0)return;
        const isTouch=e.pointerType==='touch';
        const startY=e.clientY;
        const mid=Number(block.dataset.meetingTime), origStart=Number(block.dataset.start), dur=Number(block.dataset.dur);
        const origTop=parseFloat(block.style.top)||0;
        const PX_PER_MIN=48/60;
        let armed=false, longPressTimer=null, deltaMin=0;
        function arm(){ if(armed)return; armed=true; window._dragging=true; block.classList.add('gcal-dragging'); try{ if(isTouch&&navigator.vibrate) navigator.vibrate(12); }catch(_e){} }
        function clearTimer(){ if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer=null; } }
        function onMove(ev){
          const dy=ev.clientY-startY;
          if(!armed){
            if(isTouch){ if(Math.abs(dy)>10) clearTimer(); return; }
            if(Math.abs(dy)>6){ arm(); } else return;
          }
          ev.preventDefault();
          let newStart=origStart+Math.round(dy/PX_PER_MIN/15)*15;
          newStart=Math.max(0,Math.min(1440-dur,newStart));
          deltaMin=newStart-origStart;
          block.style.top=(origTop+deltaMin*PX_PER_MIN)+'px';
        }
        function finish(){
          clearTimer();
          document.removeEventListener('pointermove',onMove);
          document.removeEventListener('pointerup',onUp);
          document.removeEventListener('pointercancel',onUp);
          block.classList.remove('gcal-dragging'); window._dragging=false;
          if(armed && deltaMin!==0){
            block._suppressClick=true;
            const fmt=function(m){ return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); };
            gcalMeetingTimeDrop(mid, fmt(origStart+deltaMin), fmt(origStart+deltaMin+dur));
          } else if(armed){
            block.style.top=origTop+'px';
          }
        }
        function onUp(){ finish(); }
        document.addEventListener('pointermove',onMove);
        document.addEventListener('pointerup',onUp);
        document.addEventListener('pointercancel',onUp);
        if(isTouch){ longPressTimer=setTimeout(arm,380); }
      });
    });
  }
  window.gcalMeetingTimeDrop=async function(mid,newStart,newEnd){
    try{
      await ACC().from('meetings').update({start_time:newStart,end_time:newEnd}).eq('id',mid);
      toast('Meeting time updated','ok');
      const m=(MTG_LIST||[]).find(function(x){return x.id===mid;});
      if(m&&m.mode==='online'){ await mtgSyncGoogle(mid,'sync'); }
      await gcalLoadData();
      await gcalRefresh();
    }catch(e){ toast('Failed to update meeting time','err'); }
  };

  /* ---- shell / entry point ---- */
  function gcalRenderOnly(){
    const b=$('acBody'); if(!b)return;
    GCAL_PANEL_ANCHOR=null; // this always rebuilds the panel fresh and closed — don't let a stale anchor reopen it later
    b.innerHTML='<div class="gcal-shell">'
      +'<div class="gcal-sidebar">'+gcalMiniHtml()+gcalFiltersHtml()+'</div>'
      +'<div class="gcal-main">'+gcalToolbarHtml()+'<div class="gcal-body" id="gcalBody">'+gcalBodyHtml()+'</div></div>'
      +'</div>'
      +'<div class="gcal-backdrop" id="gcalBackdrop" onclick="gcalClosePanel()"></div>'
      +'<div class="gcal-panel" id="gcalPanel"><div class="gcal-panel-head"><b>Details</b><div class="x" onclick="gcalClosePanel()"><i class="fa-solid fa-xmark"></i></div></div><div class="gcal-panel-body"></div><div class="gcal-panel-foot"></div></div>'
      +'<button class="gcal-fab" onclick="gcalQuickAdd()" title="Schedule a meeting"><i class="fa-solid fa-plus"></i></button>';
    gcalWireDrag($('gcalBody'));
    gcalWireTimeDrag();
  }
  async function calendarTab(){
    if(!GCAL_DATE) GCAL_DATE=todayISO();
    if(!GCAL_MINI_MONTH){ const d=new Date(GCAL_DATE+'T00:00:00'); GCAL_MINI_MONTH=new Date(d.getFullYear(),d.getMonth(),1); }
    await gcalLoadData();
    gcalRenderOnly();
  }

  /* ---------- MEETINGS ---------- */
  let MTG_LIST=[], MTG_ATT={}, MTG_PPL=[];
  let GOOGLE_CONNECTED=null;
  let MTG_GROUP='all';
  function mtgDurationMinutes(start,end){
    if(!start||!end) return null;
    const sp=String(start).split(':'), ep=String(end).split(':');
    let mins=(Number(ep[0])*60+Number(ep[1]))-(Number(sp[0])*60+Number(sp[1]));
    if(mins<0) mins+=1440;
    return mins;
  }
  function mtgLogTimeLabel(log){
    const mins=mtgDurationMinutes(log.scheduled_start,log.scheduled_end);
    const range=mtgFmtTime(log.scheduled_start)+(log.scheduled_end?(' – '+mtgFmtTime(log.scheduled_end)):'');
    return range+(mins?(' ('+mins+' min)'):'');
  }
  function mtgFmtTime(t){
    if(!t)return '';
    const parts=String(t).split(':'); let h=parseInt(parts[0],10); const mnt=parts[1]||'00';
    if(isNaN(h))return '';
    const ap=h>=12?'PM':'AM'; let h12=h%12; if(h12===0)h12=12;
    return h12+':'+mnt+' '+ap;
  }
  function mtgOrdinalSuffix(n){ n=Number(n); const s=['th','st','nd','rd'], v=n%100; return s[(v-20)%10]||s[v]||s[0]; }
  function mtgModeLabel(m){ return m.mode==='offline' ? 'Offline' : 'Online'; }
  function mtgRecurLabel(m){
    const rt=m.recur_type||'none';
    if(rt==='daily')return 'Daily';
    if(rt==='weekly'){ const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; return 'Weekly · '+(days[m.recur_day]||''); }
    if(rt==='monthly')return 'Monthly · '+m.recur_date+mtgOrdinalSuffix(m.recur_date);
    return null;
  }
  // Does this meeting occur on the given yyyy-mm-dd date? Used by the Calendar tab so
  // recurring meetings (daily/weekly/monthly) show up on every date they apply to,
  // without pre-expanding every occurrence up front.
  function mtgOccursOn(m,dateStr){
    const rt=m.recur_type||'none';
    if(rt==='daily')return true;
    if(rt==='weekly')return new Date(dateStr+'T00:00:00').getDay()===m.recur_day;
    if(rt==='monthly')return new Date(dateStr+'T00:00:00').getDate()===Number(m.recur_date);
    return m.meeting_date===dateStr;
  }
  // One-time meetings whose end time has already passed today are hidden from the Today/All
  // view immediately (the backend cron still actually deletes/archives the row within a minute —
  // this just avoids the meeting sitting there looking "stuck" in the gap before that runs).
  // Recurring meetings are never hidden this way — they're always meant to stay visible.
  function mtgEndedToday(m){
    // A meeting is never hidden from the active list on the basis of the clock. It stays visible
    // until it's actually closed out — online on real Google Meet activity, offline when the
    // organizer records it in-app — and once its scheduled day has fully passed with nothing
    // logged, the daily archive job moves it out as 'not_held' / 'not_marked_done'. So a meeting
    // whose scheduled time slipped by (e.g. rescheduled but not updated) never silently vanishes.
    return false;
  }
  function mtgAllAttendees(m){
    const set=[m.created_by].concat(MTG_ATT[m.id]||[]);
    const seen={}, out=[];
    set.forEach(function(e){ const k=String(e||'').toLowerCase(); if(k&&!seen[k]){ seen[k]=true; out.push(k); } });
    return out;
  }
  // Sort key used within every group: recurring meetings float to the top (they're
  // always "live"), then one-time meetings in chronological order.
  function mtgSortKey(m){
    const rt=m.recur_type||'none';
    return rt!=='none' ? ('0'+String(m.start_time||'')) : ('1'+String(m.meeting_date||'9999-99-99')+String(m.start_time||''));
  }
  // Splits a list of meetings into Today / Tomorrow / This Week (the remaining days of the
  // week after tomorrow). A daily-recurring meeting occurs every one of those remaining days —
  // rather than listing it once per day (spammy), it's shown ONCE in "This Week" with a
  // _weekCount attached (how many more times it occurs this week) for the card to badge.
  function mtgDayBuckets(items){
    const todayS=istTodayISO(), tomS=calShiftISO(todayS,1), weekEnd=gcalWeekBounds(todayS)[1]; // Kolkata-anchored, matches mtgEndedToday
    const today=[], tomorrow=[], week=[];
    items.forEach(function(m){
      if(mtgOccursOn(m,todayS)) today.push(m);
      if(mtgOccursOn(m,tomS)) tomorrow.push(m);
      if((m.recur_type||'none')==='daily'){
        let d=calShiftISO(tomS,1), count=0;
        while(d<=weekEnd){ count++; d=calShiftISO(d,1); }
        if(count>0){ m._weekCount=count; week.push(m); }
      } else {
        let d=calShiftISO(tomS,1), inWeek=false;
        while(d<=weekEnd){ if(mtgOccursOn(m,d)){ inWeek=true; break; } d=calShiftISO(d,1); }
        if(inWeek) week.push(m);
      }
    });
    return [
      {label:'Today',items:today},
      {label:'Tomorrow',items:tomorrow},
      {label:'This Week',items:week}
    ].filter(function(g){return g.items.length;});
  }
  // Applies the Today/Tomorrow/This-Week split within one already-filtered category, prefixing
  // each resulting section's label with the category name (e.g. "Online — Tomorrow").
  function mtgApplyDayBuckets(catLabel,items){
    return mtgDayBuckets(items).map(function(b){ return {label:catLabel+' — '+b.label,items:b.items}; });
  }
  // Builds the section list for the currently-selected group tab (All / Mode / Recurring /
  // Participants). Every tab follows the same Today/Tomorrow/This-Week rule. Categories (and
  // day-buckets within them) with zero meetings are dropped entirely.
  function mtgGroupedSections(group){
    // Hide one-time meetings that already ended today from every group view (not just "All") —
    // otherwise a meeting that's already vanished from All can still show up under Mode/
    // Recurring/Participants until the backend cron actually deletes the row.
    const list=(MTG_LIST||[]).filter(function(m){ return !mtgEndedToday(m); });
    if(group==='all'){
      return mtgDayBuckets(list);
    }
    if(group==='recurring'){
      const cats=[['none','One-Time'],['daily','Daily'],['weekly','Weekly'],['monthly','Monthly']];
      let out=[]; cats.forEach(function(c){ out=out.concat(mtgApplyDayBuckets(c[1],list.filter(function(m){return (m.recur_type||'none')===c[0];}))); });
      return out;
    }
    if(group==='participants'){
      const byPerson={};
      list.forEach(function(m){ mtgAllAttendees(m).forEach(function(e){ (byPerson[e]=byPerson[e]||[]).push(m); }); });
      const emails=Object.keys(byPerson);
      emails.sort(function(a,b){ return nameOf(MTG_PPL||[],a).localeCompare(nameOf(MTG_PPL||[],b)); });
      let out=[]; emails.forEach(function(e){ out=out.concat(mtgApplyDayBuckets(nameOf(MTG_PPL||[],e),byPerson[e])); });
      return out;
    }
    // mode (default)
    const cats=[['online','Online'],['offline','Offline']];
    let out=[]; cats.forEach(function(c){ out=out.concat(mtgApplyDayBuckets(c[1],list.filter(function(m){return m.mode===c[0];}))); });
    return out;
  }
  async function mtgLoadData(){
    const my=me();
    let mine=[],invited=[];
    // These used to fail silently (empty catch) — if a session/token issue on a specific
    // browser ever causes one of these calls to error, that showed up as "nothing in any tab"
    // with zero clue why. Now it surfaces a toast instead of pretending the list is just empty.
    try{ const {data,error}=await ACC().from('meetings').select('*').eq('created_by',my); if(error)throw error; mine=data||[]; }catch(e){ toast('Could not load your meetings: '+((e&&e.message)||e),'err'); }
    try{
      const {data:attRows,error:attErr}=await ACC().from('meeting_attendees').select('meeting_id').eq('email',my);
      if(attErr)throw attErr;
      const ids=[...new Set((attRows||[]).map(function(r){return r.meeting_id;}))];
      if(ids.length){ const {data,error}=await ACC().from('meetings').select('*').in('id',ids); if(error)throw error; invited=data||[]; }
    }catch(e){ toast('Could not load meetings you\'re invited to: '+((e&&e.message)||e),'err'); }
    const map={}; mine.concat(invited).forEach(function(m){ map[m.id]=m; });
    const list=Object.values(map);
    const ids=list.map(function(m){return m.id;});
    const attMap={};
    if(ids.length){
      try{ const {data:allAtt}=await ACC().from('meeting_attendees').select('*').in('meeting_id',ids); (allAtt||[]).forEach(function(a){ (attMap[a.meeting_id]=attMap[a.meeting_id]||[]).push(a.email); }); }catch(e){}
    }
    MTG_LIST=list; MTG_ATT=attMap;
    MTG_PPL=await people();
    return {list,attMap};
  }
  // Google Calendar/Meet integration: each user connects their own Google account once
  // (per-user OAuth, see google-oauth-start/callback edge functions); acc.google_connections
  // is a safe view (email + connected_at only, no tokens) used just to show connect status.
  async function mtgCheckGoogleConnected(){
    try{ const {data}=await ACC().from('google_connections').select('email').eq('email',me()).maybeSingle(); GOOGLE_CONNECTED=!!data; }
    catch(e){ GOOGLE_CONNECTED=false; }
  }
  function mtgGoogleStatusHtml(){
    if(GOOGLE_CONNECTED===true) return '<span class="mtg-gstatus connected"><i class="fa-brands fa-google"></i> Connected to Google</span>';
    if(GOOGLE_CONNECTED===false) return '<button class="mtg-gstatus connect" onclick="googleConnect()"><i class="fa-brands fa-google"></i> Connect Google</button>';
    return '';
  }
  window.googleConnect=function(){
    location.href='https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/google-oauth-start?email='+encodeURIComponent(me());
  };
  // Attendee picker is restricted to people who've connected Google (per user decision) — everyone
  // in this org is domain-restricted already (acc.user_profile only ever has thejaingroup.com
  // accounts), so this is purely about connection status, not domain.
  async function mtgConnectedEmails(){
    try{ const {data}=await ACC().from('google_connections').select('email'); return new Set((data||[]).map(function(r){return String(r.email||'').toLowerCase();})); }
    catch(e){ return new Set(); }
  }
  // Fires the real Calendar/Meet API call for a meeting (create/update/cancel). Silently
  // no-ops (connected:false) if the organizer hasn't connected Google yet — the meeting still
  // saves normally either way, this just skips getting a real meet_link/google_event_id.
  async function mtgSyncGoogle(meetingId,action){
    try{
      const {data:{session}}=await sb.auth.getSession();
      await fetch('https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/google-calendar-sync',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+((session&&session.access_token)||''),'apikey':SUPABASE_KEY},
        body:JSON.stringify({meeting_id:meetingId,action:action||'sync'})
      });
    }catch(e){}
  }
  function mtgAvatars(emails){
    if(!emails||!emails.length)return '';
    return '<span class="mtg-avatars">'+emails.slice(0,4).map(function(e){
      const nm=nameOf(MTG_PPL||[],e);
      return '<span class="mtg-avatar" style="background:'+colorFor(e)+'" title="'+esc2(nm)+'">'+esc2(iniOf(nm).toUpperCase())+'</span>';
    }).join('')+(emails.length>4?'<span class="mtg-avatar" style="background:#94a3b8">+'+(emails.length-4)+'</span>':'')+'</span>';
  }
  function mtgCard(m,weekCount){
    const modeColor = m.mode==='offline' ? '#64748b' : '#2563eb';
    const people2=mtgAllAttendees(m);
    const rt=m.recur_type||'none';
    const dateLbl = rt==='none' ? (fmtDate(m.meeting_date)+', ') : '';
    const timeLabel=dateLbl+mtgFmtTime(m.start_time)+(m.end_time?(' – '+mtgFmtTime(m.end_time)):'');
    const recurLbl=mtgRecurLabel(m);
    const whereHtml = m.mode==='offline' ? '<i class="fa-solid fa-people-group"></i> Offline' : '<i class="fa-solid fa-video"></i> Online';
    let join;
    if(m.mode==='online' && m.meet_link) join='<a class="mtg-join" href="'+esc2(m.meet_link)+'" target="_blank" rel="noopener">Join</a>';
    else if(m.mode==='offline') join='<span class="mtg-join ghost">Offline</span>';
    else join='<button class="mtg-join disabled" disabled title="No link added yet">Join</button>';
    const mine = eq(m.created_by,me());
    const isRecurring = !!(m.recur_type&&m.recur_type!=='none');
    const editBtn = mine ? '<button class="mtg-del" onclick="event.stopPropagation();mtgOpenCreate('+m.id+')" title="Edit meeting"><i class="fa-solid fa-pen"></i></button>' : '';
    const delBtn = mine ? '<button class="mtg-del" onclick="event.stopPropagation();mtgCancelAsk('+m.id+')" title="Cancel meeting"><i class="fa-solid fa-trash"></i></button>' : '';
    // Recurring meetings: clicking anywhere on the free space of the card opens its Logs
    // (past occurrences) — no separate Logs button needed. One-time meetings aren't clickable
    // here (they have no history yet; their completed record only exists after in Archive).
    const cardClick = isRecurring ? ' onclick="navTo(\'tasks/meetings/logs/'+m.id+'\')" style="cursor:pointer" title="View past occurrences"' : '';
    return '<div class="mtg-card"'+cardClick+'>'
      +'<div class="mtg-bar" style="background:'+modeColor+'"></div>'
      +'<div class="mtg-time">'+esc2(timeLabel)+'</div>'
      +'<div class="mtg-info"><div class="mtg-title">'+esc2(m.title)+(recurLbl?(' <span class="mtg-recur-tag"><i class="fa-solid fa-rotate"></i> '+esc2(recurLbl)+'</span>'):'')+(weekCount?(' <span class="mtg-recur-tag" style="color:#0369a1;background:#eff6ff">×'+weekCount+' more this week</span>'):'')+'</div><div class="mtg-meta">'+whereHtml+' · <span style="color:'+modeColor+';font-weight:600">'+mtgModeLabel(m)+'</span>'+mtgAvatars(people2)+'</div></div>'
      +'<div class="mtg-actions">'+join+editBtn+delBtn+'</div>'
      +'</div>';
  }
  function mtgDateFieldHtml(recur,m){
    const val = (m&&m.meeting_date)?m.meeting_date:'';
    if(recur==='daily') return '<label>Date</label><div class="mtg-static-hint">Repeats every day</div>';
    if(recur==='weekly'){
      const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const cur=(m&&m.recur_day!=null)?m.recur_day:1;
      return '<label>Day</label><select id="mtgRecurDay">'+days.map(function(d,i){return '<option value="'+i+'"'+(i===cur?' selected':'')+'>'+d+'</option>';}).join('')+'</select>';
    }
    if(recur==='monthly'){
      const cur=(m&&m.recur_date!=null)?m.recur_date:'';
      return '<label>Date of month</label><input type="number" id="mtgRecurDate" min="1" max="31" value="'+esc2(cur)+'" placeholder="e.g. 15">';
    }
    return '<label>Date</label><input type="date" id="mtgDate" min="'+todayISO()+'" value="'+esc2(val)+'">';
  }
  // No manual link field anymore — real Meet links are auto-created by mtgSyncGoogle on save,
  // shown here as a status line instead of an editable input.
  function mtgLinkFieldHtml(mode,m){
    if(mode!=='online')return '';
    if(GOOGLE_CONNECTED===true) return '<div class="mtg-auto-link"><i class="fa-brands fa-google"></i> A Google Meet link is created automatically — attendees just click Join.</div>';
    return '<div class="mtg-auto-link warn"><i class="fa-solid fa-triangle-exclamation"></i> Connect your Google account to auto-generate a Meet link for this meeting. <a href="#" onclick="event.preventDefault();googleConnect()">Connect Google</a></div>';
  }
  window.mtgRecurChange=function(){ const wrap=$('mtgDateWrap'); if(!wrap)return; wrap.innerHTML=mtgDateFieldHtml($('mtgRecur').value,null); mtgRefreshConflicts(); };
  window.mtgModeChange=function(){ const wrap=$('mtgLinkWrap'); if(!wrap)return; wrap.innerHTML=mtgLinkFieldHtml($('mtgMode').value,null); };
  window.mtgSetGroup=function(g){ MTG_GROUP=g; mtgRenderOnly(); };

  // ---- Attendee scheduling-conflict warning (non-blocking) ----
  // Represents this meeting's next real occurrence as a single yyyy-mm-dd date, so a
  // recurring meeting can still be checked against other people's schedules without having
  // to enumerate every future occurrence.
  function mtgOwnRepDate(recur,meeting_date,recur_day,recur_date){
    const t=todayISO();
    if(recur==='none') return meeting_date||null;
    if(recur==='daily') return t;
    if(recur==='weekly'){
      const rd=Number(recur_day);
      for(let i=0;i<7;i++){ const d=calShiftISO(t,i); if(new Date(d+'T00:00:00').getDay()===rd) return d; }
      return t;
    }
    if(recur==='monthly'){
      const rd=Number(recur_date);
      for(let i=0;i<31;i++){ const d=calShiftISO(t,i); if(new Date(d+'T00:00:00').getDate()===rd) return d; }
      return t;
    }
    return t;
  }
  // Pulls in every OTHER meeting that any of the given people organize or attend — MTG_LIST only
  // has the current user's own meetings, so this is a separate query (RLS on acc.meetings/
  // meeting_attendees is wide open, same as everywhere else in this app, so it's safe to read
  // across people for this purpose). excludeId leaves out the meeting currently being edited.
  async function mtgConflictCandidates(emails,excludeId){
    const lowered=[...new Set((emails||[]).map(function(e){return String(e||'').toLowerCase();}))].filter(Boolean);
    if(!lowered.length) return [];
    let byCreator=[], attRows=[];
    try{ const r=await ACC().from('meetings').select('*').in('created_by',lowered); byCreator=(r&&r.data)||[]; }catch(e){}
    try{ const r=await ACC().from('meeting_attendees').select('meeting_id,email').in('email',lowered); attRows=(r&&r.data)||[]; }catch(e){}
    const ids=[...new Set(attRows.map(function(r){return r.meeting_id;}))];
    let byAttendee=[];
    if(ids.length){ try{ const r=await ACC().from('meetings').select('*').in('id',ids); byAttendee=(r&&r.data)||[]; }catch(e){} }
    const map={};
    byCreator.concat(byAttendee).forEach(function(m){ if(excludeId==null||m.id!==excludeId) map[m.id]=m; });
    return Object.values(map);
  }
  let MTG_CONFLICT_EDIT_ID=null, MTG_CONFLICT_GEN=0;
  function mtgClearConflictMarks(){
    const attBox=$('mtgAttBox'); if(attBox) attBox.querySelectorAll('.mtg-conflict-mark').forEach(function(n){n.remove();});
    const box=$('mtgConflictBox'); if(box) box.innerHTML='';
  }
  async function mtgRefreshConflicts(){
    const box=$('mtgConflictBox'), attBox=$('mtgAttBox');
    if(!box||!attBox) return;
    const emails=(typeof msGet==='function'?msGet('mtgAttBox'):[]).filter(function(e){return !eq(e,me());});
    const startEl=$('mtgStart'), start=startEl?startEl.value:'';
    if(!emails.length||!start){ mtgClearConflictMarks(); return; }
    const recur=$('mtgRecur')?$('mtgRecur').value||'none':'none';
    const meeting_date=$('mtgDate')?$('mtgDate').value:'';
    const recur_day=$('mtgRecurDay')?$('mtgRecurDay').value:null;
    const recur_date=$('mtgRecurDate')?$('mtgRecurDate').value:null;
    const end=$('mtgEnd')?$('mtgEnd').value:'';
    const repDate=mtgOwnRepDate(recur,meeting_date,recur_day,recur_date);
    if(!repDate){ mtgClearConflictMarks(); return; }
    const gen=++MTG_CONFLICT_GEN;
    const sMin=gcalMtgMinutes(start), eMin=end?gcalMtgMinutes(end):sMin+1;
    let candidates=[];
    try{ candidates=await mtgConflictCandidates(emails,MTG_CONFLICT_EDIT_ID); }catch(e){ return; }
    if(gen!==MTG_CONFLICT_GEN) return; // a newer check started after this one — drop this stale result
    const conflicts={};
    candidates.forEach(function(m){
      if(!mtgOccursOn(m,repDate)) return;
      const mS=gcalMtgMinutes(m.start_time), mE=m.end_time?gcalMtgMinutes(m.end_time):mS+45;
      if(!(sMin<mE && mS<eMin)) return;
      mtgAllAttendees(m).forEach(function(att){ (conflicts[att]=conflicts[att]||[]).push(m); });
    });
    mtgClearConflictMarks();
    const flagged=Object.keys(conflicts).filter(function(e){ return emails.some(function(x){return String(x).toLowerCase()===e;}); });
    if(!flagged.length) return;
    attBox.querySelectorAll('.ms-row').forEach(function(rowEl){
      const inp=rowEl.querySelector('input[type=checkbox]'); if(!inp) return;
      const val=String(inp.value||'').toLowerCase();
      if(conflicts[val]){
        const mark=document.createElement('span');
        mark.className='mtg-conflict-mark';
        mark.title='Conflicts with "'+conflicts[val][0].title+'"';
        mark.innerHTML='<i class="fa-solid fa-triangle-exclamation" style="color:#d97706"></i>';
        rowEl.appendChild(mark);
      }
    });
    const list=(typeof MTG_PPL!=='undefined'&&MTG_PPL)||[];
    const lines=flagged.map(function(e){
      const first=conflicts[e][0];
      const timeLbl=mtgFmtTime(first.start_time)+(first.end_time?(' – '+mtgFmtTime(first.end_time)):'');
      const extra=conflicts[e].length>1?(' +'+(conflicts[e].length-1)+' more'):'';
      return esc2(nameOf(list,e))+' already has "'+esc2(first.title)+'" ('+esc2(timeLbl)+') on '+esc2(repDate)+esc2(extra);
    });
    box.innerHTML='<div class="mtg-conflict-warn"><i class="fa-solid fa-triangle-exclamation"></i> '+lines.join('<br>')+'</div>';
  }
  function mtgConflictFieldHandler(e){
    const t=e.target; if(!t) return;
    if(t.closest && t.closest('#mtgAttBox')){ mtgRefreshConflicts(); return; }
    if(t.id && ['mtgStart','mtgEnd','mtgDate','mtgRecurDay','mtgRecurDate'].indexOf(t.id)!==-1) mtgRefreshConflicts();
  }
  function mtgWireConflictCheckOnce(){
    if(window._mtgConflictWired) return;
    const host=$('modalHost'); if(!host) return;
    host.addEventListener('change',mtgConflictFieldHandler);
    host.addEventListener('input',mtgConflictFieldHandler);
    window._mtgConflictWired=true;
  }
  // Start/End time are a single text field masked to 24-hour HH:MM (00–23 : 00–59) — one field,
  // no native AM/PM segment, consistent across every browser. Stored/read value stays "HH:MM".
  function mtgTimeVal(t){ if(!t)return''; const p=String(t).split(':'); if(p.length<2)return''; return String(parseInt(p[0],10)||0).padStart(2,'0')+':'+String(parseInt(p[1],10)||0).padStart(2,'0'); }
  window.mtgTimeMask=function(el){ const v=(el.value||'').replace(/[^0-9]/g,'').slice(0,4); el.value=(v.length>2)?(v.slice(0,2)+':'+v.slice(2)):v; };
  window.mtgTimeNorm=function(el){ const raw=(el.value||'').replace(/[^0-9]/g,''); if(!raw){ el.value=''; return; } let h,m; if(raw.length<=2){ h=raw; m='0'; } else { h=raw.slice(0,raw.length-2); m=raw.slice(-2); } h=Math.max(0,Math.min(23,parseInt(h,10)||0)); m=Math.max(0,Math.min(59,parseInt(m,10)||0)); el.value=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'); try{ if(typeof mtgRefreshConflicts==='function')mtgRefreshConflicts(); }catch(_){} };
  window.mtgOpenCreate=async function(id){
    const editing = id!=null;
    let m=null;
    if(editing){ m=(MTG_LIST||[]).find(function(x){return x.id===id;}); if(!m){toast('Meeting not found','err');return;} }
    const list=await people(); const my=me();
    const selAtt = editing ? (MTG_ATT[id]||[]).filter(function(e){return !eq(e,m.created_by);}) : [];
    const connected = await mtgConnectedEmails();
    const selSet = new Set(selAtt.map(function(e){return String(e||'').toLowerCase();}));
    // Only connected accounts are pickable going forward, but anyone already invited stays visible
    // and checked so editing/saving an older meeting never silently drops them.
    const pickable = list.filter(function(p){ const e=String(p.email||'').toLowerCase(); return !eq(p.email,my) && (connected.has(e) || selSet.has(e)); });
    const recurVal = m ? (m.recur_type||'none') : 'none';
    const modeVal = m ? (m.mode||'online') : 'online';
    const recurOpts=[['none','One-time'],['daily','Daily'],['weekly','Weekly'],['monthly','Monthly']];
    openModal('<div class="modal-head"><h3><i class="fa-solid fa-video"></i> '+(editing?'Edit Meeting':'Schedule Meeting')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
      +'<div class="modal-body frm">'
      +'<label>Title</label><input id="mtgTitle" placeholder="e.g. Weekly Marketing Sync" value="'+(m?esc2(m.title):'')+'">'
      +'<label>Recurring</label><select id="mtgRecur" onchange="mtgRecurChange()">'+recurOpts.map(function(o){return '<option value="'+o[0]+'"'+(o[0]===recurVal?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select>'
      +'<div class="two"><div><label>Mode</label><select id="mtgMode" onchange="mtgModeChange()"><option value="online"'+(modeVal==='online'?' selected':'')+'>Online</option><option value="offline"'+(modeVal==='offline'?' selected':'')+'>Offline</option></select></div><div id="mtgDateWrap">'+mtgDateFieldHtml(recurVal,m)+'</div></div>'
      +'<div class="two"><div><label>Start time <span style="color:var(--slate);font-weight:400">(24h)</span></label><input type="text" id="mtgStart" inputmode="numeric" maxlength="5" placeholder="HH:MM" value="'+(m?esc2(mtgTimeVal(m.start_time)):'')+'" oninput="mtgTimeMask(this)" onblur="mtgTimeNorm(this)"></div><div><label>End time <span style="color:var(--slate);font-weight:400">(optional, 24h)</span></label><input type="text" id="mtgEnd" inputmode="numeric" maxlength="5" placeholder="HH:MM" value="'+(m?esc2(mtgTimeVal(m.end_time)):'')+'" oninput="mtgTimeMask(this)" onblur="mtgTimeNorm(this)"></div></div>'
      +'<div id="mtgLinkWrap">'+mtgLinkFieldHtml(modeVal,m)+'</div>'
      +'<label>Attendees <span style="color:var(--slate);font-weight:400">(optional — only people who\'ve connected Google can be added)</span></label>'+msWidget('mtgAttBox',pickable,selAtt)
      +(pickable.length?'':'<p style="color:var(--slate);font-size:12.5px;margin:4px 0 0">Nobody else has connected their Google account yet.</p>')
      +'<div id="mtgConflictBox"></div>'
      +'</div>'
      +'<div class="modal-foot"><button class="ac-btn" onclick="closeModal()">Cancel</button><button class="ac-btn primary" id="mtgSaveBtn" onclick="mtgFormSave('+(editing?id:'null')+')"><i class="fa-solid fa-check"></i> '+(editing?'Save changes':'Schedule')+'</button></div>');
    MTG_CONFLICT_EDIT_ID = editing ? id : null;
    mtgWireConflictCheckOnce();
    mtgRefreshConflicts();
  };
  window.mtgFormSave=async function(id){
    const editing = id!=null;
    const title=($('mtgTitle').value||'').trim(); if(!title){toast('Enter a meeting title','err');return;}
    const recur=$('mtgRecur').value||'none';
    const mode=$('mtgMode').value||'online';
    let meeting_date=null, recur_day=null, recur_date=null;
    if(recur==='none'){ meeting_date=$('mtgDate')?$('mtgDate').value:''; if(!meeting_date){toast('Pick a date','err');return;} }
    else if(recur==='weekly'){ recur_day=$('mtgRecurDay')?Number($('mtgRecurDay').value):NaN; if(isNaN(recur_day)){toast('Pick a day','err');return;} }
    else if(recur==='monthly'){ recur_date=$('mtgRecurDate')?Number($('mtgRecurDate').value):0; if(!recur_date||recur_date<1||recur_date>31){toast('Enter a valid date of month (1–31)','err');return;} }
    let start=($('mtgStart').value||'').trim();
    if(!/^\d{1,2}:[0-5]\d$/.test(start)||parseInt(start,10)>23){ toast('Enter a start time as HH:MM (24-hour, 00–23)','err'); return; }
    start=mtgTimeVal(start); // always store zero-padded HH:MM — google-calendar-sync builds an RFC3339 string from this
    const endRaw=($('mtgEnd').value||'').trim();
    if(endRaw&&(!/^\d{1,2}:[0-5]\d$/.test(endRaw)||parseInt(endRaw,10)>23)){ toast('Enter the end time as HH:MM (24-hour, 00–23)','err'); return; }
    const end=endRaw?mtgTimeVal(endRaw):null;
    // Guard against scheduling a one-time meeting whose START time is already in the past —
    // checked against real Kolkata (IST) wall-clock time specifically (istTodayISO/istNowMinutes
    // above), not the browser's own clock/timezone, since every backend piece (cron functions,
    // google-meet-live-completion) assumes meeting_date+start_time/end_time are IST. Previously
    // this only checked end||start, so a meeting with a past start but a later end (e.g. start
    // already gone, end still ahead) slipped through; now the start time itself is validated.
    // Without this, acc.log_completed_meetings()'s grace-period fallback can still eventually
    // archive a meeting nobody ever actually joined, since as far as the backend can tell a
    // meeting whose scheduled window has passed with no real activity is a no-show.
    if(recur==='none'){
      const todayIst=istTodayISO();
      if(meeting_date<todayIst){
        toast('Pick a date that is today or later.','err');
        return;
      }
      if(meeting_date===todayIst){
        const sp=start.split(':'); const startMin=(Number(sp[0])||0)*60+(Number(sp[1])||0);
        if(startMin<=istNowMinutes()){
          toast('That start time is already in the past (IST) — pick a time later than now.','err');
          return;
        }
      }
    }
    const attendees=(typeof msGet==='function'?msGet('mtgAttBox'):[]).filter(function(e){return !eq(e,me());});
    const b=$('mtgSaveBtn'); if(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…';}
    const row={title:title,mode:mode,recur_type:recur,meeting_date:meeting_date,recur_day:recur_day,recur_date:recur_date,start_time:start,end_time:end};
    if(mode==='offline') row.meet_link=null; // real Meet links only ever exist for online meetings — clear any stale one if switched away from online
    let mtgId=id, err=null;
    if(editing){
      const {error}=await ACC().from('meetings').update(row).eq('id',id); err=error;
    } else {
      row.created_by=me();
      const {data,error}=await ACC().from('meetings').insert(row).select().single(); err=error; if(data)mtgId=data.id;
    }
    if(err){ toast(err.message,'err'); if(b){b.disabled=false;b.innerHTML='<i class="fa-solid fa-check"></i> '+(editing?'Save changes':'Schedule');} return; }
    try{ await ACC().from('meeting_attendees').delete().eq('meeting_id',mtgId); }catch(e){}
    if(attendees.length){ try{ await ACC().from('meeting_attendees').insert(attendees.map(function(e){return {meeting_id:mtgId,email:e};})); }catch(e){} }
    if(attendees.length){
      try{
        const plist=await people(); const organizerName=nameOf(plist,me());
        const when = recur==='none' ? (fmtDateY(meeting_date)+' · '+mtgFmtTime(start)+(end?(' – '+mtgFmtTime(end)):'')) : (recur.charAt(0).toUpperCase()+recur.slice(1)+' · '+mtgFmtTime(start)+(end?(' – '+mtgFmtTime(end)):''));
        const kind = editing?'meeting_update':'meeting';
        const titlePrefix = editing?'Meeting updated: ':'Meeting invite: ';
        const bodyTxt = editing?(when+' — updated by '+organizerName):(when+' — invited by '+organizerName);
        await ACC().from('notifications').insert(attendees.map(function(e){return {recipient:e,kind:kind,title:titlePrefix+title,body:bodyTxt};}));
      }catch(e){}
    }
    closeModal(); toast(editing?'Meeting updated':'Meeting scheduled','ok');
    if(mode==='online'){ await mtgSyncGoogle(mtgId,'sync'); }
    await mtgLoadData(); mtgRenderOnly();
  };
  window.mtgCancelAsk=function(id){
    openModal('<div class="modal-head"><h3><i class="fa-solid fa-triangle-exclamation" style="color:#dc2626"></i> Cancel meeting?</h3><span class="x" onclick="closeModal()">&times;</span></div>'
      +'<div class="modal-body"><p style="font-size:13.5px;color:var(--slate)">This removes the meeting for everyone invited. This can\'t be undone.</p></div>'
      +'<div class="modal-foot"><button class="ac-btn" onclick="closeModal()">Keep it</button><button class="ac-btn" style="background:#dc2626;border-color:#dc2626;color:#fff" onclick="mtgCancelDo('+id+')">Cancel meeting</button></div>');
  };
  window.mtgCancelDo=async function(id){
    const m=(MTG_LIST||[]).find(function(x){return x.id===id;});
    const attendees=(MTG_ATT&&MTG_ATT[id])||[];
    if(m&&m.mode==='online'&&m.google_event_id){ await mtgSyncGoogle(id,'cancel'); }
    try{ await ACC().from('meetings').delete().eq('id',id); }catch(e){}
    if(m&&attendees.length){
      try{ await ACC().from('notifications').insert(attendees.map(function(e){return {recipient:e,kind:'meeting_cancel',title:'Meeting cancelled: '+m.title,body:(m.recur_type&&m.recur_type!=='none'?'A recurring':fmtDateY(m.meeting_date))+' meeting was cancelled by the organizer.'};})); }catch(e){}
    }
    closeModal(); toast('Meeting cancelled','ok');
    await mtgLoadData(); mtgRenderOnly();
  };
  window.gcalOpenMeetingPanel=function(id){
    GCAL_PANEL_ANCHOR=null;
    const m=(MTG_LIST||[]).find(function(x){return x.id===id;}); if(!m)return;
    const modeColor = m.mode==='offline' ? '#64748b' : '#2563eb';
    const names=mtgAllAttendees(m).map(function(e){return nameOf(MTG_PPL&&MTG_PPL.length?MTG_PPL:(GCAL_LAST?GCAL_LAST.list:[]),e);}).filter(Boolean).join(', ');
    const recurLbl=mtgRecurLabel(m);
    let html='<div class="gcal-panel-title">'+esc2(m.title)+'</div>';
    html+='<div class="gcal-panel-row"><i class="fa-solid fa-circle" style="font-size:8px;color:'+modeColor+';margin-top:5px"></i> '+mtgModeLabel(m)+(recurLbl?(' · '+esc2(recurLbl)):'')+'</div>';
    if(m.recur_type==='none'||!m.recur_type) html+='<div class="gcal-panel-row"><i class="fa-regular fa-calendar"></i> '+fmtDateY(m.meeting_date)+' · '+mtgFmtTime(m.start_time)+(m.end_time?(' – '+mtgFmtTime(m.end_time)):'')+'</div>';
    else html+='<div class="gcal-panel-row"><i class="fa-regular fa-clock"></i> '+mtgFmtTime(m.start_time)+(m.end_time?(' – '+mtgFmtTime(m.end_time)):'')+'</div>';
    html+='<div class="gcal-panel-row"><i class="fa-solid '+(m.mode==='offline'?'fa-people-group':'fa-video')+'"></i> '+mtgModeLabel(m)+'</div>';
    if(names) html+='<div class="gcal-panel-row"><i class="fa-solid fa-users"></i> '+esc2(names)+'</div>';
    const panel=$('gcalPanel'), backdrop=$('gcalBackdrop'); if(!panel)return;
    const bodyEl=panel.querySelector('.gcal-panel-body'); if(bodyEl)bodyEl.innerHTML=html;
    const foot=panel.querySelector('.gcal-panel-foot'); const joinUrl=(m.mode==='online')?m.meet_link:null;
    const rescheduleBtn='<button class="ac-btn" onclick="gcalClosePanel();mtgOpenCreate('+id+')"><i class="fa-solid fa-pen"></i> Reschedule</button>';
    if(foot)foot.innerHTML = '<button class="ac-btn" onclick="gcalClosePanel()">Close</button>'+rescheduleBtn+(joinUrl?('<a class="ac-btn primary" href="'+esc2(joinUrl)+'" target="_blank" rel="noopener"><i class="fa-solid fa-video"></i> Join</a>'):'');
    panel.classList.add('open'); if(backdrop)backdrop.classList.add('open');
  };
  async function meetingsTab(){
    await mtgLoadData();
    await mtgCheckGoogleConnected();
    mtgRenderOnly();
    if(window._mtgAutoOpenCreate){ window._mtgAutoOpenCreate=false; mtgOpenCreate(); }
  }
  function mtgGroupTabsHtml(){
    const tabs=[['all','All'],['mode','Mode'],['recurring','Recurring'],['participants','Participants']];
    return '<div class="mtg-grouptabs">'+tabs.map(function(t){ return '<button class="mtg-gtab'+(MTG_GROUP===t[0]?' active':'')+'" onclick="mtgSetGroup(\''+t[0]+'\')">'+t[1]+'</button>'; }).join('')+'</div>';
  }
  // Real duration once Google's Meet API has actually returned it (see google-meet-attendance-sync)
  // — not the scheduled start/end from the meeting form, the true conference start/end.
  function mtgActualDurationText(l){
    if(l.attendance_status==='fetched' && l.actual_start && l.actual_end){
      const mins=Math.round((new Date(l.actual_end)-new Date(l.actual_start))/60000);
      if(mins>0){ const h=Math.floor(mins/60), m=mins%60; return (h?(h+'h '):'')+m+'m'; }
    }
    return null;
  }
  // Small "N of M joined" badge for list rows — shown instead of a generic Online/Offline tag once
  // real attendance data exists, falls back gracefully while it's still pending or unavailable.
  function mtgAttendanceBadgeHtml(l){
    if(l.mode==='offline'){
      if(l.attendance_status==='not_marked_done') return '<span class="mtg-log-badge none"><i class="fa-solid fa-calendar-xmark"></i> Not marked done</span>';
      return '<span class="mtg-log-badge none">Offline</span>';
    }
    const invited=(l.attendee_emails||[]).length;
    if(l.attendance_status==='fetched') return '<span class="mtg-log-badge ready"><i class="fa-solid fa-user-check"></i> '+(l.participants||[]).length+' of '+invited+' joined</span>';
    if(l.attendance_status==='pending') return '<span class="mtg-log-badge pending">Fetching attendance…</span>';
    if(l.attendance_status==='not_held') return '<span class="mtg-log-badge none"><i class="fa-solid fa-calendar-xmark"></i> Not held</span>';
    return '<span class="mtg-log-badge none">No attendance data</span>';
  }
  // A meeting occurrence's detail — real routed page (not a modal), reached via
  // navTo('tasks/meetings/log/<id>') from either the global Archive tab (one-time meetings) or a
  // recurring meeting's own Logs list page (mtgLogsPage). Self-contained: fetches the row itself
  // rather than relying on any page-specific cached list, so it works from either place.
  async function mtgLogPage(v,id){
    injectCss(); setCrumb(['Accountability','Meeting Log']);
    v.innerHTML='<div class="loader"><div class="spin"></div></div>';
    let l=null;
    try{ const {data}=await ACC().from('meeting_logs').select('*').eq('id',id).maybeSingle(); l=data; }catch(e){}
    if(!l){ v.innerHTML='<div class="tp-card"><div class="ac-empty" style="cursor:default;border:0">Log not found.</div></div>'; return; }
    const plist=await people();
    const invitedNames=(l.attendee_emails||[]).map(function(e){ return nameOf(plist,e)||e; });
    const actualDur=mtgActualDurationText(l);
    const durationHtml = '<div class="gcal-panel-row"><i class="fa-regular fa-clock"></i> '+esc2(mtgLogTimeLabel(l))
      +(actualDur?(' <span style="color:#166534;font-weight:600;margin-left:6px">'+esc2(actualDur)+' actual</span>'):' <span style="color:var(--slate);font-weight:400;margin-left:6px">(scheduled)</span>')
      +'</div>';
    let attendeesHtml;
    if(l.mode==='offline'){
      attendeesHtml='<div class="gcal-panel-row"><i class="fa-solid fa-users"></i> '+esc2(invitedNames.join(', ')||'—')+'</div>'
        +(l.attendance_status==='not_marked_done'?'<p style="color:var(--slate);font-size:13px;margin:6px 0 0">This meeting was <b>not marked done</b> — it wasn\'t recorded on the scheduled day, so it moved to Archive the following day.</p>':'');
    } else if(l.attendance_status==='fetched'){
      const parts=(l.participants||[]);
      const joinedRows=parts.length?parts.map(function(p){
        const durLbl=p.duration_min!=null?(' · '+p.duration_min+' min'):'';
        const rejoinLbl=p.rejoined?' <span style="color:#a16207;font-weight:600">(rejoined)</span>':'';
        return '<div class="mtg-log-attendee"><i class="fa-solid fa-circle-check" style="color:#16a34a"></i> '+esc2(p.name)+durLbl+rejoinLbl+'</div>';
      }).join(''):'<p style="color:var(--slate);font-size:13px;margin:2px 0 0">Nobody joined this call.</p>';
      attendeesHtml='<div class="gcal-panel-row"><i class="fa-solid fa-users"></i> Invited: '+esc2(invitedNames.join(', ')||'—')+'</div>'
        +'<div style="margin-top:8px"><b style="font-size:12.5px;color:var(--slate)">Joined ('+parts.length+' of '+invitedNames.length+')</b>'+joinedRows+'</div>';
    } else if(l.attendance_status==='pending'){
      attendeesHtml='<div class="gcal-panel-row"><i class="fa-solid fa-users"></i> Invited: '+esc2(invitedNames.join(', ')||'—')+'</div>'
        +'<p style="color:var(--slate);font-size:13px;margin:6px 0 0">Fetching who actually joined from Google Meet — check back shortly.</p>';
    } else if(l.attendance_status==='not_held'){
      attendeesHtml='<div class="gcal-panel-row"><i class="fa-solid fa-users"></i> Invited: '+esc2(invitedNames.join(', ')||'—')+'</div>'
        +'<p style="color:var(--slate);font-size:13px;margin:6px 0 0">This meeting was <b>not held</b> — no Google Meet call took place on the scheduled day. It stayed active that day and moved to Archive the following day.</p>';
    } else {
      attendeesHtml='<div class="gcal-panel-row"><i class="fa-solid fa-users"></i> Invited: '+esc2(invitedNames.join(', ')||'—')+'</div>'
        +'<p style="color:var(--slate);font-size:13px;margin:6px 0 0">No attendance data for this meeting — either it wasn\'t actually held, or the organizer wasn\'t connected to Google at the time.</p>';
    }
    let transcriptHtml;
    if(l.transcript_status==='ready') transcriptHtml='<div class="mtg-log-transcript">'+esc2(l.transcript||'').replace(/\n/g,'<br>')+'</div>';
    else if(l.transcript_status==='pending') transcriptHtml='<p style="color:var(--slate);font-size:13px;margin:6px 0 0">Transcript is being fetched from Google Meet…</p>';
    else transcriptHtml='<p style="color:var(--slate);font-size:13px;margin:6px 0 0">No transcript — needs a Workspace plan with Meet transcription (Business Standard or higher) and someone starting it live in the call.</p>';
    const recordingHtml = l.mode==='offline'
      ? '<p style="color:var(--slate);font-size:13px;margin:6px 0 0">Offline meetings aren\'t recorded through Google Meet.</p>'
      : '<p style="color:var(--slate);font-size:13px;margin:6px 0 0">Recording isn\'t available on your current Google Workspace plan (requires Business Standard or higher).</p>';
    // One-time meetings' logs have meeting_id set to null once the meeting itself is deleted
    // (see acc.log_completed_meetings) — those were only ever reachable from Archive, so Back
    // goes there. Recurring meetings' logs keep meeting_id, so Back returns to that meeting's
    // own Logs page instead.
    const backTarget = l.meeting_id!=null ? ('tasks/meetings/logs/'+l.meeting_id) : 'tasks/archive';
    v.innerHTML='<div class="tp-head">'
      +'<div><div class="tp-title"><i class="fa-solid fa-box-archive" style="color:#7c3aed"></i> '+esc2(l.title)+'</div>'
      +'<div class="tp-sub">'+fmtDateY(l.occurrence_date)+'</div></div>'
      +'<div class="tp-acts"><button class="ac-btn ic" title="Back" onclick="navTo(\''+backTarget+'\')"><i class="fa-solid fa-arrow-left"></i></button></div>'
      +'</div>'
      +'<div class="tp-card">'
      +durationHtml
      +'<div class="gcal-panel-row"><i class="fa-solid '+(l.mode==='offline'?'fa-people-group':'fa-video')+'"></i> '+(l.mode==='offline'?'Offline':'Online')+'</div>'
      +'<div style="margin-top:12px">'+attendeesHtml+'</div>'
      +'</div>'
      +'<div class="tp-card"><h3><i class="fa-solid fa-circle-play" style="color:#64748b"></i> Recording</h3>'+recordingHtml+'</div>'
      +'<div class="tp-card"><h3><i class="fa-solid fa-file-lines" style="color:#64748b"></i> Transcript</h3>'+transcriptHtml+'</div>';
  }
  // Recurring meetings never go to Archive — clicking anywhere on their card (mtgCard) navigates
  // here instead, listing every past completed occurrence; each row navigates to mtgLogPage above.
  async function mtgLogsPage(v,meetingId){
    injectCss(); setCrumb(['Accountability','Meeting Logs']);
    v.innerHTML='<div class="loader"><div class="spin"></div></div>';
    let m=(MTG_LIST||[]).find(function(x){return x.id===meetingId;});
    if(!m){ try{ const {data}=await ACC().from('meetings').select('*').eq('id',meetingId).maybeSingle(); m=data; }catch(e){} }
    let logs=[];
    try{ const {data}=await ACC().from('meeting_logs').select('*').eq('meeting_id',meetingId).order('occurrence_date',{ascending:false}).limit(100); logs=data||[]; }catch(e){}
    const rows=logs.length?logs.map(function(l){
      return '<div class="mtg-log-row" onclick="navTo(\'tasks/meetings/log/'+l.id+'\')">'
        +'<div><div class="mtg-log-title">'+esc2(fmtDateY(l.occurrence_date))+'</div><div class="mtg-log-meta">'+esc2(mtgLogTimeLabel(l))+'</div></div>'
        +mtgAttendanceBadgeHtml(l)
        +'</div>';
    }).join(''):'<div class="ac-empty" style="cursor:default">No completed occurrences yet</div>';
    v.innerHTML='<div class="tp-head">'
      +'<div><div class="tp-title"><i class="fa-solid fa-clock-rotate-left" style="color:#7c3aed"></i> Logs — '+esc2(m?m.title:'Meeting')+'</div>'
      +'<div class="tp-sub">Past completed occurrences</div></div>'
      +'<div class="tp-acts"><button class="ac-btn ic" title="Back" onclick="navTo(\'tasks/meetings\')"><i class="fa-solid fa-arrow-left"></i></button></div>'
      +'</div>'
      +'<div class="tp-card">'+rows+'</div>';
  }
  function mtgRenderOnly(){
    const b=$('acBody'); if(!b)return;
    if(GOOGLE_CONNECTED!==true){
      const myEmail=me();
      const offDomain=!/@thejaingroup\.com$/i.test(myEmail||'');
      const warnHtml=offDomain?('<div class="mtg-gate-warn"><i class="fa-solid fa-triangle-exclamation"></i> Google Meet only works with a thejaingroup.com account — you\'re signed in as '+esc2(myEmail)+', so this won\'t be able to connect.</div>'):'';
      b.innerHTML='<div class="mtg-page"><div class="mtg-main"><div class="mtg-gate">'
        +'<i class="fa-brands fa-google mtg-gate-icon"></i>'
        +'<h3>Connect Google to use Meetings</h3>'
        +'<p>Connect your Google account to schedule meetings, get a real Google Meet link, and see who\'s attending.</p>'
        +warnHtml
        +'<button onclick="googleConnect()"><i class="fa-brands fa-google"></i> Connect Google</button>'
        +'</div></div></div>';
      return;
    }
    const groups=mtgGroupedSections(MTG_GROUP);
    groups.forEach(function(g){ g.items=g.items.slice().sort(function(a,b){return mtgSortKey(a).localeCompare(mtgSortKey(b));}); });
    let body=groups.map(function(g){ const isWeek=/This Week$/.test(g.label); return '<div class="mtg-sec-label">'+esc2(g.label)+'</div>'+g.items.map(function(m){ return mtgCard(m,isWeek?m._weekCount:null); }).join(''); }).join('');
    if(!groups.length) body='<div class="ac-empty" style="cursor:default;border:0">No meetings yet — click <b>Schedule Meeting</b> to add one.</div>';
    b.innerHTML='<div class="mtg-page">'
      +'<div class="mtg-main">'
      +'<div class="mtg-toolbar"><div class="mtg-toolbar-title">Meetings</div>'+mtgGoogleStatusHtml()+'<button class="mtg-create" onclick="mtgOpenCreate()"><i class="fa-solid fa-plus"></i> Schedule Meeting</button></div>'
      +mtgGroupTabsHtml()
      +'<div class="mtg-body">'+body+'</div>'
      +'</div></div>';
  }

  /* ---------- ARCHIVE (all-time completed tasks; Reopen-only detail view) ---------- */
  async function archiveTab(){
    const b=$('acBody');
    const [list,{tasks,asg}]=await Promise.all([people(), loadAll()]);
    const candidates=tasks.filter(t=>t.approval_state==='approved'&&(isMemb(t,asg)||isOwner(t)));
    let fullyApprovedIds=new Set();
    if(candidates.length){
      try{ const {data:fa}=await ACC().rpc('fully_approved_batch',{p_ids:candidates.map(t=>t.id)}); (fa||[]).forEach(r=>{ if(r.fully_approved)fullyApprovedIds.add(r.task_id); }); }catch(e){}
    }
    const done=candidates.filter(t=>fullyApprovedIds.has(t.id)).sort((a,b)=>new Date(b.completed_at||b.approved_at||0)-new Date(a.completed_at||a.approved_at||0));
    const byMe=done.filter(t=>isOwner(t)&&!isSelf(t,asg)&&!t.parent_task_id);
    const toMe=done.filter(t=>isMemb(t,asg)&&!isSelf(t,asg));
    const self=done.filter(t=>isSelf(t,asg));
    const grp=(label,arr,opt)=> arr.length?(`<div class="ac-seclbl">${label}</div><div class="ac-arch-list">`+arr.map(t=>miniRow(t,list,asg,opt)).join('')+`</div>`):'';
    const inner=(byMe.length||toMe.length||self.length)?(grp('Assigned by me',byMe,{showDoneDate:true,ro:true})+grp('Assigned to me',toMe,{ownerAvatar:true,showDoneDate:true,ro:true})+grp('Self Tasks',self,{showDoneDate:true,ro:true})):'<div class="ac-empty" style="cursor:default">No completed tasks yet</div>';
    // One-time completed meetings land here. Recurring meetings never appear in Archive — their
    // history lives under each meeting's own "Logs" button on the Meetings page (mtgOpenMeetingLogs).
    let mtgLogs=[];
    try{ const my=me(); const {data}=await ACC().from('meeting_logs').select('*').eq('recur_type','none').contains('attendee_emails',[my]).order('occurrence_date',{ascending:false}).limit(200); mtgLogs=data||[]; }catch(e){}
    const mtgInner=mtgLogs.length?mtgLogs.map(function(l){
      return '<div class="mtg-log-row" onclick="navTo(\'tasks/meetings/log/'+l.id+'\')">'
        +'<div><div class="mtg-log-title">'+esc2(l.title)+'</div><div class="mtg-log-meta">'+esc2(fmtDateY(l.occurrence_date))+' · '+esc2(mtgLogTimeLabel(l))+'</div></div>'
        +mtgAttendanceBadgeHtml(l)
        +'</div>';
    }).join(''):'<div class="ac-empty" style="cursor:default">No completed one-time meetings yet</div>';
    b.innerHTML=`<div class="ac-card"><div class="hd"><i class="fa-solid fa-box-archive"></i> All completed tasks<span class="cnt">${done.length}</span></div><div class="bd" style="height:auto;max-height:none;overflow:visible">${inner}</div></div>`
      +`<div class="ac-card" style="margin-top:28px"><div class="hd"><i class="fa-solid fa-box-archive"></i> Completed meetings<span class="cnt">${mtgLogs.length}</span></div><div class="bd" style="height:auto;max-height:none;overflow:visible">${mtgInner}</div></div>`;
  }

  /* ---------- TASKS SCREEN ---------- */
  let P3='priority', PEND_HOVER=null;
  async function tasksScreen(){
    const b=$('acBody');
    const [list,{tasks,asg,pm},myRanks]=await Promise.all([people(), loadAll(), loadMyRanks()]);
    const delegatedByMeIds=new Set(tasks.filter(t=>t.parent_task_id&&isOwner(t)).map(t=>t.parent_task_id));

    /* Combined per-card order: tasks you've already ranked (drag-and-dropped) come after
       tasks you haven't touched yet — untouched ones default to top priority ("A"),
       sorted alphabetically by title among themselves, until you drag one. */
    function effectiveOrder(arr){
      const ranked=arr.filter(t=>myRanks.hasOwnProperty(t.id)).sort((a,b)=>myRanks[a.id]-myRanks[b.id]);
      const unranked=arr.filter(t=>!myRanks.hasOwnProperty(t.id)).sort((a,b)=>String(a.title||'').localeCompare(String(b.title||''),undefined,{sensitivity:'base'}));
      return {order:unranked.concat(ranked), unrankedCount:unranked.length};
    }
    function withLetters(arr){
      const {order}=effectiveOrder(arr);
      return order.map((t,i)=>({t, letter:letterFor(i+1)}));
    }
    /* Project/Person view: group order is fully derived from the current priority order above —
       whichever project/person contains the very top task appears first, and so on. No manual
       drag-and-drop of groups or of tasks within a group; only the Priority tab can be dragged. */
    function groupSecs(arr,type){
      const wl=withLetters(arr);
      if(P3==='priority') return {mode:'priority',flat:wl};
      if(P3==='project'){
        const seen=[],seenSet=new Set(),g={};
        wl.forEach(x=>{ const k=x.t.project_id?String(x.t.project_id):'__none__'; if(!seenSet.has(k)){seenSet.add(k);seen.push(k);g[k]={label:x.t.project_id?(pm[x.t.project_id]||'—'):'No tag',items:[]};} g[k].items.push(x); });
        return {mode:'project',secs:seen.map(k=>({key:k,label:g[k].label,items:g[k].items}))};
      }
      const isOwnerRole = type==='toMe';
      const seen=[],seenSet=new Set(),g={};
      wl.forEach(x=>{
        const t=x.t;
        if(isOwnerRole){ const k=(t.delegator||'').toLowerCase(); if(!seenSet.has(k)){seenSet.add(k);seen.push(k);g[k]={label:nameOf(list,t.delegator)||'—',items:[]};} g[k].items.push(x); }
        else { const mem=(asg[t.id]||[]); const ks=mem.length?mem.map(e=>e.toLowerCase()):[(t.delegator||'').toLowerCase()]; ks.forEach(k=>{ if(!seenSet.has(k)){seenSet.add(k);seen.push(k);g[k]={label:nameOf(list,k)||'—',items:[]};} g[k].items.push(x); }); }
      });
      return {mode:'person',secs:seen.map(k=>({key:k,label:g[k].label,items:g[k].items}))};
    }
    function renderGroupResult(res,opt){
      opt=opt||{};
      if(res.mode==='priority'){
        const rows=res.flat.length?res.flat.map(x=>taskRow(x.t,asg,list,Object.assign({},opt,{letter:x.letter}))).join(''):'<div class="ac-empty" style="cursor:default">None</div>';
        return `<div class="ac-seclist" data-swap="1">${rows}</div>`;
      }
      const inner=res.secs.length?res.secs.map(s=>{
        const rows=s.items.length?s.items.map(x=>taskRow(x.t,asg,list,Object.assign({},opt,{letter:x.letter,noDrag:true}))).join(''):'<div class="ac-empty" style="cursor:default">None</div>';
        return `<div class="ac-secwrap"><div class="ac-seclbl">${esc2(s.label)}</div><div class="ac-seclist">${rows}</div></div>`;
      }).join(''):'<div class="ac-seclist"><div class="ac-empty" style="cursor:default">None</div></div>';
      return `<div class="ac-grpbox">${inner}</div>`;
    }

    const toMeArr=tasks.filter(t=>isMemb(t,asg)&&stOf(t)==='open');
    const byMeArr=tasks.filter(t=>isOwner(t)&&stOf(t)==='open'&&!isSelf(t,asg));
    const awaArr=tasks.filter(t=>isMemb(t,asg)&&stOf(t)==='await');
    const pend=tasks.filter(t=>isOwner(t)&&stOf(t)==='await');

    /* Workload — due-dated active tasks assigned to me, due today/yesterday/overdue only (no future dates, no priority view) */
    const activeAll=tasks.filter(t=>stOf(t)!=='approved');
    const toMeActive=activeAll.filter(t=>isMemb(t,asg)&&!delegatedByMeIds.has(t.id));
    const td0=new Date(); td0.setHours(0,0,0,0);
    const workload=toMeActive.filter(t=>{const d=parseD(t.due_date); if(!d)return false; d.setHours(0,0,0,0); return d<=td0;}).sort((a,b)=>parseD(a.due_date)-parseD(b.due_date));

    /* Completed this week — Assigned by me / Assigned to me / Self Tasks (kept separate).
       A delegated task only counts once it AND every ancestor up its delegation chain has been
       approved — a child task approved by its immediate delegator doesn't show here (or credit
       the scoreboard) until the original senior has approved the whole chain up to the root. */
    const wk=new Date(Date.now()-7*864e5);
    const doneWkCandidates=tasks.filter(t=>t.approval_state==='approved'&&t.approved_at&&new Date(t.approved_at)>=wk&&(isMemb(t,asg)||isOwner(t)));
    let fullyApprovedIds=new Set();
    if(doneWkCandidates.length){
      try{ const {data:fa}=await ACC().rpc('fully_approved_batch',{p_ids:doneWkCandidates.map(t=>t.id)}); (fa||[]).forEach(r=>{ if(r.fully_approved)fullyApprovedIds.add(r.task_id); }); }catch(e){}
    }
    const doneWk=doneWkCandidates.filter(t=>fullyApprovedIds.has(t.id));
    const byMeC=doneWk.filter(t=>isOwner(t)&&!isSelf(t,asg)&&!t.parent_task_id);
    const toMeC=doneWk.filter(t=>isMemb(t,asg)&&!isSelf(t,asg));
    const selfC=doneWk.filter(t=>isSelf(t,asg));
    const grp=(label,arr,opt)=> arr.length?(`<div class="ac-seclbl">${label}</div>`+arr.map(t=>miniRow(t,list,asg,opt)).join('')):'';
    const completedInner=(byMeC.length||toMeC.length||selfC.length)?(grp('Assigned by me',byMeC,{showDoneDate:true,ro:true})+grp('Assigned to me',toMeC,{ownerAvatar:true,showDoneDate:true,ro:true})+grp('Self Tasks',selfC,{showDoneDate:true,ro:true})):'<div class="ac-empty" style="cursor:default">Nothing completed this week</div>';

    const p3=(k,ic,l)=>`<button class="ac-pbtn ${P3===k?'on':''}" onclick="accP3('${k}')"><i class="fa-solid ${ic}"></i> ${l}</button>`;

    /* Assigned by me — hovering above/below/between tasks reveals a "+" to insert a new task at
       exactly that position, in every P3 tab. Priority mode shows one flat list; Project/Person
       mode groups the SAME flat priority order by project/assignee (group order itself derives
       from priority — whichever group holds the top-ranked task appears first). Dragging is
       scoped to within one group only in Project/Person mode — no moving a task between two
       projects/people by dragging — but the underlying global priority number being edited is
       identical either way. */
    const byMeFlat=withLetters(byMeArr);
    const byMeFlatIds=byMeFlat.map(x=>x.t.id);
    window._byMeOrderIds=byMeFlatIds;
    let byMeBody;
    if(P3==='priority'){
      let rows='<div class="ac-seclist" data-swap="1" data-fullorder="byMe">'+gapRow('byMe',null,byMeFlatIds.length?byMeFlatIds[0]:null,null,null,null,byMeFlatIds.length===0);
      byMeFlat.forEach((x,i)=>{
        rows+=taskRow(x.t,asg,list,{checkable:true,owner:true,letter:x.letter});
        rows+=gapRow('byMe', x.t.id, (i+1<byMeFlatIds.length)?byMeFlatIds[i+1]:null);
      });
      byMeBody=rows+'</div>';
    } else {
      const seen=[],seenSet=new Set(),g={};
      if(P3==='project'){
        byMeFlat.forEach(x=>{ const k=x.t.project_id?String(x.t.project_id):'__none__'; if(!seenSet.has(k)){seenSet.add(k);seen.push(k);g[k]={label:x.t.project_id?(pm[x.t.project_id]||'—'):'No tag',metaType:'project',metaVal:x.t.project_id||null,items:[]};} g[k].items.push(x); });
      } else {
        byMeFlat.forEach(x=>{ const mem=(asg[x.t.id]||[]); const ks=mem.length?mem.map(e=>e.toLowerCase()):[(x.t.delegator||'').toLowerCase()]; ks.forEach(k=>{ if(!seenSet.has(k)){seenSet.add(k);seen.push(k);g[k]={label:nameOf(list,k)||'—',metaType:'person',metaVal:k,items:[]};} g[k].items.push(x); }); });
      }
      const groupHtml=seen.map(k=>{
        const grp=g[k]; const items=grp.items;
        const nb0=globalNeighborsFor(byMeFlatIds,null,items[0].t.id);
        let rows=gapRow('byMe',nb0.beforeId,nb0.afterId,grp.metaType,grp.metaVal,grp.label,false,k);
        items.forEach((x,i)=>{
          rows+=taskRow(x.t,asg,list,{checkable:true,owner:true,letter:x.letter,noDrag:false});
          const nextLocal=items[i+1]?items[i+1].t.id:null;
          const nb=globalNeighborsFor(byMeFlatIds,x.t.id,nextLocal);
          rows+=gapRow('byMe',nb.beforeId,nb.afterId,grp.metaType,grp.metaVal,grp.label,false,k);
        });
        return `<div class="ac-secwrap"><div class="ac-seclbl">${esc2(grp.label)}</div><div class="ac-seclist" data-swap="1" data-fullorder="byMe">${rows}</div></div>`;
      }).join('');
      byMeBody='<div class="ac-grpbox">'+(groupHtml||'<div class="ac-seclist"><div class="ac-empty" style="cursor:default">None</div></div>')+'</div>'+insInput();
    }

    /* Assigned to me — unified list: assigned/delegated tasks (badge A/D) plus self-created
       tasks (badge S) in one shared priority order, same 3-tab gap+scoped-drag UI as "Assigned by
       me". Anything created through a gap here is always a self task (kind='self', no member
       picker). Person mode groups by delegator — who gave you the task; self tasks group under
       yourself. */
    const toMeFlat=withLetters(toMeArr);
    const toMeFlatIds=toMeFlat.map(x=>x.t.id);
    window._selfOrderIds=toMeFlatIds;
    let toMeBody;
    if(P3==='priority'){
      let rows='<div class="ac-seclist" data-swap="1" data-fullorder="self">'+gapRow('self',null,toMeFlatIds.length?toMeFlatIds[0]:null,null,null,null,toMeFlatIds.length===0);
      toMeFlat.forEach((x,i)=>{
        rows+=taskRow(x.t,asg,list,{checkable:true,owner:isSelf(x.t,asg),letter:x.letter,ownerAvatar:true});
        rows+=gapRow('self', x.t.id, (i+1<toMeFlatIds.length)?toMeFlatIds[i+1]:null);
      });
      toMeBody=rows+'</div>';
    } else {
      const seen=[],seenSet=new Set(),g={};
      if(P3==='project'){
        toMeFlat.forEach(x=>{ const k=x.t.project_id?String(x.t.project_id):'__none__'; if(!seenSet.has(k)){seenSet.add(k);seen.push(k);g[k]={label:x.t.project_id?(pm[x.t.project_id]||'—'):'No tag',metaType:'project',metaVal:x.t.project_id||null,items:[]};} g[k].items.push(x); });
      } else {
        toMeFlat.forEach(x=>{ const k=(x.t.delegator||'').toLowerCase(); if(!seenSet.has(k)){seenSet.add(k);seen.push(k);g[k]={label:nameOf(list,k)||'—',metaType:'person',metaVal:k,items:[]};} g[k].items.push(x); });
      }
      const groupHtml=seen.map(k=>{
        const grp=g[k]; const items=grp.items;
        const nb0=globalNeighborsFor(toMeFlatIds,null,items[0].t.id);
        let rows=gapRow('self',nb0.beforeId,nb0.afterId,grp.metaType,grp.metaVal,grp.label,false,k);
        items.forEach((x,i)=>{
          rows+=taskRow(x.t,asg,list,{checkable:true,owner:isSelf(x.t,asg),letter:x.letter,noDrag:false,ownerAvatar:true});
          const nextLocal=items[i+1]?items[i+1].t.id:null;
          const nb=globalNeighborsFor(toMeFlatIds,x.t.id,nextLocal);
          rows+=gapRow('self',nb.beforeId,nb.afterId,grp.metaType,grp.metaVal,grp.label,false,k);
        });
        return `<div class="ac-secwrap"><div class="ac-seclbl">${esc2(grp.label)}</div><div class="ac-seclist" data-swap="1" data-fullorder="self">${rows}</div></div>`;
      }).join('');
      toMeBody='<div class="ac-grpbox">'+(groupHtml||'<div class="ac-seclist"><div class="ac-empty" style="cursor:default">None</div></div>')+'</div>'+selfInsGhost();
    }

    b.innerHTML=`
    <input class="ac-in" id="acTaskSearch" placeholder="Search tasks…" style="margin-bottom:14px;width:100%" oninput="accTaskSearch(this.value)">
    <div class="ac-3p">${p3('priority','fa-arrow-down-1-9','Priority')}${p3('project','fa-tag','Tags')}${p3('person','fa-user','Person')}</div>
    <div class="ac-cols">
      <div class="ac-col">
        <div class="ac-colh"><i class="fa-solid fa-inbox" style="color:#0369a1"></i> Todo</div>
        <div class="ac-card"><div class="hd"><i class="fa-solid fa-inbox"></i> Assigned to me<span class="cnt">${toMeArr.length}</span></div><div class="bd" id="toMeBd">${toMeBody}</div></div>
        <div class="ac-card"><div class="hd"><i class="fa-solid fa-hourglass-half"></i> Pending Approval<span class="cnt">${pend.length}</span></div><div class="bd">${renderGroupResult(groupSecs(pend,'byMe'),{approve:true})}</div></div>
      </div>
      <div class="ac-col">
        <div class="ac-colh"><i class="fa-solid fa-share-nodes" style="color:#7c3aed"></i> Followup</div>
        <div class="ac-card"><div class="hd"><i class="fa-solid fa-share-nodes"></i> Assigned by me<span class="cnt">${byMeArr.length}</span></div><div class="bd" id="createBd">${byMeBody}</div></div>
        <div class="ac-card"><div class="hd"><i class="fa-solid fa-hourglass-half"></i> Awaiting Approval<span class="cnt">${awaArr.length}</span></div><div class="bd">${renderGroupResult(groupSecs(awaArr,'toMe'),{ownerAvatar:true,showDoneDate:true})}</div></div>
      </div>
    </div>
    <div class="ac-cardgrid" style="grid-auto-rows:auto;margin-top:16px">
      ${summaryCard('Workload','fa-gauge-high','#be123c',workload.length, workload.length?workload.map(t=>miniRow(t,list,asg)).join(''):'<div class="ac-empty" style="cursor:default">Nothing due</div>')}
      ${summaryCard('Completed this week','fa-circle-check','#16a34a',(byMeC.length+toMeC.length+selfC.length), completedInner)}
    </div>`;
    b.querySelectorAll('[data-swap="1"]').forEach(w=>{
      const key=w.dataset.fullorder;
      const full=key==='byMe'?window._byMeOrderIds:(key==='self'?window._selfOrderIds:null);
      wireSwapDrag(w,full);
    });
    updateInsDateBtn(); updateInsMemberBtn(); updateInsProjBtn(); updateSelfInsDateBtn(); updateSelfInsProjBtn();
  }
  let INS_STAGE={due:null,members:[],project:null,projectLabel:''}, SELF_INS_STAGE={due:null,project:null,projectLabel:''}, INS_BUSY=false, SELF_INS_BUSY=false;
  function insInput(){
    return `<div class="ac-addrow-ghost" id="insGhost" onclick="accInsExpand()"><i class="fa-solid fa-plus"></i> Add task</div>
    <div class="ac-addrow" id="insRow" style="display:none">
      <input id="insInput" class="ac-in" placeholder="Add a task… (Enter to add, Esc to cancel)" onkeydown="if(event.key==='Enter'){event.preventDefault();accInsCreate();}else if(event.key==='Escape'){event.preventDefault();accInsCancel();}">
      <button class="ac-btn ic" id="insDateBtn" title="Set due date" onclick="accInsPickDate(event)"><i class="fa-regular fa-calendar"></i></button>
      <button class="ac-btn ic" id="insMemberBtn" title="Pick members" onclick="accInsPickMembers(event)"><i class="fa-solid fa-user-plus"></i></button>
      <button class="ac-btn ic" id="insProjBtn" title="Set tag" onclick="accInsPickProject(event)"><i class="fa-solid fa-diagram-project"></i></button>
    </div>`;
  }
  window.accInsExpand=function(){ const g=$('insGhost'),r=$('insRow'); if(g)g.style.display='none'; if(r)r.style.display=''; const inp=$('insInput'); if(inp)inp.focus(); };
  function selfInsGhost(){
    return `<div class="ac-addrow-ghost" id="selfInsGhost" onclick="accSelfInsExpand()"><i class="fa-solid fa-plus"></i> Add task</div>
    <div class="ac-addrow" id="selfInsRow" style="display:none">
      <input id="selfInsInput" class="ac-in" placeholder="Add a self task… (Enter to add, Esc to cancel)" onkeydown="if(event.key==='Enter'){event.preventDefault();accSelfInsCreate();}else if(event.key==='Escape'){event.preventDefault();accSelfInsCancel();}">
      <button class="ac-btn ic" id="selfInsDateBtn" title="Set due date" onclick="accSelfInsPickDate(event)"><i class="fa-regular fa-calendar"></i></button>
      <button class="ac-btn ic" id="selfInsProjBtn" title="Set tag" onclick="accSelfInsPickProject(event)"><i class="fa-solid fa-diagram-project"></i></button>
    </div>`;
  }
  window.accSelfInsExpand=function(){ const g=$('selfInsGhost'),r=$('selfInsRow'); if(g)g.style.display='none'; if(r)r.style.display=''; const inp=$('selfInsInput'); if(inp)inp.focus(); };

  /* ---- hover-between-tasks "+" insertion points (every P3 tab for Assigned-by-me; always for
     Self Tasks). Gaps are identified by their actual neighboring task ids (in the full global
     priority order) rather than a position index, so the same code works whether the gap sits in
     a flat list (Priority mode) or inside one Project/Person group. An optional meta preset
     (project or person) pre-fills the create form when you open a gap inside a specific group. ---- */
  let GAP_ACTIVE={kind:null,beforeId:null,afterId:null,groupKey:null};
  function gapFields(kind){
    if(kind==='self'){
      return `<input id="selfInsInput" class="ac-in" placeholder="Add a self task… (Enter to add, Esc to cancel)" onkeydown="if(event.key==='Enter'){event.preventDefault();accSelfInsCreate();}else if(event.key==='Escape'){event.preventDefault();accSelfInsCancel();}">
      <button class="ac-btn ic" id="selfInsDateBtn" title="Set due date" onclick="accSelfInsPickDate(event)"><i class="fa-regular fa-calendar"></i></button>
      <button class="ac-btn ic" id="selfInsProjBtn" title="Set tag" onclick="accSelfInsPickProject(event)"><i class="fa-solid fa-diagram-project"></i></button>`;
    }
    return `<input id="insInput" class="ac-in" placeholder="Add a task… (Enter to add, Esc to cancel)" onkeydown="if(event.key==='Enter'){event.preventDefault();accInsCreate();}else if(event.key==='Escape'){event.preventDefault();accInsCancel();}">
      <button class="ac-btn ic" id="insDateBtn" title="Set due date" onclick="accInsPickDate(event)"><i class="fa-regular fa-calendar"></i></button>
      <button class="ac-btn ic" id="insMemberBtn" title="Pick members" onclick="accInsPickMembers(event)"><i class="fa-solid fa-user-plus"></i></button>
      <button class="ac-btn ic" id="insProjBtn" title="Set tag" onclick="accInsPickProject(event)"><i class="fa-solid fa-diagram-project"></i></button>`;
  }
  function gapRow(kind,beforeId,afterId,metaType,metaVal,metaLabel,emptyStyle,groupKey){
    groupKey=groupKey||null;
    if(GAP_ACTIVE.kind===kind && GAP_ACTIVE.beforeId===beforeId && GAP_ACTIVE.afterId===afterId && GAP_ACTIVE.groupKey===groupKey) return `<div class="ac-addrow">${gapFields(kind)}</div>`;
    const b=beforeId==null?'null':beforeId, a=afterId==null?'null':afterId;
    const mt=metaType?("'"+metaType+"'"):'null';
    const mv=metaVal==null?'null':(typeof metaVal==='number'?metaVal:("'"+encodeURIComponent(metaVal)+"'"));
    const ml=metaLabel?("'"+encodeURIComponent(metaLabel)+"'"):"''";
    const gk=groupKey?("'"+encodeURIComponent(groupKey)+"'"):'null';
    if(emptyStyle) return `<div class="ac-addrow-ghost" onclick="accGapOpen('${kind}',${b},${a},${mt},${mv},${ml},${gk})"><i class="fa-solid fa-plus"></i> Add task</div>`;
    return `<div class="ac-ins" onclick="accGapOpen('${kind}',${b},${a},${mt},${mv},${ml},${gk})"></div>`;
  }
  window.accGapOpen=function(kind,beforeId,afterId,metaType,metaVal,metaLabel,groupKey){
    GAP_ACTIVE={kind:kind,beforeId:beforeId,afterId:afterId,groupKey:groupKey?decodeURIComponent(groupKey):null};
    tasksScreen().then(function(){
      if((kind==='byMe'||kind==='self')&&metaType==='project'){
        const proj=metaVal, label=metaLabel?decodeURIComponent(metaLabel):'';
        if(kind==='byMe'){ INS_STAGE.project=proj; INS_STAGE.projectLabel=label; updateInsProjBtn(); }
        else { SELF_INS_STAGE.project=proj; SELF_INS_STAGE.projectLabel=label; updateSelfInsProjBtn(); }
      }
      else if(kind==='byMe'&&metaType==='person'){ const email=metaVal?decodeURIComponent(metaVal):null; if(email&&!INS_STAGE.members.includes(email))INS_STAGE.members=[email]; updateInsMemberBtn(); }
      const inp=$(kind==='self'?'selfInsInput':'insInput'); if(inp)inp.focus();
    });
  };
  /* generic tiny popover (used for the date/member/project pickers above) */
  let POPOVER_ANCHOR=null;
  function closePopover(){ const p=document.getElementById('acPopover'); if(p)p.remove(); document.removeEventListener('mousedown',popoverOutside,true); POPOVER_ANCHOR=null; }
  function popoverOutside(e){ const p=document.getElementById('acPopover'); if(p&&!p.contains(e.target))closePopover(); }
  function openPopover(anchor,innerHtml){
    closePopover();
    const el=document.createElement('div'); el.id='acPopover'; el.style.cssText='position:fixed;z-index:100000;background:transparent;border:none;box-shadow:none;padding:0;margin:0;'; el.innerHTML=innerHtml;
    document.body.appendChild(el);
    POPOVER_ANCHOR=anchor;
    const r=anchor.getBoundingClientRect(); const margin=10;
    el.style.left=Math.max(margin,Math.min(r.left,window.innerWidth-el.offsetWidth-margin))+'px';
    el.style.top=(r.bottom+4)+'px';
    setTimeout(function(){ document.addEventListener('mousedown',popoverOutside,true); },0);
    return el;
  }
  function updateInsDateBtn(){ const b=$('insDateBtn'); if(!b)return; if(INS_STAGE.due){ b.classList.add('primary'); b.title='Due '+fmtDate(INS_STAGE.due); } else { b.classList.remove('primary'); b.title='Set due date'; } }
  function updateInsMemberBtn(){ const b=$('insMemberBtn'); if(!b)return; const n=(INS_STAGE.members||[]).length; if(n){ b.classList.add('primary'); b.title=n+' member'+(n>1?'s':'')+' selected'; } else { b.classList.remove('primary'); b.title='Pick members'; } }
  function updateInsProjBtn(){ const b=$('insProjBtn'); if(!b)return; if(INS_STAGE.project){ b.classList.add('primary'); b.title='Tag: '+(INS_STAGE.projectLabel||''); } else { b.classList.remove('primary'); b.title='Set tag'; } }
  function updateSelfInsDateBtn(){ const b=$('selfInsDateBtn'); if(!b)return; if(SELF_INS_STAGE.due){ b.classList.add('primary'); b.title='Due '+fmtDate(SELF_INS_STAGE.due); } else { b.classList.remove('primary'); b.title='Set due date'; } }
  function updateSelfInsProjBtn(){ const b=$('selfInsProjBtn'); if(!b)return; if(SELF_INS_STAGE.project){ b.classList.add('primary'); b.title='Tag: '+(SELF_INS_STAGE.projectLabel||''); } else { b.classList.remove('primary'); b.title='Set tag'; } }
  window.accInsPickDate=function(ev){
    ev.stopPropagation(); const btn=ev.currentTarget;
    if(POPOVER_ANCHOR===btn){ closePopover(); return; }
    const cur=INS_STAGE.due||'';
    openPopover(btn,`<input type="date" id="acPopDate" min="${todayISO()}" value="${cur}" onchange="accInsDateSet(this.value)" style="opacity:0;width:36px;height:36px;border:0;padding:0;outline:none;background:transparent">`);
    const inp=document.getElementById('acPopDate'); if(inp){ inp.focus(); try{ inp.showPicker && inp.showPicker(); }catch(_e){} }
  };
  window.accInsDateSet=function(v){ INS_STAGE.due=v||null; updateInsDateBtn(); accInsToggleX(); closePopover(); const t=$('insInput'); if(t)t.focus(); };
  window.accInsPickMembers=async function(ev){
    ev.stopPropagation();
    const list=await people(); const others=list.filter(p=>!eq(p.email,me()));
    openModal(`<div class="modal-head"><h3>Members</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" style="width:100%;box-sizing:border-box;overflow-x:hidden">${msWidget('acPopMembers',others,INS_STAGE.members||[])}</div><div class="modal-foot"><button class="ac-btn" onclick="closeModal()">Cancel</button><button class="ac-btn primary" onclick="accInsMembersSet()"><i class="fa-solid fa-check"></i> Done</button></div>`,'md');
  };
  window.accInsMembersSet=function(){ INS_STAGE.members=msGet('acPopMembers'); updateInsMemberBtn(); accInsToggleX(); closeModal(); const t=$('insInput'); if(t)t.focus(); };
  window.accInsPickProject=async function(ev){
    ev.stopPropagation();
    const {data:projectsRaw}=await ACC().from('projects').select('id,name,department,created_by,owner').order('name');
    const projects=(projectsRaw||[]).filter(tagVisible);
    openModal(`<div class="modal-head"><h3>Tag</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" style="min-width:min(90vw,420px)">${projListWidget(projects,INS_STAGE.project||'')}<input type="hidden" id="etProj" value="${INS_STAGE.project||''}"><input class="ac-in" id="etNewProj" placeholder="New tag name" style="display:none;margin-top:8px"></div><div class="modal-foot"><button class="ac-btn" onclick="closeModal()">Cancel</button><button class="ac-btn primary" onclick="accInsProjectSet()"><i class="fa-solid fa-check"></i> Done</button></div>`,'md');
  };
  window.accInsProjectSet=async function(){
    const pv=$('etProj').value;
    if(pv==='__new'){
      const nm=($('etNewProj').value||'').trim(); if(!nm){toast('Enter a tag name','err');return;}
      const depts=myDepts();
      try{ const {data:pj,error}=await ACC().from('projects').insert({name:nm,created_by:me(),owner:me(),department:depts.length?depts:null}).select().single(); if(error)throw error; INS_STAGE.project=pj.id; INS_STAGE.projectLabel=nm; }catch(e){ toast('Failed to create tag','err'); return; }
    } else { INS_STAGE.project=pv?Number(pv):null; INS_STAGE.projectLabel=pv?(window._etProjLabel||''):''; }
    updateInsProjBtn(); accInsToggleX(); closeModal(); const t=$('insInput'); if(t)t.focus();
  };
  window.accSelfInsPickDate=function(ev){
    ev.stopPropagation(); const btn=ev.currentTarget;
    if(POPOVER_ANCHOR===btn){ closePopover(); return; }
    const cur=SELF_INS_STAGE.due||'';
    openPopover(btn,`<input type="date" id="acPopSelfDate" min="${todayISO()}" value="${cur}" onchange="accSelfInsDateSet(this.value)" style="opacity:0;width:36px;height:36px;border:0;padding:0;outline:none;background:transparent">`);
    const inp=document.getElementById('acPopSelfDate'); if(inp){ inp.focus(); try{ inp.showPicker && inp.showPicker(); }catch(_e){} }
  };
  window.accSelfInsDateSet=function(v){ SELF_INS_STAGE.due=v||null; updateSelfInsDateBtn(); accSelfInsToggleX(); closePopover(); const t=$('selfInsInput'); if(t)t.focus(); };
  window.accSelfInsPickProject=async function(ev){
    ev.stopPropagation();
    const {data:projectsRaw}=await ACC().from('projects').select('id,name,department,created_by,owner').order('name');
    const projects=(projectsRaw||[]).filter(tagVisible);
    openModal(`<div class="modal-head"><h3>Tag</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" style="min-width:min(90vw,420px)">${projListWidget(projects,SELF_INS_STAGE.project||'')}<input type="hidden" id="etProj" value="${SELF_INS_STAGE.project||''}"><input class="ac-in" id="etNewProj" placeholder="New tag name" style="display:none;margin-top:8px"></div><div class="modal-foot"><button class="ac-btn" onclick="closeModal()">Cancel</button><button class="ac-btn primary" onclick="accSelfInsProjectSet()"><i class="fa-solid fa-check"></i> Done</button></div>`,'md');
  };
  window.accSelfInsProjectSet=async function(){
    const pv=$('etProj').value;
    if(pv==='__new'){
      const nm=($('etNewProj').value||'').trim(); if(!nm){toast('Enter a tag name','err');return;}
      try{ const depts=myDepts(); const {data:pj,error}=await ACC().from('projects').insert({name:nm,created_by:me(),owner:me(),department:depts.length?depts:null}).select().single(); if(error)throw error; SELF_INS_STAGE.project=pj.id; SELF_INS_STAGE.projectLabel=nm; }catch(e){ toast('Failed to create tag','err'); return; }
    } else { SELF_INS_STAGE.project=pv?Number(pv):null; SELF_INS_STAGE.projectLabel=pv?(window._etProjLabel||''):''; }
    updateSelfInsProjBtn(); accSelfInsToggleX(); closeModal(); const t=$('selfInsInput'); if(t)t.focus();
  };
  window.accP3=function(k){P3=k;tasksScreen();};
  window.accInsToggleX=function(){};
  window.accSelfInsToggleX=function(){};
  window.accInsCancel=function(){ INS_STAGE={due:null,members:[],project:null,projectLabel:''}; if(GAP_ACTIVE.kind==='byMe')GAP_ACTIVE={kind:null,beforeId:null,afterId:null}; tasksScreen(); };
  window.accSelfInsCancel=function(){ SELF_INS_STAGE={due:null,project:null,projectLabel:''}; if(GAP_ACTIVE.kind==='self')GAP_ACTIVE={kind:null,beforeId:null,afterId:null}; tasksScreen(); };
  window.accInsCreate=async function(){
    if(INS_BUSY)return;
    const inp=$('insInput'); const title=(inp&&inp.value||'').trim(); if(!title){toast('Type a title','err');return;}
    const due=INS_STAGE.due||null;
    const sel=(INS_STAGE.members||[]).slice(); if(!sel.length){toast('Pick at least one member','err');return;}
    const projectId=INS_STAGE.project||null;
    INS_BUSY=true;
    try{
      const {data:t,error}=await ACC().from('ptasks').insert({title,delegator:me(),due_date:due,project_id:projectId,order_index:0}).select().single();
      if(error)throw error;
      await ACC().from('ptask_assignees').insert(sel.map(e=>({task_id:t.id,email:e})));
      let r;
      if(GAP_ACTIVE.kind==='byMe' && (GAP_ACTIVE.beforeId!=null||GAP_ACTIVE.afterId!=null) && (window._byMeOrderIds||[]).length){ r=await rankBetweenIds(window._byMeOrderIds,GAP_ACTIVE.beforeId,GAP_ACTIVE.afterId); }
      else { r=await nextRankForMe(); }
      await setMyRank(t.id,r);
      INS_STAGE={due:null,members:[],project:null,projectLabel:''}; GAP_ACTIVE={kind:null,beforeId:null,afterId:null}; toast('Task created','ok'); tasksScreen();
    }catch(e){ toast('Failed: '+((e&&e.message)||e),'err'); }
    finally{ INS_BUSY=false; }
  };
  window.accSelfInsCreate=async function(){
    if(SELF_INS_BUSY)return;
    const inp=$('selfInsInput'); const title=(inp&&inp.value||'').trim(); if(!title){toast('Type a title','err');return;}
    const due=SELF_INS_STAGE.due||null;
    const projectId=SELF_INS_STAGE.project||null;
    SELF_INS_BUSY=true;
    try{
      const {data:t,error}=await ACC().from('ptasks').insert({title,delegator:me(),due_date:due,project_id:projectId,order_index:0}).select().single();
      if(error)throw error;
      await ACC().from('ptask_assignees').insert({task_id:t.id,email:me()});
      let r;
      if(GAP_ACTIVE.kind==='self' && (GAP_ACTIVE.beforeId!=null||GAP_ACTIVE.afterId!=null) && (window._selfOrderIds||[]).length){ r=await rankBetweenIds(window._selfOrderIds,GAP_ACTIVE.beforeId,GAP_ACTIVE.afterId); }
      else { r=await nextRankForMe(); }
      await setMyRank(t.id,r);
      SELF_INS_STAGE={due:null,project:null,projectLabel:''}; GAP_ACTIVE={kind:null,beforeId:null,afterId:null}; toast('Task added','ok'); tasksScreen();
    }catch(e){ toast('Failed: '+((e&&e.message)||e),'err'); }
    finally{ SELF_INS_BUSY=false; }
  };

  window.pendHover=function(id){PEND_HOVER=id;};
  window.pendUnhover=function(id){if(PEND_HOVER===id)PEND_HOVER=null;};
  function taskRow(t,asg,list,opt){
    opt=opt||{};
    const emails=(opt.ownerAvatar&&!opt.owner)?[t.delegator].filter(Boolean):(asg[t.id]||[]);
    const approve=opt.approve?`<div style="display:flex;gap:5px;flex:none" onclick="event.stopPropagation()"><button class="ac-btn ok ic" style="height:30px;width:30px" title="Approve (A)" onclick="accApprove(${t.id},true)"><i class="fa-solid fa-check"></i></button><button class="ac-btn danger ic" style="height:30px;width:30px" title="Decline (D)" onclick="accDecline(${t.id})"><i class="fa-solid fa-xmark"></i></button></div>`:'';
    const chk=opt.checkable?`<input type="checkbox" class="ac-rowchk" title="${opt.owner?'Mark complete':'Mark done — send for approval'}" onclick="event.stopPropagation()" onchange="accRowCheck(${t.id},${!!opt.owner},this)">`:'';
    const hover=opt.approve?` onmouseenter="pendHover(${t.id})" onmouseleave="pendUnhover(${t.id})"`:'';
    const grip=opt.noDrag?'<span class="grip-sp"></span>':'<i class="fa-solid fa-grip-vertical grip" onclick="event.stopPropagation()"></i>';
    const letterHtml='';
    let meta='', doneBadge2='';
    if(opt.showDoneDate){
      // Awaiting Approval rows: only the marked-done date (date icon) + on-time/overdue badge + members.
      const dd=t.completed_at?`<span title="Marked done"><i class="fa-regular fa-calendar"></i> ${fmtDate(t.completed_at)}</span>`:'';
      meta=dd?`<div class="rtd">${dd}</div>`:'';
      doneBadge2=dueBadge(t.due_date,t.completed_at);
    } else {
      const metaParts=[t.due_date?`<i class="fa-regular fa-calendar"></i> ${fmtDate(t.due_date)}`:'',t._projName?`<i class="fa-solid fa-diagram-project"></i> ${esc2(t._projName)}`:''].filter(Boolean);
      meta=metaParts.length?`<div class="rtd">${metaParts.join(' · ')}</div>`:'';
    }
    return `<div class="ac-row" data-id="${t.id}" onclick="navTo('tasks/task/${t.id}')"${hover}>${chk}${grip}${letterHtml}<div class="ti"><div class="t">${esc2(t.title)}</div></div><div class="rt">${meta}${doneBadge2}${emails.length?avatars(list,emails):''}</div>${approve}</div>`;
  }

  function wirePointerDrag(col,sel,persist,onSwipeLeft){ col.querySelectorAll(sel).forEach(row=>{ const grip=row.querySelector('.grip'); if(!grip)return; grip.style.touchAction='none'; grip.addEventListener('pointerdown',function(e){ e.preventDefault(); e.stopPropagation(); try{grip.setPointerCapture(e.pointerId);}catch(_){} const startX=e.clientX,startY=e.clientY,isTouch=e.pointerType==='touch'; let mode=null,lastDx=0; window._dragging=true; function move(ev){ const dx=ev.clientX-startX,dy=ev.clientY-startY; lastDx=dx; if(mode===null){ if(Math.abs(dx)>10||Math.abs(dy)>10){ if(onSwipeLeft&&isTouch&&dx<0&&Math.abs(dx)>Math.abs(dy)*1.2){ mode='swipe'; } else { mode='drag'; row.classList.add('drag'); } } } if(mode==='swipe'){ row.style.transition='none'; row.style.transform='translateX('+Math.max(dx,-88)+'px)'; } else if(mode==='drag'){ const el=document.elementFromPoint(ev.clientX,ev.clientY); const tgt=el&&el.closest(sel); if(tgt&&tgt!==row&&col.contains(tgt)){ const r=tgt.getBoundingClientRect(); if(ev.clientY<r.top+r.height/2)col.insertBefore(row,tgt); else col.insertBefore(row,tgt.nextSibling); } } } function up(){ try{grip.releasePointerCapture(e.pointerId);}catch(_){} window._dragging=false; row.classList.remove('drag'); row.style.transition='transform .15s'; row.style.transform=''; document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); if(mode==='swipe'&&lastDx<-44)onSwipeLeft(row); else if(mode==='drag')persist(col); } document.addEventListener('pointermove',move); document.addEventListener('pointerup',up); }); }); }

  /* ---- swap-based reorder (Priority tab only): dragging task A onto task B exchanges their
     two ranks, private to the current viewer. If the list hasn't been touched yet (still in its
     default alphabetical order), the whole list is first "crystallized" into explicit ranks
     matching its current order, then the drag swap is applied on top. ---- */
  async function crystallizeAndSwap(draggedId,targetId,orderIds){
    if(!targetId||draggedId===targetId) return;
    try{
      const my=me();
      const {data:existing}=await ACC().from('task_rank').select('task_id').eq('viewer_email',my).in('task_id',orderIds);
      const have=new Set((existing||[]).map(r=>r.task_id));
      if(orderIds.some(id=>!have.has(id))){
        const rows=orderIds.map((id,i)=>({task_id:id,viewer_email:my,rank:i+1}));
        await ACC().from('task_rank').upsert(rows,{onConflict:'task_id,viewer_email'});
      }
      const [{data:aR},{data:bR}]=await Promise.all([
        ACC().from('task_rank').select('rank').eq('task_id',draggedId).eq('viewer_email',my).single(),
        ACC().from('task_rank').select('rank').eq('task_id',targetId).eq('viewer_email',my).single()
      ]);
      const ai=(aR&&aR.rank)||0, bi=(bR&&bR.rank)||0;
      await Promise.all([
        ACC().from('task_rank').upsert({task_id:draggedId,viewer_email:my,rank:bi},{onConflict:'task_id,viewer_email'}),
        ACC().from('task_rank').upsert({task_id:targetId,viewer_email:my,rank:ai},{onConflict:'task_id,viewer_email'})
      ]);
    }catch(e){ toast('Failed to reorder','err'); }
    tasksScreen();
  }
  function wireSwapDrag(col,fullOrderIds){
    col.querySelectorAll('.ac-row').forEach(row=>{
      const grip=row.querySelector('.grip'); if(!grip)return;
      grip.style.touchAction='none';
      grip.addEventListener('pointerdown',function(e){
        e.preventDefault(); e.stopPropagation();
        try{grip.setPointerCapture(e.pointerId);}catch(_){}
        const startX=e.clientX,startY=e.clientY,isTouch=e.pointerType==='touch';
        let mode=null,hoverTgt=null,lastDx=0;
        window._dragging=true;
        function move(ev){
          const dx=ev.clientX-startX,dy=ev.clientY-startY; lastDx=dx;
          if(mode===null&&(Math.abs(dx)>8||Math.abs(dy)>8)){
            if(isTouch&&dx<0&&Math.abs(dx)>Math.abs(dy)*1.2){ mode='swipe'; }
            else { mode='drag'; row.classList.add('drag'); }
          }
          if(mode==='swipe'){
            row.style.transition='none'; row.style.transform='translateX('+Math.max(dx,-88)+'px)';
          } else if(mode==='drag'){
            if(hoverTgt)hoverTgt.classList.remove('swap-tgt');
            const el=document.elementFromPoint(ev.clientX,ev.clientY);
            const tgt=el&&el.closest('.ac-row');
            if(tgt&&tgt!==row&&col.contains(tgt)){ hoverTgt=tgt; tgt.classList.add('swap-tgt'); } else hoverTgt=null;
          }
        }
        function up(){
          try{grip.releasePointerCapture(e.pointerId);}catch(_){}
          window._dragging=false; row.classList.remove('drag');
          row.style.transition='transform .15s'; row.style.transform='';
          if(mode==='swipe'){
            if(lastDx<-44){ const gap=row.nextElementSibling; if(gap&&(gap.classList.contains('ac-ins')||gap.classList.contains('ac-addrow-ghost')))gap.click(); }
          } else if(hoverTgt){
            hoverTgt.classList.remove('swap-tgt');
            const orderIds=fullOrderIds||[...col.querySelectorAll('.ac-row')].map(r=>Number(r.dataset.id));
            crystallizeAndSwap(Number(row.dataset.id),Number(hoverTgt.dataset.id),orderIds);
          }
          document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up);
        }
        document.addEventListener('pointermove',move); document.addEventListener('pointerup',up);
      });
    });
  }

  window.accApprove=async function(tid,approve,notifId){ try{ if(approve){ await ACC().from('ptasks').update({approval_state:'approved',status:'Completed',approved_by:me(),approved_at:nowISO()}).eq('id',tid); await ACC().from('ptask_activity').insert({task_id:tid,action:'approved',detail:'Approved'}); try{await ACC().rpc('complete_subtree',{tid});}catch(e){} try{await ACC().rpc('bubble_after_approve',{tid});}catch(e){} } else { try{await ACC().rpc('reset_subtree',{tid});}catch(e){await ACC().from('ptasks').update({approval_state:'declined',status:'Pending'}).eq('id',tid);} await ACC().from('ptask_activity').insert({task_id:tid,action:'declined',detail:'Declined — task restored'}); await sysMsg(tid,'declined the task — restored to the assignee'); } try{await ACC().from('notifications').update({read:true}).eq('task_id',tid).eq('kind','approval').eq('recipient',me());}catch(e){} if(notifId){try{await ACC().from('notifications').update({read:true}).eq('id',notifId);}catch(e){}} toast(approve?'Approved':'Declined','ok'); await notifLoad(); if(!approve){ if(PAGE==='tasks'){ location.hash='#/task/'+tid; renderPage(); setTimeout(function(){ const c=$('chatIn'); if(c)c.focus(); },500); } else { location.href='tasks.html#/task/'+tid; } } else { if(location.hash.includes('/task/'))renderPage(); else if(PAGE==='tasks')tasksScreen(); } }catch(e){ toast('Failed: '+((e&&e.message)||e),'err'); } };

  window.__accQ2=true;
  function gapOutsideTap(e){
    if(!GAP_ACTIVE.kind) return;
    if(e.target.closest('.ac-addrow')) return;
    if(e.target.closest('.ac-ins')) return;
    if(e.target.closest('.ac-addrow-ghost')) return;
    if(document.getElementById('acPopover')) return;
    const ov=document.getElementById('overlay'); if(ov&&ov.classList.contains('show')) return;
    if(GAP_ACTIVE.kind==='self'){ if(typeof window.accSelfInsCancel==='function')window.accSelfInsCancel(); }
    else { if(typeof window.accInsCancel==='function')window.accInsCancel(); }
  }
  document.addEventListener('click',gapOutsideTap,true);
  document.addEventListener('keydown',function(e){
    if(typeof ROUTE==='undefined'||ROUTE.tab!=='work')return;
    const k=e.key.toLowerCase(); if(k!=='a'&&k!=='d')return;
    const a=document.activeElement; if(a&&/INPUT|TEXTAREA/.test(a.tagName))return;
    if(!PEND_HOVER){ toast('Hover a task in Pending Approval, then press A or D','warn'); return; }
    e.preventDefault();
    if(k==='a')accApprove(PEND_HOVER,true); else accDecline(PEND_HOVER);
  });

  /* ---------- TASK PAGE ---------- */
  async function taskPage(v, tid, ro){
    injectCss(); tid=Number(tid); setCrumb(['Accountability','Task']);
    v.innerHTML='<div class="loader"><div class="spin"></div></div>';
    const [tR,aR,sR,cR,actR,list,dR,fR]=await Promise.all([
      ACC().from('ptasks').select('*').eq('id',tid).single(),
      ACC().from('ptask_assignees').select('email').eq('task_id',tid),
      ACC().from('ptask_subtasks').select('*').eq('task_id',tid).order('order_index',{ascending:true}),
      ACC().from('ptask_comments').select('*').eq('task_id',tid).order('created_at',{ascending:true}),
      ACC().from('ptask_activity').select('*').eq('task_id',tid).order('created_at',{ascending:false}),
      people(),
      ACC().from('ptasks').select('id').eq('parent_task_id',tid).ilike('delegator',me()),
      ACC().from('ptask_files').select('*').eq('task_id',tid).order('created_at',{ascending:true})
    ]);
    const t=tR.data; if(!t){ v.innerHTML='<div class="tp-card"><div class="ac-empty" style="cursor:default;border:0">Task not found.</div></div>'; return; }
    const members=(aR.data||[]).map(r=>r.email), subL=sR.data||[], comments=cR.data||[], acts=actR.data||[], files=fR.data||[];
    let projName=''; if(t.project_id){ const pm=await loadProjectsMap(); projName=pm[t.project_id]||''; }
    const amOwner=eq(t.delegator,me()), amMember=members.some(e=>eq(e,me())), st=stOf(t); const iHaveDelegated=(dR.data||[]).length>0;
    const selfTask=amOwner&&amMember;
    const locked=ro&&st==='approved';
    const canEdit=amOwner&&!locked;
    const dueHist=acts.filter(a=>a.action==='due date changed');
    window._tp={dueHist,list,amOwner,amMember,tid,canApprove:(amOwner&&st==='await'),selfTask,comments};
    let A='';
    if(locked){
      // Archive / Completed-this-week view, still completed: no workflow actions here —
      // Reopen (below) is the sole action the owner gets, until they use it.
    } else if(selfTask){
      if(st==='open') A=`<button class="ac-btn primary" onclick="accMarkDone(${tid},true)"><i class="fa-regular fa-circle-check"></i> Mark Done</button>`;
    } else {
      if(amMember&&st==='open') A+=`<button class="ac-btn primary" onclick="accMarkDone(${tid},false)"><i class="fa-regular fa-circle-check"></i> Mark Done</button>`;
      else if(amMember&&st==='await') A+=`<button class="ac-btn" disabled><i class="fa-solid fa-hourglass-half"></i> Awaiting Approval</button><button class="ac-btn" onclick="accRevert(${tid})"><i class="fa-solid fa-rotate-left"></i> Revert</button>`;
      if(amOwner&&st==='await') A+=`<button class="ac-btn ok" onclick="accApprove(${tid},true)"><i class="fa-solid fa-check"></i> Approve</button><button class="ac-btn danger" onclick="accDecline(${tid})"><i class="fa-solid fa-xmark"></i> Decline</button>`;
      else if(amOwner&&st==='open') A+=`<button class="ac-btn primary" onclick="accMarkDone(${tid},true)"><i class="fa-regular fa-circle-check"></i> Mark Done</button>`;
    }
    if(st==='approved') A=`<button class="ac-btn ok" disabled><i class="fa-solid fa-circle-check"></i> ${t.parent_task_id?'Approved':'Completed'}</button>`+(amOwner?`<button class="ac-btn" onclick="accReopen(${tid})"><i class="fa-solid fa-rotate-left"></i> Reopen</button>`:'');
    const verb=t.parent_task_id?'Delegated':'Assigned', doneC=subL.filter(s=>s.done).length;
    v.innerHTML=`
    <div class="tp-head">
      <div><div class="tp-title"><i class="fa-solid fa-clipboard-check" style="color:#7c3aed"></i> ${esc2(t.title)} ${canEdit?`<button class="ac-btn ic" style="height:26px;width:26px" title="Rename" onclick="accEditTitle(${tid})"><i class="fa-solid fa-pen"></i></button>`:''}</div>
        <div class="tp-sub">${selfTask?'Self task':(verb+' to '+(members.map(e=>esc2(nameOf(list,e))).join(', ')||'nobody yet')+' by '+esc2(nameOf(list,t.delegator)))}</div></div>
      <div class="tp-acts">
        <button class="ac-btn ic" title="Back" onclick="navTo('tasks/work')"><i class="fa-solid fa-arrow-left"></i></button>
        <button class="ac-btn ic" title="Time Sheet / Sub-tasks" onclick="accTimesheet()"><i class="fa-solid fa-list-check"></i></button>
        ${(amMember && !iHaveDelegated && !selfTask && !locked)?`<button class="ac-btn ic" title="Delegate" onclick="accDelegate(${tid})"><i class="fa-solid fa-people-arrows"></i></button>`:''}
        ${A}
      </div>
    </div>
    ${t.description?`<div class="tp-card"><h3><i class="fa-solid fa-align-left" style="color:#64748b"></i> Description${canEdit?`<span class="r"><button class="ac-btn ic" title="Edit" onclick="accEditDesc(${tid})"><i class="fa-solid fa-pen"></i></button></span>`:''}</h3><div class="tp-desc">${mdBold(t.description)}</div></div>`:''}
    <div class="tp-card">
      <h3><i class="fa-solid fa-circle-info" style="color:#64748b"></i> Details<span class="r">
        ${canEdit?`<button class="ac-btn ic" title="${t.description?'Edit':'Add'} description" onclick="accEditDesc(${tid})"><i class="fa-solid fa-align-left"></i></button>`:''}
        ${canEdit?`<button class="ac-btn ic danger" title="Delete" onclick="accTaskDelete(${tid})"><i class="fa-solid fa-trash"></i></button>`:''}</span></h3>
      <div class="tp-grid">
        <div class="tp-f"><div class="k">Due date</div><div class="v">${t.due_date?fmtDateY(t.due_date):'—'} ${dueHist.length?`<a onclick="accDueHistory(${tid})" title="History"><i class="fa-solid fa-clock-rotate-left"></i></a>`:''} ${canEdit?`<button class="ac-btn ic" style="height:24px;width:24px" title="Edit due date" onclick="accEditDue(${tid})"><i class="fa-solid fa-pen"></i></button>`:''}</div></div>
        <div class="tp-f"><div class="k">Tag</div><div class="v">${projName?esc2(projName):'—'} ${canEdit?`<button class="ac-btn ic" style="height:24px;width:24px" title="Edit tag" onclick="accEditProject(${tid})"><i class="fa-solid fa-pen"></i></button>`:''}</div></div>
        <div class="tp-f"><div class="k">Created</div><div class="v">${fmtDateY(t.created_at)}</div></div>
        <div class="tp-f"><div class="k">Owner</div><div class="v">${esc2(nameOf(list,t.delegator))}</div></div>
        <div class="tp-f"><div class="k">Status</div><div class="v">${stChip(t.status)}</div></div>
        <div class="tp-f"><div class="k">Members</div><div class="v">${avatars(list,members)} ${(canEdit&&!selfTask)?`<button class="ac-btn ic" style="height:26px;width:26px" onclick="accEditMembers(${tid})" title="Edit"><i class="fa-solid fa-user-pen"></i></button>`:''}</div></div>
      </div>
      <div class="info-divider"></div>
      <div style="display:flex;justify-content:space-between;align-items:center"><div style="font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--slate);text-transform:uppercase"><i class="fa-solid fa-paperclip"></i> Attachments <span style="margin-left:4px">${files.length}</span></div><span>${locked?'':`<input type="file" id="pfInput" style="display:none" onchange="accFilePicked(${tid},this)"><button class="ac-btn ic" title="Add attachment" onclick="document.getElementById('pfInput').click()"><i class="fa-solid fa-plus"></i></button>`}</span></div>
      <div id="pfList" style="margin-top:8px">${files.length?files.map(f=>pfRow(f,tid)).join(''):'<div class="ac-empty" style="cursor:default;border:0">No attachments yet</div>'}</div>
    </div>
    <div class="tp-card" id="subCard" style="${subL.length?'':'display:none'}">
      <h3><i class="fa-solid fa-list-check" style="color:#0369a1"></i> Sub-tasks <span style="margin-left:8px;font-size:12px;color:var(--slate);font-weight:700">${doneC}/${subL.length}</span></h3>
      <div id="subWrap">${subL.map(subRow).join('')}</div>
      ${locked?'':`<div class="ac-addrow" style="margin-top:6px"><input id="stTitle" class="ac-in" placeholder="Sub-task title… (Enter to add, Esc to clear)" onkeydown="if(event.key==='Enter'){event.preventDefault();accSubAdd(${tid});}else if(event.key==='Escape'){event.preventDefault();accSubCancel();}"></div>`}
    </div>
    <div class="tp-card"><h3 style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="accChatToggle()"><i class="fa-solid fa-comments" style="color:#16a34a"></i> Updates &amp; Feedback<i class="fa-solid fa-chevron-down" id="chatChevron" style="margin-left:auto;font-size:12px;color:var(--slate);transition:.15s"></i></h3>
      <div id="chatBody">
      <div class="tp-chat" id="chat">${comments.length?comments.map(c=>commentHtml(c,list)).join(''):'<div class="ac-empty" style="cursor:default;border:0">No updates yet</div>'}</div>
      ${locked?'':`<div id="chatFileChip" style="display:none;align-items:center;gap:7px;font-size:12px;color:var(--slate);margin-top:8px;background:#f1f5f9;border-radius:8px;padding:6px 10px"><i class="fa-solid fa-paperclip"></i><span id="chatFileName" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span><i class="fa-solid fa-xmark" style="cursor:pointer" onclick="accChatClearFile()"></i></div>
      <div style="display:flex;gap:8px;margin-top:10px"><input type="file" id="chatFile" style="display:none" onchange="accChatFilePicked(this)"><button class="ac-btn ic" title="Attach file" onclick="document.getElementById('chatFile').click()"><i class="fa-solid fa-paperclip"></i></button><input class="ac-in" id="chatIn" placeholder="Write an update… (you can paste an image)" onkeydown="if(event.key==='Enter')accComment(${tid})" onpaste="accChatPaste(event)"><button class="ac-btn primary ic" onclick="accComment(${tid})"><i class="fa-solid fa-paper-plane"></i></button></div>`}
      </div>
    </div>`;
    const sw=$('subWrap'); if(sw)wireSubDrag(sw); const c=$('chat'); if(c)c.scrollTop=c.scrollHeight;
  }
  function commentHtml(c,list){
    return c.system?`<div style="text-align:center;font-size:11px;color:var(--slate);margin:5px 0"><i class="fa-solid fa-pen-to-square" style="font-size:9px;margin-right:3px"></i>${esc2(nameOf(list,c.author))} ${esc2(c.body)} · ${fmtDate(c.created_at)}</div>`:`<div class="tp-msg ${eq(c.author,me())?'mine':'them'}"><div class="who">${esc2(nameOf(list,c.author))} · ${fmtDate(c.created_at)}</div>${c.body?mdBold(c.body):''}${c.attach_path?`<div class="tp-attach-chip" onclick="s3OpenSigned('${c.attach_path}')"><i class="fa-solid fa-paperclip"></i> ${esc2(c.attach_name||'Attachment')}</div>`:''}</div>`;
  }
  window.accChatToggle=function(){
    const b=$('chatBody'); const chev=$('chatChevron'); if(!b)return;
    const show=b.style.display==='none'; b.style.display=show?'':'none';
    if(chev)chev.style.transform=show?'':'rotate(-90deg)';
  };
  function pfSize(n){ n=Number(n)||0; if(!n)return ''; if(n<1024)return n+' B'; if(n<1048576)return (n/1024).toFixed(1)+' KB'; return (n/1048576).toFixed(1)+' MB'; }
  function pfRow(f,tid){
    const tp=window._tp||{}; const canDel=(tp.amOwner)||eq(f.uploaded_by,me()); const nm=nameOf(tp.list||[],f.uploaded_by);
    return `<div class="tp-sub-item" data-id="${f.id}"><i class="fa-solid fa-file" style="color:#64748b"></i><div style="flex:1;min-width:0;cursor:pointer" onclick="s3OpenSigned('${f.storage_path}')"><div style="font-size:13px;color:var(--ink);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc2(f.file_name)}</div><div style="font-size:11px;color:var(--slate)">${pfSize(f.file_size)}${nm?(' · '+esc2(nm)):''}</div></div><button class="ac-btn ic" style="height:28px;width:28px" title="Download" onclick="event.stopPropagation();s3OpenSigned('${f.storage_path}','${esc2(f.file_name||'file').replace(/'/g,"\\'")}')"><i class="fa-solid fa-download"></i></button>${canDel?`<button class="ac-btn ic danger" style="height:28px;width:28px" title="Delete" onclick="accFileDelete(${tid},${f.id},'${f.storage_path}','${esc2(f.file_name||'').replace(/'/g,"\\'")}')"><i class="fa-solid fa-trash"></i></button>`:''}</div>`;
  }
  window.accFilePicked=async function(tid,inputEl){
    const f=inputEl&&inputEl.files&&inputEl.files[0]; if(!f)return; inputEl.value='';
    toast('Uploading…','ok');
    try{
      const key=s3KeyForPTask(tid,f.name);
      const up=await uploadFileToS3(key,f);
      if(up.error){toast('Upload failed: '+up.error.message,'err');return;}
      await ACC().from('ptask_files').insert({task_id:tid,file_name:f.name,storage_path:up.data.path,file_size:f.size,uploaded_by:me()});
      await ACC().from('ptask_activity').insert({task_id:tid,action:'attached',detail:'Attached '+f.name});
      await sysMsg(tid,'attached '+f.name);
      toast('Attachment added','ok'); renderPage();
    }catch(e){ toast('Upload failed: '+((e&&e.message)||e),'err'); }
  };
  window.accFileDelete=function(tid,fid,path,fname){
    accConfirm('Delete this attachment?', async function(){
      try{
        const {data:others}=await ACC().from('ptask_files').select('id').eq('storage_path',path).neq('id',fid);
        if(!others||!others.length) await s3Delete(path);
        await ACC().from('ptask_files').delete().eq('id',fid);
        await ACC().from('ptask_activity').insert({task_id:tid,action:'deleted attachment',detail:'Deleted '+(fname||'an attachment')});
        await sysMsg(tid,'deleted the attachment "'+(fname||'file')+'"');
        toast('Attachment "'+(fname||'')+'" deleted','ok');
        renderPage();
      }catch(e){ toast('Failed','err'); }
    });
  };
  function subRow(s){ return `<div class="tp-sub-item" data-id="${s.id}"><i class="fa-solid fa-grip-vertical grip"></i><input type="checkbox" ${s.done?'checked':''} onchange="accSubToggle(${s.id},this.checked)" style="width:17px;height:17px"><div style="flex:1;font-size:13px;${s.done?'text-decoration:line-through;color:var(--slate)':''}">${esc2(s.title)}</div><button class="ac-btn ic danger" style="height:28px;width:28px" onclick="accSubDel(${s.id})"><i class="fa-solid fa-trash"></i></button></div>`; }
  window.accTimesheet=function(){ const c=$('subCard'); if(!c)return; const show=c.style.display==='none'; c.style.display=show?'block':'none'; if(show){const i=$('stTitle'); if(i)i.focus();} };
  window.accSubCancel=function(){ const i=$('stTitle'); if(i)i.value=''; };
  window.accSubAdd=async function(tid){ const i=$('stTitle'); const title=(i&&i.value||'').trim(); if(!title){toast('Type a sub-task title','err');return;} try{const {data:mx}=await ACC().from('ptask_subtasks').select('order_index').eq('task_id',tid).order('order_index',{ascending:false}).limit(1);const nx=(mx&&mx[0]?mx[0].order_index+1:0);const firstSub=!(mx&&mx.length);await ACC().from('ptask_subtasks').insert({task_id:tid,title,order_index:nx});if(firstSub)await sysMsg(tid,'enabled the Time Sheet');await recalc(tid);renderPage();}catch(e){toast('Failed: '+((e&&e.message)||e),'err');} };
  window.accSubToggle=async function(sid,done){ try{await ACC().from('ptask_subtasks').update({done,done_at:done?nowISO():null}).eq('id',sid);const s=await ACC().from('ptask_subtasks').select('task_id').eq('id',sid).single();if(s.data)await recalc(s.data.task_id);renderPage();}catch(e){toast('Failed','err');} };
  window.accSubDel=function(sid){ accConfirm('Delete this sub-task?', async function(){ try{const s=await ACC().from('ptask_subtasks').select('task_id').eq('id',sid).single();await ACC().from('ptask_subtasks').delete().eq('id',sid);if(s.data)await recalc(s.data.task_id);renderPage();}catch(e){} }); };
  async function recalc(tid){
    const {data:subs}=await ACC().from('ptask_subtasks').select('done').eq('task_id',tid);
    if(subs&&subs.length){
      const d=subs.filter(x=>x.done).length; const p=Math.round(d/subs.length*100);
      const u={progress:p}; let selfTaskDone=false;
      if(p===100){
        try{
          const [{data:tk},{data:asgR}]=await Promise.all([ACC().from('ptasks').select('delegator').eq('id',tid).single(),ACC().from('ptask_assignees').select('email').eq('task_id',tid)]);
          selfTaskDone=!!(tk&&(asgR||[]).some(a=>eq(a.email,tk.delegator)));
        }catch(e){}
        if(selfTaskDone){ u.status='Completed'; u.approval_state='approved'; u.completed_at=nowISO(); u.approved_at=nowISO(); u.approved_by=me(); }
        else { u.status='Awaiting Approval'; u.approval_state='awaiting_approval'; u.completed_at=nowISO(); }
      }
      await ACC().from('ptasks').update(u).eq('id',tid);
      if(p===100)await ACC().from('ptask_activity').insert({task_id:tid,action:selfTaskDone?'completed':'submitted',detail:selfTaskDone?'All sub-tasks done — task completed':'All sub-tasks done — sent for approval'});
    }
  }
  async function persistSubOrder(col){ const ids=[...col.querySelectorAll('.tp-sub-item')].map(x=>Number(x.dataset.id)); for(let i=0;i<ids.length;i++){ try{await ACC().from('ptask_subtasks').update({order_index:i}).eq('id',ids[i]);}catch(e){} } }
  function wireSubDrag(col){ wirePointerDrag(col,'.tp-sub-item',persistSubOrder); }

  window.accMarkDoneRun=async function(tid,owner){ try{ if(owner){try{await ACC().rpc('complete_subtree',{tid});}catch(e){await ACC().from('ptasks').update({status:'Completed',approval_state:'approved',progress:100,approved_at:nowISO()}).eq('id',tid);}try{await ACC().rpc('bubble_after_approve',{tid});}catch(e){}await ACC().from('ptask_activity').insert({task_id:tid,action:'completed',detail:'Completed by owner'});toast('Completed','ok');} else {await ACC().from('ptasks').update({status:'Awaiting Approval',approval_state:'awaiting_approval',progress:100,completed_at:nowISO()}).eq('id',tid);await ACC().from('ptask_activity').insert({task_id:tid,action:'submitted',detail:'Marked done — sent for approval'});toast('Sent for approval','ok');} renderPage(); return true; }catch(e){toast('Failed: '+((e&&e.message)||e),'err'); return false;} };
  window.accMarkDone=function(tid,owner){ accConfirm(owner?'Mark this task as completed?':'Mark this task done and send it for approval?', function(){ accMarkDoneRun(tid,owner); }); };
  window.accRowCheck=function(tid,owner,cb){ if(cb)cb.disabled=true; accConfirm(owner?'Mark this task as completed?':'Mark this task done and send it for approval?', async function(){ const ok=await accMarkDoneRun(tid,owner); if(!ok&&cb){cb.disabled=false;cb.checked=false;} }, function(){ if(cb){cb.disabled=false;cb.checked=false;} }); };
  async function sysMsg(tid,txt){ try{await ACC().from('ptask_comments').insert({task_id:tid,body:txt,system:true});}catch(e){} }
  function projListWidget(projects,selectedId){
    let h='<div class="ms-list" id="projPickList" style="max-height:260px">';
    h+=`<div class="ms-row${!selectedId?' on':''}" onclick="accProjSelect(this,'')"><span class="ms-nm">— None —</span><i class="fa-solid fa-check ms-ck"></i></div>`;
    projects.forEach(p=>{ const on=String(selectedId)===String(p.id); h+=`<div class="ms-row${on?' on':''}" onclick="accProjSelect(this,'${p.id}')"><span class="ms-nm">${esc2(p.name)}</span><i class="fa-solid fa-check ms-ck"></i></div>`; });
    h+=`<div class="ms-row" onclick="accProjSelect(this,'__new')"><span class="ms-nm" style="color:var(--brand);font-weight:600"><i class="fa-solid fa-plus"></i> Create new tag…</span></div>`;
    return h+'</div>';
  }
  window.accProjSelect=function(el,val){
    const list=el.closest('.ms-list'); if(list)list.querySelectorAll('.ms-row').forEach(r=>r.classList.remove('on'));
    el.classList.add('on');
    if($('etProj'))$('etProj').value=val;
    const n=$('etNewProj');
    if(val==='__new'){ if(n){n.style.display='block';n.focus();} }
    else { if(n){n.style.display='none';n.value='';} window._etProjLabel=val?(el.querySelector('.ms-nm').textContent.trim()):''; }
  };
  window.accReopen=function(tid){ if(!(window._tp&&window._tp.amOwner)){toast('Only the person who assigned this task can reopen it','err');return;} accConfirm('Reopen this completed task? It will move back to active tasks.', async function(){ try{ await ACC().from('ptasks').update({approval_state:'open',status:'Pending'}).eq('id',tid); await ACC().from('ptask_activity').insert({task_id:tid,action:'reopened',detail:'Task reopened'}); await sysMsg(tid,'reopened the task'); toast('Reopened','ok'); renderPage(); }catch(e){toast('Failed','err');} }); };
  window.accRevert=function(tid){
    if(!(window._tp&&window._tp.amMember)){toast('Only someone assigned to this task can revert it','err');return;}
    accConfirm('Revert this task back to Pending? It leaves Awaiting Approval and returns to your active tasks — and the task owner\'s "Assigned by Me" list.', async function(){
      try{
        const cur=await ACC().from('ptasks').select('delegator,title').eq('id',tid).single();
        const delegator=cur.data&&cur.data.delegator, title=(cur.data&&cur.data.title)||'';
        await ACC().from('ptasks').update({status:'Pending',approval_state:'open',completed_at:null,progress:0}).eq('id',tid);
        await ACC().from('ptask_activity').insert({task_id:tid,action:'reverted',detail:'Reverted from Awaiting Approval back to Pending'});
        await sysMsg(tid,'reverted the task — back to Pending');
        if(delegator){
          try{ await ACC().from('notifications').update({read:true}).eq('task_id',tid).eq('kind','approval').eq('recipient',delegator); }catch(e){}
          try{ await ACC().from('notifications').insert({recipient:delegator,kind:'approval',task_id:tid,title:'Task reverted: '+title,body:me()+' reverted this task — it is no longer awaiting your approval.'}); }catch(e){}
        }
        toast('Reverted','ok');
        renderPage();
      }catch(e){ toast('Failed: '+((e&&e.message)||e),'err'); }
    });
  };
  window.accChatFilePicked=function(inputEl){ const f=inputEl&&inputEl.files&&inputEl.files[0]; if(!f)return; window._chatPastedFile=null; const chip=$('chatFileChip'),nm=$('chatFileName'); if(chip&&nm){nm.textContent=f.name;chip.style.display='flex';} };
  window.accChatPaste=function(e){
    const items=(e.clipboardData&&e.clipboardData.items)||[];
    for(let i=0;i<items.length;i++){
      if(items[i].kind==='file'){
        const f=items[i].getAsFile(); if(!f)continue;
        const inp=$('chatFile'); if(inp)inp.value='';
        window._chatPastedFile=f;
        const chip=$('chatFileChip'),nm=$('chatFileName');
        if(chip&&nm){nm.textContent=f.name||'Pasted image';chip.style.display='flex';}
        toast('Image pasted — will attach with your update','ok');
        break;
      }
    }
  };
  window.accChatClearFile=function(){ const inp=$('chatFile'); if(inp)inp.value=''; window._chatPastedFile=null; const chip=$('chatFileChip'); if(chip)chip.style.display='none'; };
  window.accComment=async function(tid){
    const i=$('chatIn'); const body=(i&&i.value||'').trim();
    const fInp=$('chatFile'); const f=(fInp&&fInp.files&&fInp.files[0])||window._chatPastedFile;
    if(!body&&!f)return;
    try{
      let attachPath=null, attachName=null;
      if(f){
        const key=s3KeyForPTask(tid,f.name);
        const up=await uploadFileToS3(key,f);
        if(up.error){toast('Upload failed: '+up.error.message,'err');return;}
        await ACC().from('ptask_files').insert({task_id:tid,file_name:f.name,storage_path:up.data.path,file_size:f.size,uploaded_by:me()});
        await ACC().from('ptask_activity').insert({task_id:tid,action:'attached',detail:'Attached '+f.name});
        attachPath=up.data.path; attachName=f.name;
      }
      await ACC().from('ptask_comments').insert({task_id:tid,body:body||null,attach_path:attachPath,attach_name:attachName});
      if(i)i.value=''; accChatClearFile();
      renderPage();
    }catch(e){toast('Failed','err');}
  };
  window.accDueHistory=function(tid){ const h=(window._tp&&window._tp.dueHist)||[]; openModal(`<div class="modal-head"><h3><i class="fa-solid fa-clock-rotate-left"></i> Due date history</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" style="min-width:min(90vw,560px)">${h.length?h.map(a=>`<div style="padding:8px 0;border-bottom:1px solid var(--line-2);font-size:13px;color:var(--body)">${esc2(a.detail||'')}<span style="float:right;color:var(--slate)">${fmtDateY(a.created_at)}</span></div>`).join(''):'<div class="ac-empty" style="cursor:default;border:0">No due-date changes</div>'}</div><div class="modal-foot"><button class="ac-btn" onclick="closeModal()">Close</button></div>`,'md'); };
  window.accEditDesc=async function(tid){ const {data:t}=await ACC().from('ptasks').select('description').eq('id',tid).single(); openModal(`<div class="modal-head"><h3><i class="fa-solid fa-align-left"></i> Description</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" style="min-width:min(80vw,680px)"><textarea class="ac-in" id="edDesc" style="min-height:300px" placeholder="Describe the task…">${esc2((t&&t.description)||'')}</textarea></div><div class="modal-foot"><button class="ac-btn" onclick="closeModal()">Cancel</button><button class="ac-btn primary" onclick="accEditDescSave(${tid})"><i class="fa-solid fa-check"></i> Save</button></div>`,'lg'); };
  window.accEditDescSave=async function(tid){ try{await ACC().from('ptasks').update({description:$('edDesc').value||null}).eq('id',tid);await ACC().from('ptask_activity').insert({task_id:tid,action:'edited',detail:'Description updated'});await sysMsg(tid,'updated the description');closeModal();renderPage();}catch(e){toast('Failed','err');} };
  window.accEditTitle=async function(tid){
    const {data:t}=await ACC().from('ptasks').select('title').eq('id',tid).single();
    openModal(`<div class="modal-head"><h3>Rename task</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" style="min-width:min(90vw,420px)"><input class="ac-in" id="rnTitle" value="${esc2((t&&t.title)||'')}"></div><div class="modal-foot"><button class="ac-btn" onclick="closeModal()">Cancel</button><button class="ac-btn primary" onclick="accEditTitleSave(${tid})"><i class="fa-solid fa-check"></i> Save</button></div>`,'md');
  };
  window.accEditTitleSave=async function(tid){
    const v=($('rnTitle').value||'').trim(); if(!v){toast('Title required','err');return;}
    try{
      const {data:old}=await ACC().from('ptasks').select('title').eq('id',tid).single();
      await ACC().from('ptasks').update({title:v}).eq('id',tid);
      if(old&&old.title!==v){ await ACC().from('ptask_activity').insert({task_id:tid,action:'edited',detail:'renamed to "'+v+'"'}); await sysMsg(tid,'renamed to "'+v+'"'); }
      closeModal(); toast('Saved','ok'); renderPage();
    }catch(e){toast('Failed','err');}
  };
  window.accEditDue=async function(tid){
    const {data:t}=await ACC().from('ptasks').select('due_date,created_at').eq('id',tid).single();
    openModal(`<div class="modal-head"><h3>Due date</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" style="min-width:min(90vw,360px)"><input class="ac-in" type="date" id="edDueF" min="${todayISO()}" value="${(t&&t.due_date)||''}"></div><div class="modal-foot"><button class="ac-btn" onclick="closeModal()">Cancel</button><button class="ac-btn primary" onclick="accEditDueSave(${tid})"><i class="fa-solid fa-check"></i> Save</button></div>`,'md');
  };
  window.accEditDueSave=async function(tid){
    const due=$('edDueF').value||null;
    try{
      const {data:old}=await ACC().from('ptasks').select('due_date,created_at').eq('id',tid).single();
      if(due&&due<todayISO()){toast('Due date cannot be earlier than today','err');return;}
      const prevDue=old?old.due_date:null;
      await ACC().from('ptasks').update({due_date:due,overdue_emailed:false,due_emailed:false}).eq('id',tid);
      if((prevDue||'')!==(due||'')){
        await ACC().from('ptask_activity').insert({task_id:tid,action:'due date changed',detail:'Due date '+(prevDue?fmtDateY(prevDue):'none')+' → '+(due?fmtDateY(due):'none')});
        await sysMsg(tid, prevDue?('changed the due date from '+fmtDateY(prevDue)+' to '+(due?fmtDateY(due):'none')):('set the due date to '+(due?fmtDateY(due):'none')));
        if(due){ const _d=parseD(due), _t=new Date(); _t.setHours(0,0,0,0); if(_d&&_d<=_t){ try{ fetch('https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/overdue-mailer',{method:'POST',headers:{apikey:'sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n'}}); toast('Task is due \u2014 members notified by email','ok'); }catch(_e){} } }
      }
      closeModal(); toast('Saved','ok'); renderPage();
    }catch(e){toast('Failed','err');}
  };
  window.accEditProject=async function(tid){
    const [tR,pR]=await Promise.all([ACC().from('ptasks').select('project_id').eq('id',tid).single(),ACC().from('projects').select('id,name,department,created_by,owner').order('name')]);
    const t=tR.data;
    const projects=(pR.data||[]).filter(tagVisible); window._projMap={}; projects.forEach(x=>{window._projMap[x.id]=x.name;});
    openModal(`<div class="modal-head"><h3>Tag</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" style="min-width:min(90vw,420px)">
      ${projListWidget(projects,t.project_id)}
      <input type="hidden" id="etProj" value="${t.project_id||''}">
      <input class="ac-in" id="etNewProj" placeholder="New tag name" style="display:none;margin-top:8px">
    </div><div class="modal-foot"><button class="ac-btn" onclick="closeModal()">Cancel</button><button class="ac-btn primary" onclick="accEditProjectSave(${tid})"><i class="fa-solid fa-check"></i> Save</button></div>`,'md');
  };
  window.accEditProjectSave=async function(tid){
    try{
      const {data:old}=await ACC().from('ptasks').select('project_id').eq('id',tid).single();
      let pv=$('etProj').value, pid=null, newProjName=null;
      if(pv==='__new'){ const nm=($('etNewProj').value||'').trim(); if(nm){ const depts=myDepts(); const {data:pj}=await ACC().from('projects').insert({name:nm,created_by:me(),owner:me(),department:depts.length?depts:null}).select().single(); pid=pj?pj.id:null; newProjName=nm; } }
      else if(pv){ pid=Number(pv); newProjName=window._etProjLabel||''; }
      await ACC().from('ptasks').update({project_id:pid}).eq('id',tid);
      if((old?(old.project_id||null):null)!==(pid||null)){
        const detail=pid?('moved it to project '+(newProjName||'—')):'removed the project';
        await ACC().from('ptask_activity').insert({task_id:tid,action:'edited',detail:detail});
        await sysMsg(tid,detail);
      }
      closeModal(); toast('Saved','ok'); renderPage();
    }catch(e){toast('Failed','err');}
  };
  window.accEditMembers=async function(tid){ const [list,aR]=await Promise.all([people(),ACC().from('ptask_assignees').select('email').eq('task_id',tid)]); const {data:t}=await ACC().from('ptasks').select('delegator').eq('id',tid).single(); const others=list.filter(p=>!eq(p.email,(t&&t.delegator)||me())); const cur=(aR.data||[]).map(r=>r.email);
    openModal(`<div class="modal-head"><h3>Members <span style="font-size:12px;color:#94a3b8;font-weight:400">(owner cannot be a member)</span></h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" style="width:100%;box-sizing:border-box;overflow-x:hidden">${msWidget('emMembers',others,cur)}</div><div class="modal-foot"><button class="ac-btn" onclick="closeModal()">Cancel</button><button class="ac-btn primary" onclick="accEditMembersSave(${tid})"><i class="fa-solid fa-check"></i> Save</button></div>`,'md'); };
  window.accEditMembersSave=async function(tid){ const sel=msGet('emMembers'); if(!sel.length){toast('At least one member required','err');return;} try{ const [oR,list]=await Promise.all([ACC().from('ptask_assignees').select('email').eq('task_id',tid),people()]); const oldE=(oR.data||[]).map(r=>r.email); const added=sel.filter(e=>!oldE.some(o=>eq(o,e))); const removed=oldE.filter(e=>!sel.some(x=>eq(x,e))); if(removed.length)await ACC().from('ptask_assignees').delete().eq('task_id',tid).in('email',removed); if(added.length)await ACC().from('ptask_assignees').insert(added.map(e=>({task_id:tid,email:e}))); const parts=[]; if(added.length)parts.push('added '+added.map(e=>nameOf(list,e)).join(', ')); if(removed.length)parts.push('removed '+removed.map(e=>nameOf(list,e)).join(', ')); if(parts.length)await sysMsg(tid,parts.join('; ')+' as member'+((added.length+removed.length)>1?'s':'')); closeModal();toast('Members updated','ok');renderPage(); }catch(e){toast('Failed','err');} };
  window.accTaskDelete=function(tid){ accConfirm('Delete this task permanently?', async function(){ try{ const [{data:pf},{data:cm}]=await Promise.all([ ACC().from('ptask_files').select('storage_path').eq('task_id',tid), ACC().from('ptask_comments').select('attach_path').eq('task_id',tid).not('attach_path','is',null) ]); const paths=[...(pf||[]).map(x=>x.storage_path),...(cm||[]).map(x=>x.attach_path)].filter(Boolean); await ACC().from('ptasks').delete().eq('id',tid); if(paths.length)await Promise.all(paths.map(p=>s3Delete(p).catch(()=>{}))); toast('Deleted','ok');navTo('tasks/work');}catch(e){toast('Failed: '+((e&&e.message)||e),'err');} }); };

  window.accDelegate=async function(tid){ const list=await people(); const others=list.filter(p=>!eq(p.email,me()));
    openModal(`<div class="modal-head"><h3><i class="fa-solid fa-people-arrows"></i> Delegate task</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" style="width:100%;box-sizing:border-box;overflow-x:hidden"><p style="font-size:12.5px;color:var(--slate);margin:0 0 8px">Pick who to delegate to — they become members of a new task you own. People above you will not see it.</p>${msWidget('dgM',others,[])}</div><div class="modal-foot"><button class="ac-btn" onclick="closeModal()">Cancel</button><button class="ac-btn primary" onclick="accDelegateSave(${tid})"><i class="fa-solid fa-check"></i> Delegate</button></div>`,'lg'); };
  window.accDelegateSave=async function(pid){
    const sel=msGet('dgM'); if(!sel.length){toast('Pick at least one person','err');return;}
    try{
      const [{data:parent},{data:parentFiles}]=await Promise.all([
        ACC().from('ptasks').select('title,project_id,due_date').eq('id',pid).single(),
        ACC().from('ptask_files').select('file_name,storage_path,file_size,uploaded_by').eq('task_id',pid)
      ]);
      const {data:t,error}=await ACC().from('ptasks').insert({title:(parent&&parent.title)||'Task',project_id:(parent&&parent.project_id)||null,due_date:(parent&&parent.due_date)||null,delegator:me(),parent_task_id:pid,order_index:0}).select().single();
      if(error)throw error;
      await ACC().from('ptask_assignees').insert(sel.map(e=>({task_id:t.id,email:e})));
      if(parentFiles&&parentFiles.length){ await ACC().from('ptask_files').insert(parentFiles.map(f=>({task_id:t.id,file_name:f.file_name,storage_path:f.storage_path,file_size:f.file_size,uploaded_by:f.uploaded_by}))); }
      const r=await nextRankForMe(); await setMyRank(t.id,r);
      await ACC().from('ptask_activity').insert({task_id:pid,action:'delegated',detail:'Delegated to '+sel.length+' person(s)'});
      closeModal(); toast('Delegated','ok'); renderPage();
    }catch(e){ toast('Failed: '+((e&&e.message)||e),'err'); }
  };
  window.accConfirm=function(msg,cb,onCancel){ openModal(`<div class="modal-head"><h3><i class="fa-solid fa-triangle-exclamation" style="color:#d97706"></i> Please confirm</h3><span class="x" id="acConfX">&times;</span></div><div class="modal-body" style="min-width:min(90vw,420px)"><p style="font-size:13.5px;color:var(--body);line-height:1.5">${esc2(msg)}</p></div><div class="modal-foot"><button class="ac-btn" id="acConfNo">Cancel</button><button class="ac-btn danger" id="acConfYes"><i class="fa-solid fa-check"></i> Yes</button></div>`,'md'); const cancel=function(){ closeModal(); if(onCancel)onCancel(); }; const y=$('acConfYes'); if(y)y.onclick=function(){ closeModal(); cb(); }; const n=$('acConfNo'); if(n)n.onclick=cancel; const x=$('acConfX'); if(x)x.onclick=cancel; };
  window.accDecline=function(tid,notifId){ accConfirm('Decline this task? It will be sent back and restored to the assignee.', function(){ accApprove(tid,false,notifId); }); };
  function accPoll(fn){ clearInterval(window._accPoll); window._accPoll=setInterval(function(){ const ov=$('overlay'); if(ov&&ov.classList.contains('show'))return; if(window._dragging)return; const a=document.activeElement; if(a&&/INPUT|TEXTAREA/.test(a.tagName))return; fn(); },13000); }
  /* ---------- keyboard shortcuts (Accountability only) ---------- */
  document.addEventListener('keydown', function(e){
    if (typeof PAGE==='undefined' || PAGE!=='tasks') return;
    const tag=(e.target&&e.target.tagName)||'';
    const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
    const ov=$('overlay'); const modalOpen = !!(ov && ov.classList.contains('show'));
    const key=e.key;

    if (key==='/' && !typing) {
      if (modalOpen) {
        const input = document.querySelector('.modal-body .ms-search');
        if (input) { e.preventDefault(); input.focus(); input.select(); }
        return;
      }
      if (ROUTE.tab==='task') {
        const chatIn = $('chatIn');
        if (chatIn) { e.preventDefault(); chatIn.focus(); }
        return;
      }
      return;
    }

    if (typing || modalOpen || window._dragging) return;

    if ((key==='n'||key==='N') && ROUTE.tab==='work') {
      e.preventDefault();
      const inp=$('insInput')||$('selfInsInput'); if(inp)inp.focus();
      return;
    }
    if (key==='Delete' && ROUTE.tab==='task') {
      if (window._tp && window._tp.amOwner && ROUTE.taskId) { e.preventDefault(); accTaskDelete(ROUTE.taskId); }
      return;
    }
    if ((key==='a'||key==='A') && ROUTE.tab==='task') {
      if (window._tp && window._tp.canApprove && ROUTE.taskId) { e.preventDefault(); accApprove(ROUTE.taskId,true); }
      return;
    }
    if ((key==='d'||key==='D') && ROUTE.tab==='task') {
      if (window._tp && window._tp.canApprove && ROUTE.taskId) { e.preventDefault(); accDecline(ROUTE.taskId); }
      return;
    }
  });

  function init(){
    injectCss(); wireBell(); notifLoad(); setInterval(notifLoad,45000); window.addEventListener('focus',notifLoad);
    try{
      const qs=new URLSearchParams(location.search);
      const g=qs.get('google');
      if(g){
        if(g==='ok') toast('Google account connected','ok');
        else toast('Google connection failed'+(qs.get('msg')?(': '+decodeURIComponent(qs.get('msg'))):''),'err');
        qs.delete('google'); qs.delete('msg');
        const rest=qs.toString();
        history.replaceState(null,'',location.pathname+(rest?('?'+rest):'')+location.hash);
      }
    }catch(e){}
  }
  if(document.readyState==='complete'||document.readyState==='interactive') setTimeout(init,500); else window.addEventListener('load',()=>setTimeout(init,500));

  // Defensive re-render: nexus-core.js's boot sequence calls renderPage() inside an async
  // function, right after awaiting the auth check. With a warm/cached session that await can
  // resolve via microtasks fast enough to fire BEFORE this script (loaded after nexus-core.js)
  // has even finished downloading — so the page paints nexus-core.js's own legacy VIEWS.tasks
  // ("Home"/"Projects"/"Scoreboard") instead of the real Accountability UI, and nothing repaints
  // it until a hard refresh changes the timing. If that race already happened (shell is visible
  // by the time we get here), force one fresh render now that the real VIEWS.tasks is in place.
  try{
    if(window.PAGE==='tasks' && typeof renderPage==='function'){
      const shell=document.getElementById('shell');
      if(shell && shell.style.display==='block') renderPage();
    }
  }catch(e){}
})();
