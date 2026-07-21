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
  const STATUSES = ['Pending','Awaiting Approval','Completed'];

  function injectCss(){
    if (document.getElementById('accCss')) return;
    const s=document.createElement('style'); s.id='accCss';
    s.textContent = `
    .ac-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;border-bottom:1px solid var(--line)}
    .ac-tab{padding:9px 15px;font-size:13.5px;font-weight:600;color:var(--slate);cursor:pointer;border-bottom:2px solid transparent;display:flex;align-items:center;gap:7px}
    .ac-tab.active{color:var(--brand);border-bottom-color:var(--brand)}
    @media(max-width:700px){.ac-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;border-bottom:0}.ac-tab{justify-content:center;border:1px solid var(--line);border-radius:9px;padding:10px 8px}.ac-tab.active{background:var(--brand-a10,#eef2ff);border-color:var(--brand)}}
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
    .gcal-tbtn{border:1px solid #e5e7eb;background:#fff;color:#1f2937;border-radius:8px;height:34px;padding:0 12px;font-size:13px;font-weight:600;cursor:pointer;transition:background .12s}
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
    .gcal-yeargrid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;padding:18px}
    .gcal-year-month{border:1px solid #e5e7eb;border-radius:10px;padding:10px}
    .gcal-year-month-title{font-size:12.5px;font-weight:700;color:#1f2937;margin-bottom:6px;cursor:pointer;text-align:center}
    .gcal-year-month-title:hover{color:#2563eb}
    .gcal-sched-date{font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.03em;padding:14px 16px 6px}
    .gcal-sched-row{display:flex;align-items:center;gap:12px;padding:9px 16px;border-bottom:1px solid #f1f5f9;cursor:pointer}
    .gcal-sched-row:hover{background:#f8fafc}
    .gcal-sched-dot{width:10px;height:10px;border-radius:3px;flex:none}
    .gcal-sched-time{width:70px;flex:none;font-size:12px;color:#6b7280}
    .gcal-sched-title{flex:1;font-size:13.5px;color:#1f2937;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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
      .gcal-shell{flex-direction:column}
      .gcal-sidebar{width:100%;flex-direction:row;flex-wrap:wrap}
      .gcal-mini{flex:1;min-width:220px}
      .gcal-filters{flex:1;min-width:200px}
      .gcal-create{width:100%}
      .gcal-toolbar{flex-direction:column;align-items:stretch}
      .gcal-tb-nav{width:100%;justify-content:center}
      .gcal-toolbar-title{font-size:16px;flex:1;text-align:center}
      .gcal-search{width:100%;max-width:none;flex:none}
      .gcal-views{width:100%;margin-left:0;flex-wrap:wrap}
      .gcal-views .gcal-view-btn{flex:1 1 auto}
      .gcal-yeargrid{grid-template-columns:repeat(2,1fr);gap:12px;padding:12px}
      .gcal-mcell{min-height:56px}
      .gcal-mevents{flex-direction:row;flex-wrap:wrap;gap:4px}
      .gcal-mev{font-size:0;line-height:0;padding:0;width:6px;height:6px;min-width:6px;border-radius:50%;white-space:normal;overflow:visible}
      .gcal-panel{width:100%;max-width:100%}
      .gcal-fab{right:18px;bottom:18px}
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
  window.accNotifOpen=async function(id){ const n=NOTIFS.find(x=>x.id===id); if(!n)return; if(!n.read){try{await ACC().from('notifications').update({read:true}).eq('id',id);n.read=true;notifPaint();}catch(e){}} accNotifGoto(n.task_id); };
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
    if (seg[0]==='profile' && typeof taskProfile==='function') { ROUTE={tab:'profile',taskId:null}; return taskProfile(v); }
    let tab = seg[0] || 'work'; if(tab==='home')tab='work';
    ROUTE={tab:tab,taskId:null};
    setCrumb(['Accountability', tab==='work'?'Tasks':(tab.charAt(0).toUpperCase()+tab.slice(1))]);
    v.innerHTML = `<div class="page-head"><div><h1><i class="fa-solid fa-list-check" style="color:#1d4ed8"></i> Accountability</h1><p>Tasks, delegation & scoreboard</p></div></div>
    <div class="ac-tabs">
      <div class="ac-tab ${tab==='work'?'active':''}" onclick="navTo('tasks/work')"><i class="fa-solid fa-list-check"></i> Tasks</div>
      <div class="ac-tab ${tab==='calendar'?'active':''}" onclick="navTo('tasks/calendar')"><i class="fa-solid fa-calendar-days"></i> Calendar</div>
      <div class="ac-tab ${tab==='archive'?'active':''}" onclick="navTo('tasks/archive')"><i class="fa-solid fa-box-archive"></i> Archive</div>
      <div class="ac-tab ${tab==='scoreboard'?'active':''}" onclick="navTo('tasks/scoreboard')"><i class="fa-solid fa-ranking-star"></i> Scoreboard</div>
    </div><div id="acBody"><div class="loader"><div class="spin"></div></div></div>`;
    if (tab==='scoreboard') return scoreboardTab();
    if (tab==='calendar') return calendarTab();
    if (tab==='archive') return archiveTab();
    return tasksScreen();
  };

  /* ---------- shared row/card renderers ---------- */
  function dueBadge(due){
    const d=parseD(due); if(!d) return '';
    d.setHours(0,0,0,0);
    const today=new Date(); today.setHours(0,0,0,0);
    if(d.getTime()<today.getTime()) return '<span class="ac-chip" style="background:#fee2e2;color:#b91c1c;margin-left:6px">Overdue</span>';
    if(d.getTime()===today.getTime()) return '<span class="ac-chip" style="background:#ffedd5;color:#c2410c;margin-left:6px">Due today</span>';
    return '';
  }
  function miniRow(t,list,asg,opt){
    opt=opt||{};
    const emails=opt.ownerAvatar?[t.delegator].filter(Boolean):((asg&&asg[t.id])||[]);
    const metaParts=[];
    if(opt.showDoneDate&&t.completed_at) metaParts.push(`<i class="fa-solid fa-circle-check" style="color:#16a34a"></i> Marked done ${fmtDate(t.completed_at)}`);
    if(t._projName) metaParts.push(`<i class="fa-solid fa-diagram-project"></i> ${esc2(t._projName)}`);
    if(t.due_date) metaParts.push(`<i class="fa-regular fa-calendar"></i> ${fmtDate(t.due_date)}`);
    const meta=metaParts.length?`<div class="rtd">${metaParts.join(' · ')}</div>`:'';
    return `<div class="ac-row" onclick="navTo('tasks/task/${t.id}${opt.ro?'/ro':''}')"><div class="ti"><div class="t">${esc2(t.title)}</div></div><div class="rt">${meta}${dueBadge(t.due_date)}${emails.length?avatars(list,emails):''}</div></div>`;
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

  /* ---------- SCOREBOARD ---------- */
  async function scoreboardTab(){ const b=$('acBody'); let rows=[]; try{const {data}=await ACC().rpc('scoreboard');rows=data||[];}catch(e){} const medal=i=>i===0?'🥇':i===1?'🥈':i===2?'🥉':'<b style="color:var(--slate)">'+(i+1)+'</b>';
    rows=rows.map(r=>Object.assign({},r,{score:(r.tasks_completed||0)*1+(r.tasks_on_time||0)*1-(r.tasks_late||0)*1})).sort((a,b)=>b.score-a.score);
    b.innerHTML=`<div class="tp-card" style="padding:0"><div style="padding:14px 16px;border-bottom:1px solid var(--line)"><b>Scoreboard</b><div style="font-size:12px;color:var(--slate)">task completed +1 · on-time +1 · overdue −1 (declines automatically reverse the credit)</div></div><div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr><th>#</th><th>Person</th><th>Tasks</th><th>Sub</th><th>On-time</th><th>Overdue</th><th>Score</th></tr></thead><tbody>${rows.length?rows.map((r,i)=>`<tr><td>${medal(i)}</td><td><b>${esc2(r.full_name||r.email)}</b></td><td>${r.tasks_completed}</td><td>${r.checklist_items_done}</td><td style="color:#16a34a">${r.tasks_on_time}</td><td style="color:#dc2626">${r.tasks_late}</td><td style="font-weight:800">${r.score}</td></tr>`).join(''):'<tr><td colspan="7"><div class="ac-empty" style="cursor:default;border:0">No activity yet</div></td></tr>'}</tbody></table></div></div>`; }

  /* ---------- CALENDAR (Google-Calendar-inspired UI) ---------- */
  let GCAL_VIEW='month', GCAL_DATE=null, GCAL_MINI_MONTH=null, GCAL_Q='';
  let GCAL_FILTERS=new Set(['toMe','byMe']);
  let GCAL_LAST=null; // {byDate,list,asg}
  function calShiftISO(iso,delta){ const d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()+delta); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function gcalWeekBounds(dateStr){
    const d=new Date(dateStr+'T00:00:00'); const off=(d.getDay()+6)%7;
    const mon=new Date(d); mon.setDate(d.getDate()-off);
    const sun=new Date(mon); sun.setDate(mon.getDate()+6);
    const iso=x=>x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
    return [iso(mon),iso(sun)];
  }
  async function gcalLoadData(){
    const [list,{tasks,asg}]=await Promise.all([people(), loadAll()]);
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
    return items.filter(x=>{
      if(!GCAL_FILTERS.has(x.kind))return false;
      if(GCAL_Q && !String(x.t.title||'').toLowerCase().includes(GCAL_Q))return false;
      return true;
    });
  }
  function gcalEvColor(kind){ return kind==='toMe'?'#2563eb':'#16a34a'; }

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
      const has=!!(GCAL_LAST&&GCAL_LAST.byDate[dateStr]&&GCAL_LAST.byDate[dateStr].length);
      const cls='gcal-mini-day'+(dateStr===todayStr?' today':'')+(dateStr===GCAL_DATE?' selected':'')+(has?' has':'');
      cells+='<div class="'+cls+'" onclick="gcalMiniPick(\''+dateStr+'\')">'+d+'</div>';
    }
    const trailing=(7-((startOffset+daysInMonth)%7))%7;
    for(let i=1;i<=trailing;i++) cells+='<div class="gcal-mini-day other">'+i+'</div>';
    const dow=['M','T','W','T','F','S','S'];
    return '<div class="gcal-mini"><div class="gcal-mini-head"><div class="gcal-mini-title">'+esc2(label)+'</div><div class="gcal-mini-nav"><button onclick="gcalMiniNav(-1)"><i class="fa-solid fa-chevron-left"></i></button><button onclick="gcalMiniNav(1)"><i class="fa-solid fa-chevron-right"></i></button></div></div><div class="gcal-mini-grid">'+dow.map(d=>'<div class="gcal-mini-dow">'+d+'</div>').join('')+cells+'</div></div>';
  }
  window.gcalMiniNav=function(delta){ if(!GCAL_MINI_MONTH)GCAL_MINI_MONTH=new Date(); const d=new Date(GCAL_MINI_MONTH); d.setMonth(d.getMonth()+delta); GCAL_MINI_MONTH=d; gcalRenderOnly(); };
  // Picking a date from the mini calendar always jumps straight to that day, whichever view (Year/Month/Week/Schedule) you were on.
  window.gcalMiniPick=function(dateStr){ GCAL_DATE=dateStr; const d=new Date(dateStr+'T00:00:00'); GCAL_MINI_MONTH=new Date(d.getFullYear(),d.getMonth(),1); GCAL_VIEW='day'; gcalRenderOnly(); };

  /* ---- sidebar: quick filters ---- */
  function gcalFiltersHtml(){
    const rows=[['toMe','Assigned to me','#2563eb'],['byMe','Assigned by me','#16a34a']].map(function(f){
      return '<label class="gcal-filter-row"><input type="checkbox" '+(GCAL_FILTERS.has(f[0])?'checked':'')+' onchange="gcalToggleFilter(\''+f[0]+'\',this.checked)"><span class="gcal-filter-dot" style="background:'+f[2]+'"></span>'+f[1]+'</label>';
    }).join('');
    return '<div class="gcal-filters"><div class="gcal-filters-title">Quick filters</div>'+rows
      +'<div class="gcal-filter-row soon"><span class="gcal-filter-dot" style="background:#e5e7eb"></span>Meetings<span style="margin-left:auto;font-size:10.5px">Soon</span></div>'
      +'</div>';
  }
  window.gcalToggleFilter=function(k,on){ if(on)GCAL_FILTERS.add(k); else GCAL_FILTERS.delete(k); gcalRenderOnly(); };

  /* ---- toolbar ---- */
  function gcalToolbarHtml(){
    let title='';
    if(GCAL_VIEW==='month'){ title=new Date(GCAL_DATE+'T00:00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'}); }
    else if(GCAL_VIEW==='week'){
      const b=gcalWeekBounds(GCAL_DATE), sd=new Date(b[0]+'T00:00:00'), ed=new Date(b[1]+'T00:00:00');
      title = sd.getMonth()===ed.getMonth() ? (sd.toLocaleDateString('en-IN',{month:'long'})+' '+sd.getDate()+'–'+ed.getDate()+', '+ed.getFullYear()) : (sd.toLocaleDateString('en-IN',{month:'short',day:'numeric'})+' – '+ed.toLocaleDateString('en-IN',{month:'short',day:'numeric',year:'numeric'}));
    }
    else if(GCAL_VIEW==='day'){ title=new Date(GCAL_DATE+'T00:00:00').toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'}); }
    else if(GCAL_VIEW==='year'){ title=String(new Date(GCAL_DATE+'T00:00:00').getFullYear()); }
    else { title='Schedule'; }
    const views=[['day','Day'],['week','Week'],['month','Month'],['year','Year'],['schedule','Schedule']];
    return '<div class="gcal-toolbar">'
      +'<div class="gcal-tb-nav">'
      +'<button class="gcal-tbtn" onclick="gcalToday()">Today</button>'
      +'<button class="gcal-tbtn ic" onclick="gcalNav(-1)" title="Previous"><i class="fa-solid fa-chevron-left"></i></button>'
      +'<button class="gcal-tbtn ic" onclick="gcalNav(1)" title="Next"><i class="fa-solid fa-chevron-right"></i></button>'
      +'<div class="gcal-toolbar-title">'+esc2(title)+'</div>'
      +'</div>'
      +'<div class="gcal-search"><i class="fa-solid fa-magnifying-glass"></i><input placeholder="Search" value="'+esc2(GCAL_Q)+'" oninput="gcalSearch(this.value)"></div>'
      +'<div class="gcal-views">'+views.map(function(v){ return '<button class="gcal-view-btn '+(GCAL_VIEW===v[0]?'active':'')+'" onclick="gcalSetView(\''+v[0]+'\')">'+v[1]+'</button>'; }).join('')+'</div>'
      +'</div>';
  }
  window.gcalSetView=function(v){ GCAL_VIEW=v; gcalRenderOnly(); };
  window.gcalToday=function(){ GCAL_DATE=todayISO(); const d=new Date(); GCAL_MINI_MONTH=new Date(d.getFullYear(),d.getMonth(),1); gcalRenderOnly(); };
  window.gcalNav=function(delta){
    const d=new Date(GCAL_DATE+'T00:00:00');
    if(GCAL_VIEW==='month'){ d.setDate(1); d.setMonth(d.getMonth()+delta); }
    else if(GCAL_VIEW==='week'){ d.setDate(d.getDate()+delta*7); }
    else if(GCAL_VIEW==='day'){ d.setDate(d.getDate()+delta); }
    else if(GCAL_VIEW==='year'){ d.setFullYear(d.getFullYear()+delta); }
    else { d.setMonth(d.getMonth()+delta); } // schedule: page by month
    GCAL_DATE=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    GCAL_MINI_MONTH=new Date(d.getFullYear(),d.getMonth(),1);
    gcalRenderOnly();
  };
  window.gcalSearch=function(v){ GCAL_Q=(v||'').trim().toLowerCase(); const body=$('gcalBody'); if(body)body.innerHTML=gcalBodyHtml(); };

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
        return '<div class="gcal-mev" style="background:'+gcalEvColor(x.kind)+'" onclick="event.stopPropagation();gcalOpenTask('+x.t.id+')" title="'+esc2(x.t.title)+'">'+esc2(x.t.title)+'</div>';
      }).join('');
      const cls='gcal-mcell'+(dateStr===todayStr?' today':'');
      cells+='<div class="'+cls+'" onclick="gcalOpenDay(\''+dateStr+'\')"><div class="gcal-mnum">'+d+'</div><div class="gcal-mevents">'+evs+'</div></div>';
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
        const has=!!(GCAL_LAST&&GCAL_LAST.byDate[dateStr]&&gcalVisibleItems(dateStr).length);
        const cls='gcal-mini-day'+(dateStr===todayStr?' today':'')+(has?' has':'');
        cells+='<div class="'+cls+'" onclick="gcalYearPick(\''+dateStr+'\')">'+d+'</div>';
      }
      months+='<div class="gcal-year-month"><div class="gcal-year-month-title" onclick="gcalYearMonthOpen('+y+','+mi+')">'+esc2(monthLabel)+'</div><div class="gcal-mini-grid">'+cells+'</div></div>';
    }
    return '<div class="gcal-yeargrid">'+months+'</div>';
  }
  window.gcalYearPick=function(dateStr){ GCAL_DATE=dateStr; GCAL_VIEW='day'; const d=new Date(dateStr+'T00:00:00'); GCAL_MINI_MONTH=new Date(d.getFullYear(),d.getMonth(),1); gcalRenderOnly(); };
  window.gcalYearMonthOpen=function(y,mi){ GCAL_DATE=y+'-'+String(mi+1).padStart(2,'0')+'-01'; GCAL_VIEW='month'; GCAL_MINI_MONTH=new Date(y,mi,1); gcalRenderOnly(); };

  /* ---- Week view ---- */
  function gcalHourLabel(h){ return h===0?'12 AM':(h<12?h+' AM':(h===12?'12 PM':(h-12)+' PM')); }
  function gcalWeekHtml(){
    const b=gcalWeekBounds(GCAL_DATE);
    const days=[]; let cur=b[0];
    for(let i=0;i<7;i++){ days.push(cur); cur=calShiftISO(cur,1); }
    const todayStr=todayISO();
    const heads=days.map(function(dateStr){
      const d=new Date(dateStr+'T00:00:00'); const isToday=dateStr===todayStr;
      return '<div class="gcal-daycolhead'+(isToday?' today':'')+'">'+d.toLocaleDateString('en-IN',{weekday:'short'})+'<span class="n">'+d.getDate()+'</span></div>';
    }).join('');
    const alldayCols=days.map(function(dateStr){
      const items=gcalVisibleItems(dateStr);
      const chips=items.map(function(x){ return '<div class="gcal-mev" style="background:'+gcalEvColor(x.kind)+'" onclick="gcalOpenTask('+x.t.id+')" title="'+esc2(x.t.title)+'">'+esc2(x.t.title)+'</div>'; }).join('');
      return '<div class="gcal-allday-col">'+chips+'</div>';
    }).join('');
    const hours=[]; for(let h=0;h<24;h++) hours.push(h);
    const hourLabels=hours.map(function(h){ return '<div class="gcal-hour">'+gcalHourLabel(h)+'</div>'; }).join('');
    const dayCols=days.map(function(dateStr){
      let inner=hours.map(function(){ return '<div class="gcal-hourline"></div>'; }).join('');
      if(dateStr===todayStr){ const now=new Date(); const pct=((now.getHours()*60+now.getMinutes())/1440)*100; inner+='<div class="gcal-nowline" style="top:'+pct+'%"><div class="gcal-nowdot"></div></div>'; }
      return '<div class="gcal-daycol">'+inner+'</div>';
    }).join('');
    return '<div class="gcal-wrap">'
      +'<div style="display:flex;border-bottom:1px solid #e5e7eb"><div style="width:56px;flex:none"></div><div style="flex:1;display:grid;grid-template-columns:repeat(7,1fr)">'+heads+'</div></div>'
      +'<div class="gcal-allday"><div class="gcal-allday-label">All-day</div><div class="gcal-allday-cols" style="grid-template-columns:repeat(7,1fr)">'+alldayCols+'</div></div>'
      +'<div class="gcal-timegrid"><div class="gcal-hours">'+hourLabels+'</div><div class="gcal-daycols" style="grid-template-columns:repeat(7,1fr)">'+dayCols+'</div></div>'
      +'</div>';
  }

  /* ---- Day view ---- */
  function gcalDayHtml(){
    const dateStr=GCAL_DATE;
    const items=gcalVisibleItems(dateStr);
    const chips=items.map(function(x){ return '<div class="gcal-mev" style="background:'+gcalEvColor(x.kind)+'" onclick="gcalOpenTask('+x.t.id+')" title="'+esc2(x.t.title)+'">'+esc2(x.t.title)+'</div>'; }).join('');
    const hours=[]; for(let h=0;h<24;h++) hours.push(h);
    const hourLabels=hours.map(function(h){ return '<div class="gcal-hour">'+gcalHourLabel(h)+'</div>'; }).join('');
    const todayStr=todayISO();
    let dayInner=hours.map(function(){ return '<div class="gcal-hourline"></div>'; }).join('');
    if(dateStr===todayStr){ const now=new Date(); const pct=((now.getHours()*60+now.getMinutes())/1440)*100; dayInner+='<div class="gcal-nowline" style="top:'+pct+'%"><div class="gcal-nowdot"></div></div>'; }
    return '<div class="gcal-wrap">'
      +'<div class="gcal-allday"><div class="gcal-allday-label">All-day</div><div class="gcal-allday-cols" style="grid-template-columns:1fr"><div class="gcal-allday-col">'+(chips||'<span style="font-size:11.5px;color:#9ca3af">No tasks due</span>')+'</div></div></div>'
      +'<div class="gcal-timegrid"><div class="gcal-hours">'+hourLabels+'</div><div class="gcal-daycols" style="grid-template-columns:1fr"><div class="gcal-daycol">'+dayInner+'</div></div></div>'
      +'</div>';
  }

  /* ---- Schedule / agenda view ---- */
  function gcalScheduleHtml(){
    let rows='', cur=GCAL_DATE, any=false;
    for(let i=0;i<60;i++){
      const items=gcalVisibleItems(cur);
      if(items.length){
        any=true;
        const d=new Date(cur+'T00:00:00');
        rows+='<div class="gcal-sched-date">'+d.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})+'</div>';
        items.forEach(function(x){
          rows+='<div class="gcal-sched-row" onclick="gcalOpenTask('+x.t.id+')">'
            +'<span class="gcal-sched-dot" style="background:'+gcalEvColor(x.kind)+'"></span>'
            +'<span class="gcal-sched-time">'+(x.kind==='toMe'?'To me':'By me')+'</span>'
            +'<span class="gcal-sched-title">'+esc2(x.t.title)+'</span>'
            +'</div>';
        });
      }
      cur=calShiftISO(cur,1);
    }
    if(!any) rows='<div class="gcal-empty-view"><i class="fa-regular fa-calendar-check" style="font-size:26px;display:block;margin-bottom:8px"></i>No upcoming items in the next 60 days</div>';
    return rows;
  }

  function gcalBodyHtml(){
    if(GCAL_VIEW==='month') return gcalMonthHtml();
    if(GCAL_VIEW==='week') return gcalWeekHtml();
    if(GCAL_VIEW==='day') return gcalDayHtml();
    if(GCAL_VIEW==='year') return gcalYearHtml();
    return gcalScheduleHtml();
  }

  /* ---- right details panel ---- */
  function gcalShowPanel(bodyHtml,tid){
    const panel=$('gcalPanel'), backdrop=$('gcalBackdrop'); if(!panel)return;
    const bodyEl=panel.querySelector('.gcal-panel-body'); if(bodyEl)bodyEl.innerHTML=bodyHtml;
    const foot=panel.querySelector('.gcal-panel-foot');
    if(foot)foot.innerHTML = tid
      ? '<button class="ac-btn" onclick="gcalClosePanel()">Close</button><button class="ac-btn primary" onclick="navTo(\'tasks/task/'+tid+'\')"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open full task</button>'
      : '<button class="ac-btn" onclick="gcalClosePanel()">Close</button>';
    panel.classList.add('open'); if(backdrop)backdrop.classList.add('open');
  }
  window.gcalClosePanel=function(){ const panel=$('gcalPanel'), backdrop=$('gcalBackdrop'); if(panel)panel.classList.remove('open'); if(backdrop)backdrop.classList.remove('open'); };
  window.gcalOpenDay=function(dateStr){
    const items=gcalVisibleItems(dateStr);
    const label=new Date(dateStr+'T00:00:00').toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    const rows=items.length?items.map(function(x){
      return '<div class="gcal-panel-row" style="cursor:pointer" onclick="gcalOpenTask('+x.t.id+')"><i class="fa-solid fa-circle" style="font-size:8px;color:'+gcalEvColor(x.kind)+';margin-top:5px"></i><div style="flex:1">'+esc2(x.t.title)+'</div></div>';
    }).join(''):'<div style="color:#9ca3af;font-size:13px">No tasks this day</div>';
    gcalShowPanel('<div class="gcal-panel-title">'+esc2(label)+'</div>'+rows, null);
  };
  window.gcalOpenTask=function(tid){
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
  window.gcalQuickAdd=function(){ toast('Creating from the Calendar is disabled for now — it\'ll come back in a different form once Meetings are added.',''); };

  /* ---- shell / entry point ---- */
  function gcalRenderOnly(){
    const b=$('acBody'); if(!b)return;
    b.innerHTML='<div class="gcal-shell">'
      +'<div class="gcal-sidebar"><div class="gcal-create disabled" onclick="gcalQuickAdd()" title="Coming soon with Meetings"><i class="fa-solid fa-plus"></i> Create</div>'+gcalMiniHtml()+gcalFiltersHtml()+'</div>'
      +'<div class="gcal-main">'+gcalToolbarHtml()+'<div class="gcal-body" id="gcalBody">'+gcalBodyHtml()+'</div></div>'
      +'</div>'
      +'<div class="gcal-backdrop" id="gcalBackdrop" onclick="gcalClosePanel()"></div>'
      +'<div class="gcal-panel" id="gcalPanel"><div class="gcal-panel-head"><b>Details</b><div class="x" onclick="gcalClosePanel()"><i class="fa-solid fa-xmark"></i></div></div><div class="gcal-panel-body"></div><div class="gcal-panel-foot"></div></div>'
      +'<button class="gcal-fab disabled" onclick="gcalQuickAdd()" title="Coming soon with Meetings"><i class="fa-solid fa-plus"></i></button>';
  }
  async function calendarTab(){
    if(!GCAL_DATE) GCAL_DATE=todayISO();
    if(!GCAL_MINI_MONTH){ const d=new Date(GCAL_DATE+'T00:00:00'); GCAL_MINI_MONTH=new Date(d.getFullYear(),d.getMonth(),1); }
    await gcalLoadData();
    gcalRenderOnly();
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
    const grp=(label,arr,opt)=> arr.length?(`<div class="ac-seclbl">${label}</div>`+arr.map(t=>miniRow(t,list,asg,opt)).join('')):'';
    const inner=(byMe.length||toMe.length||self.length)?(grp('Assigned by me',byMe,{showDoneDate:true,ro:true})+grp('Assigned to me',toMe,{ownerAvatar:true,showDoneDate:true,ro:true})+grp('Self Tasks',self,{showDoneDate:true,ro:true})):'<div class="ac-empty" style="cursor:default">No completed tasks yet</div>';
    b.innerHTML=`<div class="ac-card"><div class="hd"><i class="fa-solid fa-box-archive"></i> All completed tasks<span class="cnt">${done.length}</span></div><div class="bd" style="height:auto;max-height:none;overflow:visible">${inner}</div></div>`;
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
    const doneDate=(opt.showDoneDate&&t.completed_at)?`<i class="fa-solid fa-circle-check" style="color:#16a34a"></i> Marked done ${fmtDate(t.completed_at)}`:'';
    const metaParts=[t.due_date?`<i class="fa-regular fa-calendar"></i> ${fmtDate(t.due_date)}`:'',t._projName?`<i class="fa-solid fa-diagram-project"></i> ${esc2(t._projName)}`:'',doneDate].filter(Boolean);
    const meta=metaParts.length?`<div class="rtd">${metaParts.join(' · ')}</div>`:'';
    return `<div class="ac-row" data-id="${t.id}" onclick="navTo('tasks/task/${t.id}')"${hover}>${chk}${grip}${letterHtml}<div class="ti"><div class="t">${esc2(t.title)}</div></div><div class="rt">${meta}${emails.length?avatars(list,emails):''}</div>${approve}</div>`;
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
    window._tp={dueHist,list,amOwner,tid,canApprove:(amOwner&&st==='await'),selfTask,comments};
    let A='';
    if(locked){
      // Archive / Completed-this-week view, still completed: no workflow actions here —
      // Reopen (below) is the sole action the owner gets, until they use it.
    } else if(selfTask){
      if(st==='open') A=`<button class="ac-btn primary" onclick="accMarkDone(${tid},true)"><i class="fa-regular fa-circle-check"></i> Mark Done</button>`;
    } else {
      if(amMember&&st==='open') A+=`<button class="ac-btn primary" onclick="accMarkDone(${tid},false)"><i class="fa-regular fa-circle-check"></i> Mark Done</button>`;
      else if(amMember&&st==='await') A+=`<button class="ac-btn" disabled><i class="fa-solid fa-hourglass-half"></i> Awaiting Approval</button>`;
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

  function init(){ injectCss(); wireBell(); notifLoad(); setInterval(notifLoad,45000); window.addEventListener('focus',notifLoad); }
  if(document.readyState==='complete'||document.readyState==='interactive') setTimeout(init,500); else window.addEventListener('load',()=>setTimeout(init,500));
})();
