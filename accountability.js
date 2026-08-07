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
    /* Hide scrollbars page-wide on Accountability — scrolling still works, just no visible bar (vertical or horizontal) */
    *{scrollbar-width:none;-ms-overflow-style:none}
    *::-webkit-scrollbar{width:0;height:0;display:none}
    .ac-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;border-bottom:1px solid var(--line)}
    .ac-tab{padding:9px 15px;font-size:13.5px;font-weight:600;color:var(--slate);cursor:pointer;border-bottom:2px solid transparent;display:flex;align-items:center;gap:7px}
    .ac-tab.active{color:var(--brand);border-bottom-color:var(--brand)}
    @media(max-width:700px){.ac-tabs{display:flex;flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;gap:8px;border-bottom:0;padding:2px 2px 8px;margin-bottom:12px}.ac-tabs::-webkit-scrollbar{display:none}.ac-tab{flex:0 0 auto;white-space:nowrap;justify-content:center;border:1px solid var(--line);border-radius:20px;padding:9px 15px;font-size:13px;gap:7px}.ac-tab.active{background:var(--brand-a10,#eef2ff);border-color:var(--brand);color:var(--brand)}}
    .ac-3p{display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap}
    .ac-pbtn{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 14px;border:1px solid var(--line);border-radius:20px;background:var(--bg-card);color:var(--body);font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit}
    .ac-pbtn.on{background:var(--brand);border-color:var(--brand);color:#fff}
    .ac-btn{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 13px;border:1px solid var(--line);border-radius:9px;background:var(--bg-card);color:var(--ink);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
    .ac-btn:hover{border-color:var(--brand);color:var(--brand)}
    .wf-inst-tools .ac-btn:disabled{opacity:.4;cursor:default;pointer-events:none}
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
    .wf-tip{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--slate);color:#fff;font:italic 700 11px/1 Georgia,'Times New Roman',serif;letter-spacing:0;text-transform:none;cursor:pointer;position:relative;flex:none;margin-left:5px;vertical-align:middle;outline:none;user-select:none;padding-right:1px}
    .wf-tip:hover,.wf-tip:focus{background:var(--brand)}
    .wf-poptip{position:relative;cursor:pointer}
    /* the bubble text lives in the markup only as the content source - it is never shown in place
       (cards/modals with overflow would clip it). wfTipShow() copies it into #wfTipLayer on <body>. */
    .wf-tip-txt{display:none}
    #wfTipLayer{position:fixed;top:0;left:0;z-index:2147483600;background:#1e293b;color:#fff;padding:7px 10px;border-radius:7px;font-size:11.5px;font-weight:500;line-height:1.5;width:max-content;max-width:min(260px,80vw);text-align:center;white-space:normal;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .12s;box-shadow:0 8px 22px rgba(0,0,0,.28)}
    #wfTipLayer.show{opacity:1;visibility:visible}
    #wfTipLayer::after{content:'';position:absolute;top:100%;left:var(--tipx,50%);transform:translateX(-50%);border:5px solid transparent;border-top-color:#1e293b}
    #wfTipLayer.below::after{top:auto;bottom:100%;border-top-color:transparent;border-bottom-color:#1e293b}
    /* ----- Workflow builder form -----
       Two sections (Basics, Steps). Paired fields go side by side from 760px up and
       stack below that; every field owns its own label so nothing drifts out of line. */
    .wf-form{display:flex;flex-direction:column;gap:24px}
    .wf-fsec{display:flex;flex-direction:column;gap:13px}
    .wf-fsec-h{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--slate);display:flex;align-items:center;gap:8px;padding-bottom:9px;border-bottom:1px solid var(--line)}
    .wf-fsec-h i{color:var(--brand);font-size:12px}
    .wf-fgrid{display:grid;grid-template-columns:1fr 1fr;gap:15px 20px;align-items:start}
    .wf-fld{display:flex;flex-direction:column;min-width:0}
    .wf-fld-wide{grid-column:1/-1}
    .wf-fld .wf-lbl{margin:0 0 6px}
    /* Every control in the builder is exactly 40px tall and shares one text inset, so the
       labels, inputs, person pickers and dropdowns all line up on the same edges. */
    .wf-fld .ac-in{width:100%;box-sizing:border-box}
    .wf-fld input.ac-in,.wf-step-fields input.ac-in,.wf-evt-form input.ac-in{height:40px;padding-top:0;padding-bottom:0}
    .wf-fld .ac-in,.wf-step-fields .ac-in,.wf-step-fields .wf-pp-nm,.wf-step-fields .wf-pp-ph{font-size:13px}
    .wf-fld .ac-in::placeholder,.wf-step-fields .ac-in::placeholder{font-size:13px;color:#94a3b8}
    .wf-step-sub input[type=number].ac-in{appearance:textfield;-moz-appearance:textfield}
    .wf-step-sub input[type=number].ac-in::-webkit-outer-spin-button,.wf-step-sub input[type=number].ac-in::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
    /* native selects sit at a different height/inset per OS — draw our own caret instead */
    .wf-step-sub select.ac-in,.wf-fld select.ac-in{appearance:none;-webkit-appearance:none;-moz-appearance:none;height:40px;padding:0 30px 0 12px;cursor:pointer;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2364748b' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;background-size:11px 8px}
    .wf-step-sub select.ac-in::-ms-expand,.wf-fld select.ac-in::-ms-expand{display:none}
    .wf-steps-head{margin-top:20px}
    /* Step card: a header strip carries the number and the remove button, so the inputs
       underneath run the full width of the card rather than being pinched between them. */
    .wf-step{display:block;padding:12px 13px 13px;border:1px solid var(--line);border-radius:12px;margin-bottom:10px;background:var(--bg-card)}
    .wf-step:hover{border-color:#cbd5e1}
    .wf-step-hd{display:flex;align-items:center;gap:9px;margin-bottom:10px}
    .wf-step-num{flex:0 0 24px;height:24px;border-radius:50%;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}
    .wf-step-hd-t{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--slate)}
    .wf-step-fields{min-width:0;display:flex;flex-direction:column;gap:8px}
    .wf-step-sub{display:flex;gap:8px;min-width:0}
    .wf-step-sub .wf-s-person{flex:1 1 auto;min-width:0}
    .wf-step-sub .wf-s-dur{flex:0 0 104px;min-width:0}
    .wf-step-sub .wf-s-unit{flex:0 0 108px;min-width:0}
    .wf-s-del{margin-left:auto;flex:0 0 auto}
    .wf-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
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
    /* Workflow step person picker (avatar + department-grouped).
       NOTE the .ac-in.wf-pp-btn selector: the picker also carries .ac-in, whose padding rule is
       declared further down this sheet and would otherwise win on source order and make the
       picker 46px tall next to 40px inputs. The doubled class keeps it aligned. */
    .wf-step-sub .wf-pp{flex:2;min-width:0}
    .wf-pp{position:relative}
    .ac-in.wf-pp-btn{width:100%;height:40px;min-height:40px;box-sizing:border-box;display:flex;align-items:center;gap:9px;padding:0 12px;text-align:left;cursor:pointer;line-height:1;overflow:hidden}
    .ac-in.wf-pp-btn:hover{border-color:var(--brand)}
    .wf-pp.open>.ac-in.wf-pp-btn{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
    .wf-pp-av{width:22px;height:22px;border-radius:50%;color:#fff;font-size:9.5px;font-weight:700;display:grid;place-items:center;flex:none}
    .wf-pp-nm{font-size:13px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
    .wf-pp-ph{font-size:13px;color:var(--slate);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
    .wf-pp-caret{margin-left:auto;color:var(--slate);font-size:11px;flex:none;transition:transform .15s}
    .wf-pp.open .wf-pp-caret{transform:rotate(180deg)}
    /* Panel matches the trigger's width exactly (left:0 + right:0, no min-width). Anything
       wider — the old min-width:220px — pushed past the card and gave the page a sideways
       scrollbar whenever the picker sat in a narrow column. */
    .wf-pp-panel{position:absolute;top:calc(100% + 5px);left:0;right:0;width:auto;min-width:0;max-width:none;z-index:60;background:var(--bg-card);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 28px rgba(15,23,42,.18);padding:6px;display:none;max-height:min(300px,50vh);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}
    .wf-pp.open .wf-pp-panel{display:block}
    .wf-pp-panel .ms-search{margin-bottom:6px;width:100%;box-sizing:border-box;height:36px}
    /* The person list reuses the shared .ms-dept / .ms-opt / avatar styles (nexus.css) so it
       matches the app's other member dropdown exactly. */
    .wf-pp-panel .ms-opt.on{background:var(--brand-a10,#eef2ff)}
    /* Workflow form responsiveness — kept AFTER the picker rules above, otherwise
       the wf-step-sub wf-pp flex:2 rule wins on source order and the picker stays squashed. */
    @media(max-width:760px){.wf-fgrid{grid-template-columns:1fr;gap:14px}}
    @media(max-width:700px){
      .wf-step-sub{flex-wrap:wrap}
      .wf-step-sub .wf-s-person,.wf-step-sub .wf-pp{flex:1 1 100%}
      /* duration + unit split the row evenly instead of leaving a ragged gap */
      .wf-step-sub .wf-s-dur,.wf-step-sub .wf-s-unit{flex:1 1 0;min-width:0}
      .wf-step{padding:11px}
      .wf-form{gap:20px}
      .wf-actions .ac-btn{flex:1;justify-content:center}
      .wf-owner-pick{flex-wrap:wrap}
      .wf-owner-pick .wf-pp{flex:1 1 100%}
    }
    .wf-tl-desc{font-size:12.5px;color:var(--slate);margin-top:3px;line-height:1.5}
    .ac-addrow{display:flex;gap:8px;margin:3px 0}
    .ac-addrow-ghost{display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:9px;border:1px dashed var(--line);color:var(--slate);font-size:13px;cursor:pointer;margin:3px 0;transition:.15s}
    .ac-addrow-ghost:hover{border-color:var(--brand);color:var(--brand);background:var(--brand-a10)}
    .ac-addrow input{flex:1;border:1px solid var(--brand);border-radius:9px;padding:9px 11px;font-size:13px;font-family:inherit;box-shadow:0 0 0 3px var(--brand-a10)}
    @media(hover:none){ .ac-in,.ac-addrow input,input,select,textarea{font-size:16px} }
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
    .gcal-mcell{min-height:104px;min-width:0;overflow:hidden;border-right:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;padding:6px;display:flex;flex-direction:column;gap:3px;cursor:pointer;transition:background .1s}
    .gcal-mcell:nth-child(7n){border-right:0}
    .gcal-mcell:hover{background:#f8fafc}
    .gcal-mcell.other{background:#fafafa}
    .gcal-mcell.other .gcal-mnum{color:#c3cad4}
    .gcal-mcell.today .gcal-mnum{background:#2563eb;color:#fff}
    .gcal-mnum{font-size:12.5px;font-weight:600;color:#1f2937;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:50%;flex:none}
    .gcal-mevents{display:flex;flex-direction:column;gap:3px;overflow:hidden}
    .gcal-mev{font-size:11px;padding:2px 6px;border-radius:5px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;font-weight:600;max-width:100%;min-width:0}
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
    .gcal-panel-body{flex:1;overflow-y:auto;overflow-x:hidden;padding:18px}
    .gcal-panel-title{font-size:16px;font-weight:700;color:#1f2937;margin-bottom:14px;line-height:1.4;overflow-wrap:anywhere}
    .gcal-panel-row{display:flex;gap:10px;align-items:flex-start;margin-bottom:14px;font-size:13.5px;color:#374151;line-height:1.5;min-width:0;overflow-wrap:anywhere}
    .gcal-panel-row i{width:16px;color:#6b7280;margin-top:2px;flex:none}
    /* Inside the panel/menu specifically, long titles wrap to a new line instead of the ellipsis
       truncation used elsewhere (e.g. the Week view list) — no horizontal scroll in here either way. */
    .gcal-panel .gcal-lrow{align-items:flex-start}
    .gcal-panel .gcal-lrow-title{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere}
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
    /* Non-blocking "you can still use Offline meetings" banner (shown when Google isn't connected) */
    .mtg-connect-banner{display:flex;align-items:center;gap:12px;background:#f8fafc;border:1px solid var(--line);border-radius:11px;padding:11px 14px;margin:0 0 14px}
    .mtg-connect-banner .mcb-ico{font-size:20px;color:#4285f4;flex:0 0 auto}
    .mtg-connect-banner .mcb-txt{flex:1;min-width:0;font-size:12.5px;color:var(--slate);line-height:1.45}
    .mtg-connect-banner .mcb-txt b{color:var(--ink);font-weight:600}
    .mtg-connect-banner .mcb-btn{flex:0 0 auto;display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid #d1d5db;border-radius:20px;padding:0 15px;height:36px;font-weight:600;font-size:13px;color:#374151;cursor:pointer;font-family:inherit}
    .mtg-connect-banner .mcb-btn:hover{background:#f9fafb}
    .mtg-connect-banner .mcb-btn i{color:#4285f4}
    @media(max-width:600px){.mtg-connect-banner{flex-wrap:wrap}.mtg-connect-banner .mcb-btn{width:100%;justify-content:center}}
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
    .mtg-log-summary{margin:6px 0 12px;font-size:13px;color:#334155;line-height:1.65;background:#fff;border:1px solid var(--line);border-left:3px solid #0d9488;border-radius:8px;padding:11px 13px}
    .mtg-log-sumh{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0d9488;margin-bottom:6px;display:flex;align-items:center;gap:6px}
    .mtg-tr-facts{display:flex;gap:10px;flex-wrap:wrap;margin:2px 0 12px}
    .mtg-tr-fact{flex:1 1 110px;background:#fff;border:1px solid var(--line);border-radius:9px;padding:9px 12px}
    .mtg-tr-fact .k{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#a3adbe}
    .mtg-tr-fact .v{font-size:17px;font-weight:650;color:var(--ink);margin-top:3px;font-variant-numeric:tabular-nums}
    .mtg-tr-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 8px}
    .mtg-tr-h{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#8a94a6;display:flex;align-items:center;gap:7px}
    .mtg-tr-btns{display:flex;gap:6px}
    .mtg-tr-btns .ac-btn{padding:5px 12px;font-size:12.5px}
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
  window.accNotifOpen=async function(id){ const n=NOTIFS.find(x=>x.id===id); if(!n)return; if(!n.read){try{await ACC().from('notifications').update({read:true}).eq('id',id);n.read=true;notifPaint();}catch(e){}} if(n.kind==='meeting'||n.kind==='meeting_cancel'||n.kind==='meeting_update'||n.kind==='meeting_reminder'){ const dd=$('notifDd'); if(dd)dd.classList.remove('show'); navTo('tasks/meetings'); return; } if(n.kind==='campaign_alert'){ const dd=$('notifDd'); if(dd)dd.classList.remove('show'); location.href='campaigns.html#/campaigns'; return; } if(n.task_id==null){ const dd=$('notifDd'); if(dd)dd.classList.remove('show'); return; } accNotifGoto(n.task_id); };
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
    if (seg[0]==='meetings' && seg[1]==='record' && seg[2]) { ROUTE={tab:'meetings',taskId:null}; return mtgRecordPage(v, Number(seg[2])); }
    if (seg[0]==='meetings' && seg[1]==='wrap' && seg[2]) { ROUTE={tab:'meetings',taskId:null}; return mtgWrapPage(v, Number(seg[2])); }
    if (seg[0]==='profile' && typeof taskProfile==='function') { ROUTE={tab:'profile',taskId:null}; return taskProfile(v); }
    if (seg[0]==='workflow' && seg[1]==='new') { ROUTE={tab:'workflow',taskId:null}; return wfFormPage(v, null); }
    if (seg[0]==='workflow' && seg[1]==='edit' && seg[2]) { ROUTE={tab:'workflow',taskId:null}; return wfFormPage(v, Number(seg[2])); }
    if (seg[0]==='workflow' && seg[1]==='case' && seg[2]) { ROUTE={tab:'workflow',taskId:null}; return wfCaseRoute(v, Number(seg[2])); }
    if (seg[0]==='workflow' && seg[1]) { ROUTE={tab:'workflow',taskId:null}; return wfDetailPage(v, Number(seg[1]), null); }
    let tab = seg[0] || 'work'; if(tab==='home')tab='work';
    ROUTE={tab:tab,taskId:null};
    setCrumb(['Accountability', tab==='work'?'Tasks':(tab.charAt(0).toUpperCase()+tab.slice(1))]);
    v.innerHTML = `<div class="page-head"><div><h1><i class="fa-solid fa-list-check" style="color:#1d4ed8"></i> Accountability</h1><p>Tasks, delegation & scoreboard</p></div></div>
    <div class="ac-tabs">
      <div class="ac-tab ${tab==='work'?'active':''}" onclick="navTo('tasks/work')"><i class="fa-solid fa-list-check"></i> Tasks</div>
      <div class="ac-tab ${tab==='calendar'?'active':''}" onclick="navTo('tasks/calendar')"><i class="fa-solid fa-calendar-days"></i> Calendar</div>
      <div class="ac-tab ${tab==='meetings'?'active':''}" onclick="navTo('tasks/meetings')"><i class="fa-solid fa-video"></i> Meetings</div>
      <div class="ac-tab ${tab==='workflow'?'active':''}" onclick="navTo('tasks/workflow')"><i class="fa-solid fa-diagram-project"></i> Workflow</div>
      <div class="ac-tab ${tab==='archive'?'active':''}" onclick="navTo('tasks/archive')"><i class="fa-solid fa-box-archive"></i> Archive</div>
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
      return ''; // completed on time (or early) — no badge, the row just shows normally
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
      // Completed / Archive rows: marked-done date + project tag (if any). Badge only when overdue.
      if(t.completed_at) metaParts.push(`<span title="Marked done"><i class="fa-regular fa-calendar"></i> ${fmtDate(t.completed_at)}</span>`);
      if(t._projName) metaParts.push(`<i class="fa-solid fa-diagram-project"></i> ${esc2(t._projName)}`);
    } else {
      if(t._projName) metaParts.push(`<i class="fa-solid fa-diagram-project"></i> ${esc2(t._projName)}`);
      if(t.due_date) metaParts.push(`<i class="fa-regular fa-calendar"></i> ${fmtDate(t.due_date)}`);
    }
    const meta=metaParts.length?`<div class="rtd">${metaParts.join(' · ')}</div>`:'';
    const wfIcon='';
    const ownerVis=(t.flow_case_step_id!=null)
      ? `<span title="Owner: Workflow" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#1d4ed8;color:#fff;font-size:11px;border:2px solid var(--bg-card)"><i class="fa-solid fa-diagram-project"></i></span>`
      : (emails.length?avatars(list,emails):'');
    return `<div class="ac-row" onclick="navTo('tasks/task/${t.id}${opt.ro?'/ro':''}')"><div class="ti"><div class="t">${wfIcon}${esc2(t.title)}</div></div><div class="rt">${meta}${dueBadge(t.due_date,t.completed_at)}${ownerVis}</div></div>`;
  }
  function summaryCard(title,icon,color,count,inner){ return `<div class="ac-card sm"><div class="hd"><i class="fa-solid ${icon}" style="color:${color}"></i> ${title}<span class="cnt">${count}</span></div><div class="bd" style="height:180px;max-height:180px;min-height:0">${inner}</div></div>`; }
  // Client-side title filter for every task row currently on screen (Tasks tab) — no re-fetch.
  window.accTaskSearch=function(val){
    const q=(val||'').trim().toLowerCase();
    const body=document.getElementById('acBody'); if(!body)return;
    body.querySelectorAll('.ac-row').forEach(function(row){
      const el=row.querySelector('.ti .t');
      const txt=el?el.textContent.toLowerCase():'';
      row.style.display=(!q||txt.includes(q))?'':'none';
    });
    // While searching, hide the "Add task" dotted rows unless their group still has a visible task.
    body.querySelectorAll('.ac-addrow-ghost, .ac-ins, .ac-addrow').forEach(function(g){
      if(!q){ g.style.display=''; return; }
      const parent=g.parentElement;
      const hasVisible=parent && Array.prototype.some.call(parent.querySelectorAll('.ac-row'), function(r){ return r.style.display!=='none'; });
      g.style.display=hasVisible?'':'none';
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
    const avOf=function(nm){ try{ return (typeof avatar==='function')?avatar(nm):('<span class="avatar avatar-sm" style="background:'+colorFor(nm)+'">'+esc2(iniOf(nm).toUpperCase())+'</span>'); }catch(e){ return '<span class="avatar avatar-sm" style="background:'+colorFor(nm)+'">'+esc2(iniOf(nm).toUpperCase())+'</span>'; } };
    order.forEach(function(d){ listHtml+='<div class="ms-dept">'+esc2(d)+'</div>'; groups[d].forEach(function(pp){ const on=eq(pp.email,sel); listHtml+='<div class="ms-opt'+(on?' on':'')+'" data-n="'+esc2((String(pp.name||'')+' '+String(pp.email||'')).toLowerCase())+'" data-email="'+esc2(pp.email)+'" data-name="'+esc2(pp.name)+'" onclick="wfPersonPick(this)">'+avOf(pp.name)+'<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc2(pp.name)+'</span>'+(on?'<i class="fa-solid fa-check" style="color:var(--brand)"></i>':'')+'</div>'; }); });
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
    pp.querySelectorAll('.ms-opt.on').forEach(function(x){x.classList.remove('on');});
    row.classList.add('on');
    pp.classList.remove('open');
  };
  window.wfPersonFilter=function(inp){
    const panel=inp.closest('.wf-pp-panel'); if(!panel)return; const box=panel.querySelector('.ms-list'); if(!box)return;
    const q=(inp.value||'').toLowerCase();
    box.querySelectorAll('.ms-opt').forEach(function(l){ l.style.display=(!q||(l.dataset.n||'').includes(q))?'':'none'; });
    box.querySelectorAll('.ms-dept').forEach(function(g){ let n=g.nextElementSibling,vis=false; while(n&&n.classList&&n.classList.contains('ms-opt')){ if(n.style.display!=='none')vis=true; n=n.nextElementSibling; } g.style.display=vis?'':'none'; });
  };

  /* small workflow helpers */
  function wfNm(email){ const p=(WF_PEOPLE||[]).find(function(x){return eq(x.email,email);}); return (p&&p.name)||email||''; }
  function wfDeptOf(email){ const p=(WF_PEOPLE||[]).find(function(x){return eq(x.email,email);}); return (p&&Array.isArray(p.depts)&&p.depts.length)?p.depts.join(', '):''; }
  function wfDurText(v,u){ if(v==null||v==='')return ''; u=u||'days'; return v+' '+(Number(v)===1?String(u).replace(/s$/,''):u); }
  function wfAddDuration(base,value,unit){ const d=new Date(base.getTime()); value=Number(value)||0; if(unit==='hours')d.setHours(d.getHours()+value); else if(unit==='weeks')d.setDate(d.getDate()+value*7); else d.setDate(d.getDate()+value); return d; }
  function wfDateOnly(d){ const z=function(n){return String(n).padStart(2,'0');}; return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate()); }
  function wfDT(iso){ if(!iso)return '—'; try{ return new Date(iso).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}); }catch(e){ return String(iso); } }
  // Same as wfDT but always carries the year too, for the timeline cards.
  function wfDTFull(iso){ if(!iso)return '—'; try{ return new Date(iso).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); }catch(e){ return String(iso); } }
  function wfHms(ms){ if(ms==null||isNaN(ms))return ''; let m=Math.max(0,Math.round(ms/60000)); const h=Math.floor(m/60); m=m%60; return (h?h+'h ':'')+m+'m'; }
  // 5-digit display Id for an instance — cosmetic padding of the per-workflow case_no counter.
  // How an instance's number reads on screen. The bill workflow pads to a 5-digit Id (00042),
  // because that is how the bill register has always numbered them. Every ordinary workflow just
  // shows a plain No. — 42, not 00042.
  function wfCaseNoText(c){
    const n=String((c&&c.case_no)||0);
    return window._wfIsBill ? n.padStart(5,'0') : n;
  }
  // Is this the bill-style workflow (Invoice Processing)? Decided from the workflow's OWN detail
  // fields — only that one carries a "Unique bill Id" — so nothing here is hard-wired to a
  // particular workflow row. Everything gated on this stays off ordinary workflows, which keep
  // the plain "No." column they have always had and never grow a Unique Bill Id column.
  function wfIsBillFlow(flow){
    const t=Array.isArray(flow&&flow.trigger_template)?flow.trigger_template:[];
    return t.some(function(f){ return f && eq((f.label||''),'Unique bill Id'); });
  }
  // "D.H" duration text per the user's requested format (e.g. "1.2" = 1 day 2 hours).
  function wfDaysHoursText(ms){ if(ms==null||isNaN(ms)||ms<0)return ''; const totalH=Math.floor(ms/3600000); const d=Math.floor(totalH/24), h=totalH%24; return d+'d '+h+'h'; }
  // 2+ people -> the whole group becomes hoverable (desktop) / tappable (mobile), showing the
  // full name list via the existing .wf-poptip/.wf-tip-txt tooltip layer (same one the "i" hints
  // and status pills already use) instead of relying on each tiny circle's own native title,
  // which never worked for the "+N" overflow circle and only ever showed one name at a time.
  function wfCircles(emails,extra){
    emails=(emails||[]).filter(Boolean);
    if(!emails.length) return '<span class="wf-circle wf-none" title="No members yet">·</span>';
    const max=5, shown=emails.slice(0,max), multi=emails.length>=2;
    let h='<span class="wf-circles'+(multi?' wf-poptip':'')+' '+(extra||'')+'"'+(multi?' tabindex="0" role="button" aria-label="Show all people" onclick="event.stopPropagation();wfPopToggle(this)"':'')+'>';
    shown.forEach(function(e){ h+='<span class="wf-circle"'+(multi?'':' title="'+esc2(wfNm(e))+'"')+' style="background:'+colorFor(e)+'">'+esc2(iniOf(wfNm(e)).toUpperCase())+'</span>'; });
    if(emails.length>max)h+='<span class="wf-circle wf-more">+'+(emails.length-max)+'</span>';
    if(multi)h+='<span class="wf-tip-txt">'+emails.map(function(e){return esc2(wfNm(e));}).join('<br>')+'</span>';
    h+='</span>';
    return h;
  }
  // My own department(s), from the same people() list already loaded for the person-picker.
  function wfMyDepts(){ const p=(WF_PEOPLE||[]).find(function(x){return eq(x.email,me());}); return (p&&Array.isArray(p.depts))?p.depts:[]; }
  function wfInDept(dept){ return wfMyDepts().some(function(d){return eq(d,dept);}); }
  function wfInAnyDept(depts){ const mine=wfMyDepts(); return (depts||[]).some(function(d){return mine.some(function(m){return eq(m,d);});}); }
  // Who can create a brand-new workflow — mirrors acc.wf_can_create_flow() server-side exactly.
  var WF_CREATE_DEPTS=['Systems','Administration'];
  function wfCanSee(f,ownersByFlow){
    const o=(ownersByFlow&&ownersByFlow[f.id])||[];
    return eq(f.created_by||'',me()) || eq(f.trigger_owner||'',me()) || o.some(function(e){return eq(e,me());})
      // A flow can be opened up to whole departments (e.g. Invoice Processing -> Systems +
      // Administration) instead of just its creator/trigger-owner/step-owners — mirrors the
      // backend's own acc.wf_can_see_flow RLS check, which is the real enforcement; this is just
      // the matching client-side filter so the list doesn't have to round-trip a denied row.
      || wfInAnyDept(f.visible_departments);
  }
  function wfTrigShort(c){ const base=c.title||''; const det=Array.isArray(c.trigger_details)?c.trigger_details:[]; const vals=det.map(function(d){return (d&&(d.value||d.label))||'';}).filter(Boolean); let s=base+(vals.length?(' : '+vals.join(', ')):''); if(s.length>30)s=s.slice(0,29)+'…'; return s; }
  function wfTitleCase(s){ return String(s==null?'':s).replace(/\S+/g,function(w){ return w.charAt(0).toUpperCase()+w.slice(1); }); }

  async function workflowTab(){
    const b=$('acBody');
    b.innerHTML='<div class="loader"><div class="spin"></div></div>';
    window._wfDelId=null; wfInjectCss();
    try{ WF_PEOPLE=await people(); }catch(e){ WF_PEOPLE=[]; }
    await wfRenderList();
  }

  async function wfRenderList(){
    const b=$('acBody'); if(!b)return;
    let flows=[], stepCounts={}, ownersByFlow={};
    try{ const {data}=await ACC().from('flows').select('*').order('id',{ascending:false}); flows=data||[]; }
    catch(e){ toast('Could not load workflows: '+((e&&e.message)||e),'err'); }
    try{ const {data}=await ACC().from('flow_steps').select('flow_id,owner_email'); (data||[]).forEach(function(s){ stepCounts[s.flow_id]=(stepCounts[s.flow_id]||0)+1; if(s.owner_email){ (ownersByFlow[s.flow_id]=ownersByFlow[s.flow_id]||[]); if(!ownersByFlow[s.flow_id].some(function(e){return eq(e,s.owner_email);}))ownersByFlow[s.flow_id].push(s.owner_email); } }); }catch(e){}
    // Member-only visibility: you see a workflow only if you created it or you own a step in it.
    flows=flows.filter(function(f){ return wfCanSee(f,ownersByFlow); });
    const rows=flows.map(function(f){
      const n=stepCounts[f.id]||0;
      const owners=(ownersByFlow[f.id]||[]).slice();
      if(f.trigger_owner && !owners.some(function(e){return eq(e,f.trigger_owner);})) owners.unshift(f.trigger_owner);
      return '<div class="wf-lrow" onclick="wfOpen('+f.id+')">'
        +'<div class="wf-lrow-main">'
          +'<div class="wf-lrow-name">'+esc2(f.name||'Untitled workflow')+'</div>'
          +(f.trigger_event?'<div class="wf-lrow-trig"><i class="fa-solid fa-bolt"></i> '+esc2(f.trigger_event)+'</div>':'')
        +'</div>'
        +'<div class="wf-lrow-right">'+wfCircles(owners)+'<span class="wf-lrow-steps">'+n+' step'+(n===1?'':'s')+'</span><i class="fa-solid fa-chevron-right wf-go"></i></div>'
      +'</div>';
    }).join('');
    const inner=flows.length?('<div class="wf-list">'+rows+'</div>'):'<div class="ac-empty" style="cursor:default">No workflows yet.</div>';
    // Creating a brand-new workflow (not just viewing one) is restricted to Systems/Administration
    // — matches the backend's own acc.wf_can_create_flow check in wf_save_flow, which is the real
    // enforcement; this is just the matching client-side button visibility.
    const canCreate=wfInAnyDept(WF_CREATE_DEPTS);
    b.innerHTML='<div class="wf-listhead"><div class="wf-listhead-t"><i class="fa-solid fa-diagram-project"></i> Workflows</div>'+(canCreate?'<button class="ac-btn primary" onclick="wfNew()"><i class="fa-solid fa-plus"></i> New Workflow</button>':'')+'</div>'
      +inner;
  }

  window.wfNew=function(){ navTo('tasks/workflow/new'); };
  window.wfEdit=function(id){ navTo('tasks/workflow/edit/'+id); };
  window.wfOpen=function(id){ navTo('tasks/workflow/'+id); };
  window.wfCancel=function(){ navTo('tasks/workflow'); };
  // Reusable tooltip for secondary hint text: a small (i) icon. Desktop = hover, mobile = tap.
  // The bubble is drawn in a single fixed layer on <body> so cards/modals can never clip it.
  // The "i" is a plain character, not a Font Awesome glyph — the icon font renders it far too
  // small inside a 16px circle (and silently shows nothing if the CDN is slow or blocked).
  function tip(text){ var s=esc2(String(text||'')); return '<span class="wf-tip" tabindex="0" role="button" aria-label="More information">i<span class="wf-tip-txt">'+s+'</span></span>'; }
  function wfTipLayer(){ var l=document.getElementById('wfTipLayer'); if(!l){ l=document.createElement('div'); l.id='wfTipLayer'; document.body.appendChild(l); } return l; }
  function wfTipHide(){ var l=document.getElementById('wfTipLayer'); if(l) l.classList.remove('show'); }
  function wfTipShow(anchor){
    var src=anchor&&anchor.querySelector&&anchor.querySelector('.wf-tip-txt'); if(!src) return;
    var l=wfTipLayer(); l.innerHTML=src.innerHTML; l.classList.add('show'); l.classList.remove('below');
    // measure after the content is in, then place above the icon (or below if there's no room)
    var r=anchor.getBoundingClientRect(), b=l.getBoundingClientRect(), pad=8;
    var left=r.left+r.width/2-b.width/2;
    left=Math.max(pad,Math.min(left,window.innerWidth-b.width-pad));
    var top=r.top-b.height-8, below=false;
    if(top<pad){ top=r.bottom+8; below=true; }
    l.style.left=Math.round(left)+'px'; l.style.top=Math.round(top)+'px';
    l.style.setProperty('--tipx',Math.round(r.left+r.width/2-left)+'px');
    if(below) l.classList.add('below');
  }
  if(!window._acTipInit){ window._acTipInit=1;
    var reAnchor=function(){ var a=window._wfTipAnchor; if(a&&document.body.contains(a)) wfTipShow(a); else wfTipHide(); };
    document.addEventListener('mouseover',function(e){
      var el=e.target&&e.target.closest&&e.target.closest('.wf-tip,.wf-poptip');
      if(el){ window._wfTipAnchor=el; wfTipShow(el); }
    },true);
    document.addEventListener('mouseout',function(e){
      var el=e.target&&e.target.closest&&e.target.closest('.wf-tip,.wf-poptip');
      if(el&&!(e.relatedTarget&&el.contains(e.relatedTarget))){ if(window._wfTipAnchor===el&&!el.classList.contains('show')){ window._wfTipAnchor=null; wfTipHide(); } }
    },true);
    document.addEventListener('focusin',function(e){
      var el=e.target&&e.target.closest&&e.target.closest('.wf-tip');
      if(el){ window._wfTipAnchor=el; wfTipShow(el); }
    },true);
    document.addEventListener('focusout',function(e){
      var el=e.target&&e.target.closest&&e.target.closest('.wf-tip');
      if(el&&window._wfTipAnchor===el){ window._wfTipAnchor=null; wfTipHide(); }
    },true);
    document.addEventListener('click',function(e){
      var el=e.target&&e.target.closest&&e.target.closest('.wf-tip');
      if(el){ e.stopPropagation(); window._wfTipAnchor=el; wfTipShow(el); try{ el.focus(); }catch(_){} return; }
      if(!(e.target&&e.target.closest&&e.target.closest('.wf-poptip'))){
        document.querySelectorAll('.wf-poptip.show').forEach(function(x){x.classList.remove('show');});
        window._wfTipAnchor=null; wfTipHide();
      }
    },true);
    window.addEventListener('scroll',reAnchor,true);
    window.addEventListener('resize',reAnchor);
  }
  window.wfPopToggle=function(el){ var was=el.classList.contains('show'); document.querySelectorAll('.wf-poptip.show').forEach(function(x){ if(x!==el) x.classList.remove('show'); }); el.classList.toggle('show', !was); if(was){ window._wfTipAnchor=null; wfTipHide(); } else { window._wfTipAnchor=el; wfTipShow(el); } };
  // Workflow instance detail formatters (used for task Title / Description).
  function wfDetailsInline(details){ return (details||[]).map(function(d){ return ((d&&d.label)?String(d.label)+': ':'')+((d&&d.value)||''); }).filter(function(x){ return String(x).trim(); }).join(' · '); }
  function wfDetailsFmt(details){ return (details||[]).map(function(d){ var l=(d&&d.label)||'', v=(d&&d.value)||''; if(!String(l).trim()&&!String(v).trim())return ''; return (l?('<b>'+esc2(l)+':</b> '):'')+esc2(v); }).filter(Boolean).join('<br>'); }
  function wfInstanceLabel(info){ var base=(info&&(info.triggerEvent||info.flowName))||'Workflow'; return base+(info&&info.caseNo?(' #'+info.caseNo):''); }
  // Curated instance summary — Bill No./Bill Date/Unique bill Id/Company/Amount (+ the 5-digit
  // Id), explicitly WITHOUT Department, per the user's request. Falls back to null (caller shows
  // the generic full detail list instead) for any workflow that doesn't have these field labels,
  // so other workflows (Leave approval, etc.) are unaffected.
  var WF_SUMMARY_FIELDS=['Bill No.','Bill Date','Unique bill Id','Company','Amount'];
  function wfCaseSummaryHtml(c){
    const det=Array.isArray(c.trigger_details)?c.trigger_details:[];
    const by={}; det.forEach(function(d){ if(d&&d.label) by[d.label]=d.value; });
    const items=[{k:(window._wfIsBill?'Wheredoc Id':'No.'),v:wfCaseNoText(c)}];
    WF_SUMMARY_FIELDS.forEach(function(k){ if(by[k]!=null && String(by[k]).trim()) items.push({k:k,v:by[k]}); });
    if(items.length<=1) return '';
    return '<div class="tp-grid" style="margin-top:10px">'+items.map(function(it){return '<div class="tp-f"><div class="k">'+esc2(it.k)+'</div><div class="v">'+esc2(it.v)+'</div></div>';}).join('')+'</div>';
  }

  /* ----- What does this workflow actually process? -----------------------------------------
     A workflow called "Invoice Processing" with the trigger "Invoice Received" is really about
     INVOICES, so the UI should say "New Invoice" and "Invoices" instead of the meaningless
     "New Event" / "Instances". The word is worked out once by the flow-noun edge function
     (Anthropic Claude) when the workflow is saved, and kept on the flow row. wfNounOf() falls
     back to a local guess so the screen is never blank if that hasn't run yet. */
  var WF_STOPW={a:1,an:1,the:1,'new':1,of:1,'for':1,to:1,is:1,are:1,received:1,receiving:1,receipt:1,submitted:1,submission:1,created:1,creation:1,raised:1,approved:1,approval:1,rejected:1,generated:1,requested:1,completed:1,complete:1,processing:1,process:1,processed:1,initiated:1,initiation:1,arrives:1,arrival:1,comes:1,coming:1,logged:1,registered:1,sent:1,issued:1,filed:1,opened:1,closed:1,cancelled:1,done:1,when:1,after:1,before:1,on:1,'in':1,from:1,by:1,'with':1,and:1,applies:1,joins:1,handling:1,coordination:1,flow:1,management:1,requests:1,submits:1,sends:1,uploads:1,asks:1,places:1,reports:1,receives:1,raises:1,customer:1};
  function wfNounCase(s){ return String(s||'').replace(/\w\S*/g,function(t){return t.charAt(0).toUpperCase()+t.slice(1).toLowerCase();}); }
  function wfPlural(n){
    var w=String(n||'').trim(); if(!w) return w;
    var parts=w.split(/\s+/), last=parts[parts.length-1], p;
    if(/[^s]s$/i.test(last)) p=last;                       // already plural — leave it alone
    else if(/[^aeiou]y$/i.test(last)) p=last.replace(/y$/i,'ies');
    else if(/(s|x|z|ch|sh)$/i.test(last)) p=last+'es';
    else p=last+'s';
    parts[parts.length-1]=p; return parts.join(' ');
  }
  function wfGuessNoun(name,trigger){
    var pick=function(src){
      var words=String(src||'').replace(/[^A-Za-z0-9 ]/g,' ').split(/\s+/).filter(function(w){ return w && !WF_STOPW[w.toLowerCase()]; });
      if(!words.length) return '';
      var out=[words[0]];
      if(words[1] && !/(ing|ed)$/i.test(words[1]) && (out[0].length+words[1].length)<=22) out.push(words[1]);
      return wfNounCase(out.join(' '));
    };
    return pick(trigger)||pick(name)||'Event';
  }
  // Returns the words to use for one flow: {one:'Invoice', many:'Invoices', lc:'invoice', lcMany:'invoices'}
  function wfNounOf(flow){
    var one=(flow&&flow.instance_noun||'').trim();
    if(!one) one=wfGuessNoun(flow&&flow.name, flow&&flow.trigger_event);
    var many=(flow&&flow.instance_noun_plural||'').trim()||wfPlural(one);
    return {one:one, many:many, lc:one.toLowerCase(), lcMany:many.toLowerCase()};
  }
  // Ask Claude for the word (fire-and-forget: it saves onto the flow row for next time).
  async function wfNounLearn(flowId,name,trigger){
    try{
      const {data:{session}}=await sb.auth.getSession();
      const token=session&&session.access_token; if(!token) return null;
      const res=await fetch(SUPABASE_URL+'/functions/v1/flow-noun',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'apikey':SUPABASE_KEY},body:JSON.stringify({flow_id:flowId,name:name,trigger_event:trigger})});
      return await res.json().catch(function(){return null;});
    }catch(e){ return null; }
  }

  function wfStepRowHtml(idx,step){
    step=step||{};
    const unit=(step.duration_unit||'days');
    // Number and the remove button live in a header strip, so every input below gets the
    // full width of the card instead of being squeezed between them.
    return '<div class="wf-step">'
      +'<div class="wf-step-hd">'
        +'<span class="wf-step-num">'+idx+'</span>'
        +'<span class="wf-step-hd-t">Step '+idx+'</span>'
        +'<button class="ac-btn ic danger wf-s-del" title="Remove step" onclick="wfRemoveStep(this)"><i class="fa-solid fa-xmark"></i></button>'
      +'</div>'
      +'<div class="wf-step-fields">'
        +'<input class="ac-in wf-s-title" placeholder="What happens in this step?" value="'+esc2(step.title||'')+'">'
        +'<div class="wf-step-sub">'
          +wfPersonPickerHtml(step.owner_email)
          +'<input class="ac-in wf-s-dur" type="number" min="1" placeholder="Duration" value="'+(step.duration_value!=null?step.duration_value:'')+'">'
          +'<select class="ac-in wf-s-unit">'
            +'<option value="hours"'+(unit==='hours'?' selected':'')+'>Hours</option>'
            +'<option value="days"'+(unit==='days'?' selected':'')+'>Days</option>'
            +'<option value="weeks"'+(unit==='weeks'?' selected':'')+'>Weeks</option>'
          +'</select>'
        +'</div>'
        // "How" is the tracker's HOW row — the channel the step runs through (Google Form, ERP,
        // physically, ...). Optional, so leaving it blank changes nothing.
        +'<input class="ac-in wf-s-method" placeholder="How is it done? (optional — e.g. Google Form, ERP, Physically)" value="'+esc2(step.method||'')+'">'
      +'</div>'
    +'</div>';
  }

  async function wfFormPage(v,id){
    wfInjectCss(); window._wfDelId=null;
    setCrumb(['Accountability','Workflow', id?'Edit':'New']);
    v.innerHTML='<div class="loader"><div class="spin"></div></div>';
    if(!WF_PEOPLE){ try{ WF_PEOPLE=await people(); }catch(e){ WF_PEOPLE=[]; } }
    if(!window._wfPpWired){ document.addEventListener('click',function(e){ if(!e.target||!e.target.closest||!e.target.closest('.wf-pp')) document.querySelectorAll('.wf-pp.open').forEach(function(x){x.classList.remove('open');}); }); window._wfPpWired=true; }
    let flow={name:'',description:'',trigger_event:''}, steps=[];
    if(id){
      try{ const {data}=await ACC().from('flows').select('*').eq('id',id).maybeSingle(); if(data)flow=data; }catch(e){}
      try{ const {data}=await ACC().from('flow_steps').select('*').eq('flow_id',id).order('seq',{ascending:true}); steps=data||[]; }catch(e){}
    }
    if(!steps.length) steps=[{},{}]; // start with two blank step rows (both mandatory)
    const stepsHtml=steps.map(function(s,i){ return wfStepRowHtml(i+1,s); }).join('');
    v.innerHTML='<div class="wf-page">'
      +'<div class="wf-page-head"><button class="ac-btn ic" title="Back" onclick="wfCancel()"><i class="fa-solid fa-arrow-left"></i></button><h1><i class="fa-solid fa-diagram-project"></i> '+(id?'Edit workflow':'New workflow')+'</h1></div>'
      +'<div class="wf-card">'
      +'<div class="wf-form" data-id="'+(id||'')+'">'
        // Section 1 — what the workflow is. Paired fields sit side by side on a wide screen.
        +'<div class="wf-fsec">'
          +'<div class="wf-fsec-h"><i class="fa-solid fa-circle-info"></i> Basics</div>'
          +'<div class="wf-fgrid">'
            +'<div class="wf-fld">'
              +'<label class="wf-lbl" for="wfName">Workflow name</label>'
              +'<input id="wfName" class="ac-in" placeholder="e.g. Invoice Processing" value="'+esc2(flow.name||'')+'">'
            +'</div>'
            +'<div class="wf-fld">'
              +'<label class="wf-lbl" for="wfTrigger">Triggering event '+tip('What starts this workflow.')+'</label>'
              +'<input id="wfTrigger" class="ac-in" placeholder="e.g. Receiving an invoice" value="'+esc2(flow.trigger_event||'')+'">'
              +'<input id="wfTrigMethod" class="ac-in" style="margin-top:8px" placeholder="How does it come in? (optional — e.g. Google Form, email, in person)" value="'+esc2(flow.trigger_method||'')+'">'
            +'</div>'
            +'<div class="wf-fld">'
              +'<label class="wf-lbl">Triggering event owner <span id="wfOwnerTip">'+tip('Required. Only this person can start a new '+wfNounOf(flow).lc+'.')+'</span></label>'
              +'<div id="wfTrigOwner" class="wf-owner-pick">'+wfPersonPickerHtml(flow.trigger_owner||'')+'</div>'
            +'</div>'
            +'<div class="wf-fld">'
              +'<label class="wf-lbl" for="wfDesc">Description '+tip('Optional.')+'</label>'
              +'<input id="wfDesc" class="ac-in" placeholder="Short note about this workflow" value="'+esc2(flow.description||'')+'">'
            +'</div>'
          +'</div>'
        +'</div>'
        // Section 2 — the ordered steps.
        +'<div class="wf-fsec">'
          +'<div class="wf-fsec-h"><i class="fa-solid fa-list-ol"></i> Steps '+tip('In order; each step is done by one person within a set time.')+'</div>'
          +'<div id="wfSteps">'+stepsHtml+'</div>'
          +'<div class="wf-addstep-ghost" onclick="wfAddStep()"><i class="fa-solid fa-plus"></i> Add step</div>'
        +'</div>'
        +'<div class="wf-actions">'
          +'<button class="ac-btn" onclick="wfCancel()">Cancel</button>'
          +'<button class="ac-btn primary" title="Press Enter to save · Esc to close" onclick="wfSave()"><i class="fa-solid fa-floppy-disk"></i> Save workflow</button>'
        +'</div>'
      +'</div></div></div>';
    // Keep the owner tooltip naming whatever this workflow will process, as they type.
    const refreshNoun=function(){
      const g=wfNounOf({name:($('wfName')||{}).value||'', trigger_event:($('wfTrigger')||{}).value||''});
      const ot=$('wfOwnerTip');
      if(ot) ot.innerHTML=tip('Required. Only this person can start a new '+g.lc+'.');
    };
    ['wfName','wfTrigger'].forEach(function(k){ const el=$(k); if(el) el.addEventListener('input',refreshNoun); });
    refreshNoun();
    // Enter = save, Esc = close (ignore while typing in the person-search box)
    const page=v.querySelector('.wf-form');
    if(page){ page.addEventListener('keydown',function(e){
      const inSearch=e.target&&e.target.classList&&e.target.classList.contains('ms-search');
      const inPanel=e.target&&e.target.closest&&e.target.closest('.wf-pp-panel');
      if(e.key==='Escape'){ e.preventDefault(); wfCancel(); }
      else if(e.key==='Enter'&&!inSearch&&!inPanel&&e.target.tagName!=='SELECT'){ e.preventDefault(); wfSave(); }
    }); }
    const nm=$('wfName'); if(nm){ try{nm.focus();}catch(_){} }
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
    [].slice.call(wrap.querySelectorAll('.wf-step')).forEach(function(r,i){
      const n=r.querySelector('.wf-step-num'); if(n)n.textContent=(i+1);
      const t=r.querySelector('.wf-step-hd-t'); if(t)t.textContent='Step '+(i+1);
    });
  }
  window.wfClearTrigOwner=function(){
    const box=$('wfTrigOwner'); if(!box)return;
    const hid=box.querySelector('.wf-s-person'); if(hid)hid.value='';
    const btn=box.querySelector('.wf-pp-btn'); if(btn)btn.innerHTML='<span class="wf-pp-ph">Anyone (no specific owner)</span><i class="fa-solid fa-chevron-down wf-pp-caret"></i>';
    // the picker renders .ms-opt rows (shared app styles); .ms-row is the older markup and
    // left the previously chosen person still ticked after clearing
    box.querySelectorAll('.ms-opt.on,.ms-row.on').forEach(function(x){x.classList.remove('on');});
  };


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
      const person=(r.querySelector('.wf-s-person')||{}).value||'';
      const durRaw=(r.querySelector('.wf-s-dur')||{}).value;
      const unit=(r.querySelector('.wf-s-unit')||{}).value||'days';
      const dur=(durRaw!==''&&durRaw!=null)?parseInt(durRaw,10):NaN;
      if(!bad){
        if(!t) bad='Step '+(i+1)+': add a title (what happens in this step).';
        else if(!person) bad='Step '+(i+1)+': assign a person.';
        else if(!(dur>=1)) bad='Step '+(i+1)+': set a duration.';
      }
      const method=((r.querySelector('.wf-s-method')||{}).value||'').trim();
      steps.push({seq:steps.length+1,title:t,description:null,owner_email:person||null,duration_value:(!isNaN(dur)?dur:null),duration_unit:unit,method:method||null});
    });
    if(bad){ toast(bad,'warn'); return; }
    const owner=((document.querySelector('#wfTrigOwner .wf-s-person')||{}).value||'').trim();
    if(!owner){ toast('Please select the Triggering event owner','warn'); return; }
    const form=document.querySelector('.wf-form');
    const editId=(form&&form.getAttribute('data-id'))?Number(form.getAttribute('data-id')):null;
    try{
      const trigMethod=(($('wfTrigMethod')||{}).value||'').trim();
      const {data:flowId,error}=await ACC().rpc('wf_save_flow',{p_id:editId,p_name:name,p_desc:desc||null,p_trigger:trigger,p_steps:steps,p_trigger_owner:owner||null,p_trigger_method:trigMethod||null});
      if(error)throw error;
      toast('Workflow saved','ok');
      // work out the word for one item of this workflow ("Invoice", "Leave Request", ...) before
      // opening the detail page, so the buttons already read correctly
      try{ await wfNounLearn(flowId,name,trigger); }catch(_e){}
      navTo('tasks/workflow/'+flowId);
    }catch(e){ toast('Could not save workflow: '+((e&&e.message)||e),'err'); }
  };

  // A timeline card is deliberately minimal: step name, status, who, how long. No department, no
  // action buttons — Revert and Reject live on the person's own task page, and the received/done
  // timestamps are on the status pills in the table. Keeps the card short on a phone even when
  // somebody has a very long name.
  function wfTimelineHtml(steps,opt){
    opt=opt||{};
    return steps.map(function(s,i){
      const person=s.owner_email||s.person;
      const who=person
        ?('<span class="wf-who"><span class="wf-av" style="background:'+colorFor(person)+'">'+esc2(iniOf(wfNm(person)).toUpperCase())+'</span><span class="wf-who-nm">'+esc2(wfNm(person))+'</span></span>')
        :'<span class="wf-who-nm" style="color:var(--slate)">Unassigned</span>';
      const dur=wfDurText(s.duration_value,s.duration_unit); const durHtml=dur?('<span class="wf-dur"><i class="fa-regular fa-clock"></i> '+esc2(dur)+'</span>'):'';
      let badge='', cls='', whenHtml='';
      if(opt.live){
        const done=s.status==='done'||!!s.forwarded_at;
        const cur=!done && (s.status==='received'||s.received_at||s.appeared_at);
        cls=done?'wf-tl-done':(cur?'wf-tl-cur':'wf-tl-wait');
        badge=done?'<span class="wf-badge ok">Done</span>':(cur?'<span class="wf-badge cur">In progress</span>':'<span class="wf-badge wait">Waiting</span>');
        // both moments, with full date + time
        if(s.received_at) whenHtml+='<span class="wf-tl-when"><b>Received</b> '+esc2(wfDTFull(s.received_at))+'</span>';
        if(s.forwarded_at) whenHtml+='<span class="wf-tl-when done"><b>Done</b> '+esc2(wfDTFull(s.forwarded_at))+'</span>';
        // Transition = how long it sat between the previous step finishing (or, for the very
        // first step, the triggering event's initiation) and this step actually being received.
        // Retention = how long THIS step held it between being received and being forwarded —
        // both in the user's requested "Days.Hours" format (e.g. "1.2" = 1 day 2 hours).
        if(s.received_at){
          const transStart = i===0 ? opt.caseCreatedAt : (steps[i-1] && steps[i-1].forwarded_at);
          if(transStart){
            const tt=wfDaysHoursText(new Date(s.received_at)-new Date(transStart));
            if(tt) whenHtml+='<span class="wf-tl-when"><b>Transition</b> '+esc2(tt)+'</span>';
          }
          const retMs=s.forwarded_at?(new Date(s.forwarded_at)-new Date(s.received_at)):(Date.now()-new Date(s.received_at));
          const rt=wfDaysHoursText(retMs);
          if(rt) whenHtml+='<span class="wf-tl-when'+(s.forwarded_at?' done':'')+'"><b>Retention</b> '+esc2(rt)+(s.forwarded_at?'':' · running')+'</span>';
        }
      }
      return '<div class="wf-tl-item '+cls+'"><div class="wf-tl-num">'+(i+1)+'</div><div class="wf-tl-body">'
        +'<div class="wf-tl-row"><div class="wf-tl-title">'+esc2(s.title||'')+' '+badge+'</div><div class="wf-tl-meta">'+who+durHtml+'</div></div>'
        +'<div class="wf-tl-times">'+whenHtml+'</div>'
      +'</div></div>';
    }).join('');
  }

  /* ----- Tracker tab ------------------------------------------------------------------------
     A like-for-like rebuild of the bill tracker spreadsheet's header block (its rows 1-7), driven
     live off the workflow instead of manual typing:

        row 1  o1 · o2 · o3 …   the step code, spanning that step's three columns
        row 2  WHAT             what happens in the step
        row 3  WHO              whose step it is
        row 4  HOW              the channel it runs through (Google Form / ERP / Physically …)
        row 5  WHEN             how long that step is allowed
        row 6                   the real column headers
        row 7+                  one row per instance

     Better than the sheet in three ways: the bill columns come from the workflow's own detail
     fields, so they can never drift out of step with the form; Planned/Actual/Time Delay are read
     from what actually happened rather than typed in; and a delay is coloured, not just printed.
     Tracker lives on bill-style workflows only — ordinary workflows never show this tab. */
  function wfTrackDT(iso){ if(!iso) return ''; try{ const d=new Date(iso);
    const p=function(n){return String(n).padStart(2,'0');};
    return p(d.getDate())+'/'+p(d.getMonth()+1)+'/'+d.getFullYear()+' '+p(d.getHours())+':'+p(d.getMinutes());
  }catch(e){ return String(iso); } }
  // Overshoot against the planned date, in the sheet's own "Dd Hh" shape. Blank when on time.
  function wfTrackDelay(planned,actual){
    if(!planned||!actual) return '';
    const ms=new Date(actual).getTime()-new Date(planned).getTime();
    if(!(ms>0)) return '';
    const h=Math.floor(ms/3600000);
    return Math.floor(h/24)+'d '+(h%24)+'h';
  }
  // Who owns a step, in words. Some steps have no fixed person — they land on whoever the
  // instance's own answers point to (a "Dept Check" goes to that bill's department, a cheque is
  // signed by whichever director owns it). Those used to read as a bare dash. Now: a handful of
  // possible people is named outright ("Shuchandra Das / Shafat Mehar"), and a longer list is
  // summarised by the field that decides it ("Department wise").
  function wfStepWhoText(s){
    if(s && s.owner_email) return wfNm(s.owner_email);
    const map=(s && s.owner_resolve_map && typeof s.owner_resolve_map==='object') ? s.owner_resolve_map : null;
    if(map){
      const seen=[], emails=Object.keys(map).map(function(k){ return map[k]; });
      emails.forEach(function(e){ const n=wfNm(e); if(n && seen.indexOf(n)===-1) seen.push(n); });
      if(seen.length && seen.length<=2) return seen.join(' / ');
      if(s.owner_resolve_field) return String(s.owner_resolve_field)+' wise';
      if(seen.length) return seen.length+' possible people';
    }
    if(s && s.owner_role) return String(s.owner_role);
    return '—';
  }
  function wfTrackerHtml(flow, steps, cases, fcs){
    if(!steps.length) return '<div class="ac-empty" style="cursor:default">Add steps to this workflow to track them</div>';
    if(!cases.length) return '<div class="ac-empty" style="cursor:default">Nothing recorded yet</div>';
    // The bill columns = this workflow's own detail fields, minus the attachment (a file has no
    // place in a tracking grid). Order follows the form, so the two always read the same way.
    const tmpl=(Array.isArray(flow.trigger_template)?flow.trigger_template:[])
      .filter(function(f){ return f && f.label && (f.type||'text')!=='attachment'; });
    const fixed=[{k:'Wheredoc Id'},{k:'Timestamp'}].concat(tmpl.map(function(f){ return {k:f.label}; }));
    const F=fixed.length;
    const byCase={}; fcs.forEach(function(x){ (byCase[x.case_id]=byCase[x.case_id]||{})[x.seq]=x; });

    // The bill columns are not headerless filler — in the sheet they are the workflow's own
    // opening move ("o0"): the triggering event, who raises it, how, and when. Without this the
    // whole left-hand block of the header sat empty.
    const zero={
      what:(flow.trigger_event||flow.name||''),
      who:(wfNm(flow.trigger_owner)||''),
      how:(flow.trigger_method||''),
      when:'Whenever needed'
    };
    // The bill columns get no step code of their own — the sheet doesn't label them either.
    const codeRow='<tr class="wf-tk-code"><th colspan="'+F+'" class="wf-tk-nocode"></th>'
      +steps.map(function(s,i){ return '<th colspan="3" class="wf-tk-gap">o'+(i+1)+'</th>'; }).join('')
      +'<th class="wf-tk-gap"></th></tr>';
    const bandRow=function(label,zeroVal,pick){
      return '<tr class="wf-tk-band"><th class="wf-tk-bandlbl">'+label+'</th>'
        +(F>1?('<th colspan="'+(F-1)+'" title="'+esc2(zeroVal||'')+'">'+esc2(zeroVal||'—')+'</th>'):'')
        +steps.map(function(s){ const v=pick(s); return '<th colspan="3" class="wf-tk-gap" title="'+esc2(v||'')+'">'+esc2(v||'—')+'</th>'; }).join('')
        +'<th class="wf-tk-gap"></th></tr>';
    };
    const head=codeRow
      +bandRow('WHAT',zero.what,function(s){ return s.title||('Step '+s.seq); })
      +bandRow('WHO',zero.who,wfStepWhoText)
      +bandRow('HOW',zero.how,function(s){ return s.method||''; })
      +bandRow('WHEN',zero.when,function(s){ const d=wfDurText(s.duration_value,s.duration_unit); return d?('In next '+d):''; })
      +'<tr class="wf-tk-cols">'+fixed.map(function(f){ return '<th>'+esc2(f.k)+'</th>'; }).join('')
        +steps.map(function(){ return '<th class="wf-tk-gap">Planned</th><th>Actual</th><th>Time Delay</th>'; }).join('')
        +'<th class="wf-tk-gap">Current Step</th></tr>';

    const body=cases.map(function(c){
      const by={}; (Array.isArray(c.trigger_details)?c.trigger_details:[]).forEach(function(d){ if(d&&d.label) by[d.label]=d.value; });
      const left='<td><b>'+wfCaseNoText(c)+'</b></td><td>'+esc2(wfTrackDT(c.created_at))+'</td>'
        +tmpl.map(function(f){ return '<td>'+esc2(by[f.label]||'')+'</td>'; }).join('');
      const cells=steps.map(function(s){
        const cs=byCase[c.id]&&byCase[c.id][s.seq];
        const planned=cs&&cs.due_at, actual=cs&&cs.forwarded_at;
        const delay=wfTrackDelay(planned,actual);
        return '<td class="wf-tk-gap">'+esc2(planned?wfTrackDT(planned):'')+'</td>'
          +'<td>'+esc2(actual?wfTrackDT(actual):'')+'</td>'
          +'<td class="'+(delay?'wf-tk-late':'')+'">'+esc2(delay)+'</td>';
      }).join('');
      let now='Done';
      if(c.status==='Cancelled') now='Cancelled';
      else if(c.status!=='Done'){ const cur=steps.filter(function(s){ return s.seq===c.current_step; })[0];
        now=cur?(cur.title||('Step '+cur.seq)):'—'; }
      return '<tr>'+left+cells+'<td class="wf-tk-gap"><b>'+esc2(now)+'</b></td></tr>';
    }).join('');

    return '<div class="wf-tablewrap wf-tk-wrap"><table class="wf-itable wf-tktable"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>';
  }
  // Each header row sticks below the one above it, which needs the real height of every row
  // before it — guessing a fixed number left a strip of body text showing through between the
  // bands. Measured here instead, and re-measured whenever the pane is shown or the window
  // resizes (row heights change when long text re-wraps).
  window.wfTrackerSticky=function(){
    const t=document.querySelector('.wf-tktable'); if(!t) return;
    const rows=[].slice.call(t.querySelectorAll('thead tr'));
    let top=0;
    rows.forEach(function(tr){
      [].slice.call(tr.children).forEach(function(th){ th.style.top=top+'px'; });
      top+=tr.getBoundingClientRect().height;
    });
  };
  /* ----- Forms tab --------------------------------------------------------------------------
     The Google Forms this workflow actually runs on, and who is expected to fill each one - the
     same shape as Recruitment > Tests. Held in acc.flow_forms; anyone can read them, only
     Administration can change them, matching who may edit the workflow itself. */
  window._wfForms=[];
  function wfFormsTableHtml(forms, canManage){
    if(!forms.length){
      return '<div class="ac-empty" style="cursor:default">'
        +'No forms added yet.'+(canManage?' Use <b>Add form</b> to record the Google Forms this workflow runs on and who fills them.':'')
      +'</div>';
    }
    const link=function(u,label){
      if(!u) return '<span style="color:var(--slate)">—</span>';
      return '<a href="'+esc2(u)+'" target="_blank" rel="noopener">'+esc2(label)+' <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px"></i></a>';
    };
    return '<div class="wf-tablewrap"><table class="wf-itable"><thead><tr>'
      +'<th style="width:52px">Sl</th><th>Form</th><th>Who fills it</th><th>Step</th><th>Open</th><th>Responses</th>'
      +(canManage?'<th style="width:92px">Edit</th>':'')
    +'</tr></thead><tbody>'
    +forms.map(function(f,i){
      return '<tr'+(f.active?'':' style="opacity:.5"')+'>'
        +'<td>'+(f.sl||i+1)+'</td>'
        +'<td><b>'+esc2(f.name)+'</b>'+(f.notes?('<div style="font-size:11.5px;color:var(--slate);white-space:normal">'+esc2(f.notes)+'</div>'):'')+'</td>'
        +'<td>'+(f.who_fills?esc2(f.who_fills):'<span style="color:var(--slate)">—</span>')+'</td>'
        +'<td>'+(f.step_seq?('Step '+f.step_seq):'<span style="color:var(--slate)">—</span>')+'</td>'
        +'<td>'+link(f.link,'Form')+'</td>'
        +'<td>'+link(f.response_sheet_url,'Sheet')+'</td>'
        +(canManage?('<td style="white-space:nowrap">'
          +'<button class="ac-btn ic" title="Edit" onclick="wfFormEdit('+f.id+')"><i class="fa-solid fa-pen"></i></button> '
          +'<button class="ac-btn ic danger" title="Remove" onclick="wfFormDelete('+f.id+')"><i class="fa-solid fa-trash"></i></button></td>'):'')
      +'</tr>';
    }).join('')
    +'</tbody></table></div>';
  }
  window.wfFormModal=function(id){
    const f=(window._wfForms||[]).filter(function(x){return String(x.id)===String(id);})[0]||{};
    const steps=window._wfSteps||[];
    openModal('<div class="modal-head"><h3><i class="fa-solid fa-clipboard-list"></i> '+(id?'Edit form':'Add form')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
      +'<div class="modal-body wf-form-modal">'
        +'<label class="wf-lbl" style="margin-top:0">Form name</label>'
        +'<input id="wfFmName" class="ac-in" value="'+esc2(f.name||'')+'" placeholder="e.g. New Bill Recording">'
        +'<label class="wf-lbl">Who fills it in</label>'
        +'<input id="wfFmWho" class="ac-in" value="'+esc2(f.who_fills||'')+'" placeholder="A person, or a role such as “Department person”">'
        +'<label class="wf-lbl">Form link</label>'
        +'<input id="wfFmLink" class="ac-in" value="'+esc2(f.link||'')+'" placeholder="https://docs.google.com/forms/…">'
        +'<label class="wf-lbl">Responses sheet (optional)</label>'
        +'<input id="wfFmSheet" class="ac-in" value="'+esc2(f.response_sheet_url||'')+'" placeholder="https://docs.google.com/spreadsheets/…">'
        +'<label class="wf-lbl">Belongs to step (optional)</label>'
        +'<select id="wfFmStep" class="ac-in"><option value="">— not tied to a step —</option>'
          +steps.map(function(s){ return '<option value="'+s.seq+'"'+(String(f.step_seq||'')===String(s.seq)?' selected':'')+'>Step '+s.seq+' · '+esc2(s.title||'')+'</option>'; }).join('')
        +'</select>'
        +'<label class="wf-lbl">Notes (optional)</label>'
        +'<input id="wfFmNotes" class="ac-in" value="'+esc2(f.notes||'')+'" placeholder="Anything worth knowing about this form">'
      +'</div>'
      +'<div class="modal-foot"><button class="ac-btn" onclick="closeModal()">Cancel</button>'
      +'<button class="ac-btn primary" onclick="wfFormSave('+(id||'null')+')"><i class="fa-solid fa-check"></i> Save</button></div>','md');
  };
  window.wfFormEdit=function(id){ wfFormModal(id); };
  window.wfFormSave=async function(id){
    const v=function(k){ const el=$(k); return el?String(el.value||'').trim():''; };
    const name=v('wfFmName');
    if(!name){ toast('Give the form a name','warn'); return; }
    const stepRaw=v('wfFmStep');
    const row={flow_id:window._wfFlowId, name:name, who_fills:v('wfFmWho')||null,
      link:v('wfFmLink')||null, response_sheet_url:v('wfFmSheet')||null,
      step_seq:stepRaw?Number(stepRaw):null, notes:v('wfFmNotes')||null, updated_at:new Date().toISOString()};
    try{
      if(id){ const {error}=await ACC().from('flow_forms').update(row).eq('id',id); if(error)throw error; }
      else {
        row.sl=(window._wfForms||[]).length+1;
        const {error}=await ACC().from('flow_forms').insert(row); if(error)throw error;
      }
    }catch(e){ toast('Could not save: '+((e&&e.message)||e),'err'); return; }
    try{ closeModal(); }catch(_e){}
    toast(id?'Form updated':'Form added','ok');
    renderPage();
  };
  window.wfFormDelete=async function(id){
    const ok=await confirmDialog('Remove this form from the list? The Google Form itself is untouched.',{okLabel:'Remove'});
    if(!ok) return;
    try{ const {error}=await ACC().from('flow_forms').delete().eq('id',id); if(error)throw error; }
    catch(e){ toast('Could not remove: '+((e&&e.message)||e),'err'); return; }
    toast('Removed','ok'); renderPage();
  };
  // The panes of a workflow. Tracker is bill-style only; Forms appears wherever forms exist (and
  // for an Administration user, so they can add the first one).
  window.wfTabShow=function(which){
    ['main','tracker','forms'].forEach(function(k){
      const p=$('wfPane_'+k), b=$('wfTabBtn_'+k);
      if(p) p.style.display=(k===which)?'':'none';
      if(b) b.classList.toggle('on', k===which);
    });
    if(which==='tracker') setTimeout(wfTrackerSticky,0);
  };
  if(!window._wfTkResizeWired){
    window._wfTkResizeWired=true;
    window.addEventListener('resize',function(){ if(document.querySelector('.wf-tktable')) wfTrackerSticky(); });
  }

  async function wfDetailPage(v, id, selCaseId){
    wfInjectCss(); setCrumb(['Accountability','Workflow']);
    v.innerHTML='<div class="loader"><div class="spin"></div></div>';
    if(!WF_PEOPLE){ try{ WF_PEOPLE=await people(); }catch(e){ WF_PEOPLE=[]; } }
    let flow=null, steps=[], cases=[], fcs=[];
    try{ const {data}=await ACC().from('flows').select('*').eq('id',id).maybeSingle(); flow=data; }catch(e){}
    try{ const {data}=await ACC().from('flow_steps').select('*').eq('flow_id',id).order('seq',{ascending:true}); steps=data||[]; }catch(e){}
    if(!flow){ toast('Workflow not found','err'); return navTo('tasks/workflow'); }
    try{ const {data}=await ACC().from('flow_cases').select('*').eq('flow_id',id).order('case_no',{ascending:true}); cases=data||[]; }catch(e){}
    if(cases.length){ try{ const {data}=await ACC().from('flow_case_steps').select('*').in('case_id',cases.map(function(c){return c.id;})); fcs=data||[]; }catch(e){} }
    let forms=[];
    try{ const {data}=await ACC().from('flow_forms').select('*').eq('flow_id',id).order('sl',{ascending:true}); forms=data||[]; }catch(e){}
    window._wfForms=forms; window._wfSteps=steps;
    const mySelf=me();
    const isCreator=eq(flow.created_by||'',mySelf);
    // Matches the backend's own acc.wf_create_instance permission check exactly: the creator can
    // always start one; when a trigger_owner is set, ONLY that person can (not every visitor —
    // the previous `!flow.trigger_owner || ...` showed this button to everyone whenever
    // trigger_owner happened to be unset); when there's no trigger_owner, any step owner can.
    const isStepOwner = steps.some(function(s){ return eq(s.owner_email||'', mySelf); });
    // Starting a new instance ("New <Noun>") is additionally open to everyone in Systems or
    // Administration, on top of the creator/trigger-owner/step-owner paths — mirrors
    // acc.wf_create_instance's own OR acc.wf_can_create_flow() check server-side.
    const canEvent = isCreator || (flow.trigger_owner ? eq(flow.trigger_owner, mySelf) : isStepOwner) || wfInAnyDept(WF_CREATE_DEPTS);
    // Editing/deleting the workflow itself (and, further down, its instances) is Administration-
    // department only — mirrors acc.wf_is_admin_dept(), the real server-side enforcement.
    const canManage = wfInDept('Administration');
    window._wfFlowId=id; window._wfDelId = canManage ? id : null; wfWireDeleteKey();
    // the word this workflow deals in — "Invoice", "Leave Request", ... used all over this page
    const N=wfNounOf(flow); window._wfNoun=N;
    // older workflows saved before this feature have no word yet — learn it once, quietly
    if(!flow.instance_noun){ wfNounLearn(id,flow.name,flow.trigger_event).then(function(r){
      if(r&&r.noun&&r.noun!==N.one&&ROUTE&&ROUTE.tab==='workflow') renderPage();
    }); }
    const members=[];
    if(flow.trigger_owner && !members.some(function(e){return eq(e,flow.trigger_owner);})) members.push(flow.trigger_owner);
    steps.forEach(function(s){ if(s.owner_email&&!members.some(function(e){return eq(e,s.owner_email);}))members.push(s.owner_email); });

    // Default timeline panel = the workflow's step definition
    const defTL=wfTimelineHtml(steps,{})||'<div class="ac-empty" style="cursor:default">No steps yet</div>';
    window._wfDefTL='<div class="wf-tlhead"><div class="wf-tlhead-t"><i class="fa-solid fa-list-ol"></i> Workflow steps'+tip('The steps every '+N.lc+' goes through, in order, with who does each one and how long they have. Click a row in the table below to see how a particular '+N.lc+' is progressing.')+'</div></div>'+defTL;

    // Instances table
    const isBill=wfIsBillFlow(flow); window._wfIsBill=isBill;
    // Forms show wherever any exist; an Administration user always sees the tab so they can add
    // the first one.
    const showForms=forms.length>0 || canManage;
    let tableHtml='';
    if(cases.length){
      const byCase={}; fcs.forEach(function(x){ (byCase[x.case_id]=byCase[x.case_id]||{})[x.seq]=x; });
      const firstSeq = steps.length ? steps.reduce(function(m,s){return s.seq<m?s.seq:m;}, steps[0].seq) : null;
      const head=(canManage?'<th class="wf-chk-col"></th>':'')
        // On the bill workflow the number IS the Wheredoc Id it was filed under; ordinary
        // workflows just count their instances.
        +'<th>'+(isBill?'Wheredoc Id':'No.')+'</th>'+(isBill?'<th>Unique Bill Id</th>':'')
        +'<th>'+esc2(N.one)+'</th>'+steps.map(function(s){return '<th title="'+esc2(s.title||'')+'">'+esc2(s.title||('Step '+s.seq))+'</th>';}).join('');
      const rows=cases.map(function(c){
        const cells=steps.map(function(s){
          const cs=(byCase[c.id]||{})[s.seq];
          if(cs&&(cs.status==='done'||cs.forwarded_at)){ var rcv=cs.received_at?wfDT(cs.received_at):'—'; var don=cs.forwarded_at?wfDT(cs.forwarded_at):'—'; return '<td><span class="wf-pill ok wf-poptip" tabindex="0" onclick="event.stopPropagation();wfPopToggle(this)"><i class="fa-solid fa-check"></i> Done<span class="wf-tip-txt">Received: '+esc2(rcv)+'<br>Done: '+esc2(don)+'</span></span></td>'; }
          if(c.status==='Pending' && c.current_step===s.seq){
            if(cs&&cs.received_at) return '<td><span class="wf-pill cur wf-poptip" tabindex="0" onclick="event.stopPropagation();wfPopToggle(this)"><i class="fa-solid fa-inbox"></i> Received<span class="wf-tip-txt">Received: '+esc2(wfDT(cs.received_at))+'</span></span></td>';
            return '<td><span class="wf-pill wt"><i class="fa-solid fa-hourglass-half"></i> Waiting</span></td>';
          }
          return '<td><span class="wf-pill wait">·</span></td>';
        }).join('');
        const fst=firstSeq!=null?(byCase[c.id]||{})[firstSeq]:null;
        const firstDone=!!(fst&&(fst.status==='done'||fst.forwarded_at));
        const firstReceived=!!(fst&&(fst.received_at||fst.status==='received'||firstDone));
        const instOver=(c.status==='Done'||c.status==='Cancelled');
        const uniqueBillId=(Array.isArray(c.trigger_details)?c.trigger_details:[]).find(function(d){return d&&eq(d.label,'Unique bill Id');});
        return '<tr data-case="'+c.id+'" data-caseno5="'+wfCaseNoText(c)+'" data-created="'+esc2((c.created_at||'').slice(0,10))+'" onclick="wfShowCase('+c.id+',this)">'
          +(canManage?'<td class="wf-chk-col" onclick="event.stopPropagation()"><input type="checkbox" class="wf-inst-chk" data-case="'+c.id+'" data-inst-over="'+(instOver?'1':'0')+'" data-first-received="'+(firstReceived?'1':'0')+'" onclick="event.stopPropagation();wfInstSelChange()"></td>':'')
          +'<td><b>'+wfCaseNoText(c)+'</b></td>'+(isBill?('<td>'+esc2((uniqueBillId&&uniqueBillId.value)||'—')+'</td>'):'')+'<td class="wf-trigcell">'+esc2(wfTrigShort(c))+'</td>'+cells+'</tr>';
      }).join('');
      tableHtml='<div class="wf-card"><div class="wf-card-hd"><i class="fa-solid fa-table-list"></i> '+esc2(N.many)+' <span class="cnt">'+cases.length+'</span>'
        +tip('One row per '+N.lc+'. Can’t be deleted once its first step is received, or edited once it’s completed.')
        +(canManage?('<span class="wf-inst-tools"><button class="ac-btn ic" id="wfInstEdit" title="Edit selected '+esc2(N.lc)+'" disabled onclick="wfInstEditSel()"><i class="fa-solid fa-pen"></i></button><button class="ac-btn ic danger" id="wfInstDel" title="Delete selected" disabled onclick="wfInstDelSel()"><i class="fa-solid fa-trash"></i></button></span>'):'')+'</div>'
        +'<div class="wf-inst-filterbar">'
          +'<div class="wf-inst-filter-search"><i class="fa-solid fa-magnifying-glass"></i><input class="ac-in" id="wfInstSearch" placeholder="'+(isBill?'Search by Wheredoc Id…':'Search by No.…')+'" oninput="wfInstFilter()"></div>'
          +'<div class="wf-inst-filter-dates">'
            +'<label class="wf-lbl">From<input type="date" class="ac-in" id="wfInstDateFrom" onchange="wfInstDateFromChange()"></label>'
            +'<i class="fa-solid fa-arrow-right-long wf-daterange-sep"></i>'
            +'<label class="wf-lbl">To<input type="date" class="ac-in" id="wfInstDateTo"></label>'
            +'<button class="ac-btn primary" onclick="wfInstDateApply()"><i class="fa-solid fa-check"></i> Update</button>'
            +'<button class="ac-btn ic" title="Clear filters" onclick="wfInstFilterClear()"><i class="fa-solid fa-xmark"></i></button>'
          +'</div>'
        +'</div>'
        +'<div class="wf-tablewrap"><table class="wf-itable"><thead><tr>'+head+'</tr></thead><tbody>'+rows+'</tbody></table><div id="wfInstNoMatch" class="ac-empty" style="cursor:default;display:none">No matches</div></div></div>';
    }

    const headActs='<div class="wf-head-acts">'
      +(canManage?('<button class="ac-btn" onclick="wfEdit('+id+')"><i class="fa-solid fa-pen"></i><span class="wf-btxt"> Edit</span></button>'
                  +'<button class="ac-btn danger" title="Delete (Del key)" onclick="wfDelete('+id+')"><i class="fa-solid fa-trash"></i><span class="wf-btxt"> Delete</span></button>'):'')
      +(canEvent?'<button class="ac-btn primary" title="Start a new '+esc2(N.lc)+'" onclick="wfEventOpen('+id+')"><i class="fa-solid fa-bolt"></i><span class="wf-btxt"> New '+esc2(N.one)+'</span></button>':'')
      +'</div>';

    v.innerHTML='<div class="wf-page">'
      +'<div class="wf-page-head"><button class="ac-btn ic" title="Back" onclick="wfCancel()"><i class="fa-solid fa-arrow-left"></i></button><h1><i class="fa-solid fa-diagram-project"></i> '+esc2(flow.name||'Workflow')+'</h1>'+headActs+'</div>'
      +'<div class="wf-card wf-meta">'
        +(flow.description?'<div class="wf-desc">'+esc2(flow.description)+'</div>':'')
        +'<div class="wf-trig-box"><i class="fa-solid fa-bolt"></i> <b>Triggering event:</b> '+esc2(flow.trigger_event||'—')+'</div>'
        +'<div class="wf-members-row"><span class="wf-mini-lbl">People</span>'+wfCircles(members)+'</div>'
      +'</div>'
      +((isBill||showForms)?('<div class="wf-tabs">'
          +'<button class="wf-tab on" id="wfTabBtn_main" onclick="wfTabShow(\'main\')"><i class="fa-solid fa-list-check"></i> '+esc2(N.many)+'</button>'
          +(isBill?'<button class="wf-tab" id="wfTabBtn_tracker" onclick="wfTabShow(\'tracker\')"><i class="fa-solid fa-table-columns"></i> Tracker</button>':'')
          +(showForms?('<button class="wf-tab" id="wfTabBtn_forms" onclick="wfTabShow(\'forms\')"><i class="fa-solid fa-clipboard-list"></i> Forms'
             +(forms.length?(' <span class="cnt">'+forms.length+'</span>'):'')+'</button>'):'')
        +'</div>'):'')
      +'<div id="wfPane_main">'
        +'<div class="wf-card wf-tlcard"><div id="wfTL">'+window._wfDefTL+'</div></div>'
        +tableHtml
      +'</div>'
      +(isBill?('<div id="wfPane_tracker" style="display:none"><div class="wf-card">'
          +'<div class="wf-card-hd"><i class="fa-solid fa-table-columns"></i> Tracker <span class="cnt">'+cases.length+'</span>'
          +tip('Every '+N.lc+' against every step: when the step was due (Planned), when it was actually forwarded on (Actual), and by how much it ran over (Time Delay). Scroll sideways to see all the steps.')+'</div>'
          +wfTrackerHtml(flow,steps,cases,fcs)
        +'</div></div>'):'')
      +(showForms?('<div id="wfPane_forms" style="display:none"><div class="wf-card">'
          +'<div class="wf-card-hd"><i class="fa-solid fa-clipboard-list"></i> Forms'
            +(forms.length?(' <span class="cnt">'+forms.length+'</span>'):'')
            +tip('The Google Forms this workflow runs on, and who is expected to fill each one. Opening a form or its responses sheet goes straight to Google.')
            +(canManage?'<span class="wf-inst-tools"><button class="ac-btn primary" onclick="wfFormModal()"><i class="fa-solid fa-plus"></i> Add form</button></span>':'')
          +'</div>'
          +wfFormsTableHtml(forms,canManage)
        +'</div></div>'):'')
    +'</div>';
    if(selCaseId){ wfShowCase(selCaseId, null); }
  }

  function wfN(){ return window._wfNoun || {one:'Event',many:'Events',lc:'event',lcMany:'events'}; }
  // Instance search (by the 5-digit Id ONLY — not Unique Bill Id or any other field, per the
  // user's explicit instruction) is live as you type; the created-date range only takes effect
  // once "Update" is clicked (not on every date pick), so it's tracked separately here rather
  // than read straight from the inputs on every filter pass.
  window._wfInstDateFilter={from:'',to:''};
  window.wfInstFilter=function(){
    const q=(($('wfInstSearch')||{}).value||'').trim();
    const from=window._wfInstDateFilter.from, to=window._wfInstDateFilter.to;
    const rows=[].slice.call(document.querySelectorAll('.wf-itable tbody tr'));
    let shown=0;
    rows.forEach(function(r){
      const id5=r.getAttribute('data-caseno5')||'';
      const created=r.getAttribute('data-created')||'';
      let ok=true;
      if(q && id5.indexOf(q)===-1) ok=false;
      if(ok && from && created && created<from) ok=false;
      if(ok && to && created && created>to) ok=false;
      r.style.display=ok?'':'none';
      if(ok) shown++;
    });
    const nm=$('wfInstNoMatch'); if(nm) nm.style.display=(rows.length&&!shown)?'':'none';
  };
  // To can never be earlier than From — once From is picked, To's minimum becomes that date
  // (and if To was already set to something now-invalid, it's cleared rather than left wrong).
  window.wfInstDateFromChange=function(){
    const f=$('wfInstDateFrom'), t=$('wfInstDateTo'); if(!f||!t)return;
    t.min=f.value||'';
    if(f.value && t.value && t.value<f.value) t.value='';
  };
  window.wfInstDateApply=function(){
    window._wfInstDateFilter={from:(($('wfInstDateFrom')||{}).value||''), to:(($('wfInstDateTo')||{}).value||'')};
    wfInstFilter();
  };
  window.wfInstFilterClear=function(){
    const s=$('wfInstSearch'), f=$('wfInstDateFrom'), t=$('wfInstDateTo');
    if(s)s.value=''; if(f)f.value=''; if(t){t.value='';t.min='';}
    window._wfInstDateFilter={from:'',to:''};
    wfInstFilter();
  };
  window.wfInstSelChange=function(){
    const checks=[].slice.call(document.querySelectorAll('.wf-inst-chk:checked'));
    const eb=$('wfInstEdit'), db=$('wfInstDel'), N=wfN();
    const oneSel = checks.length===1;
    const editBlocked = oneSel && checks[0].getAttribute('data-inst-over')==='1';
    const delBlocked = checks.some(function(c){ return c.getAttribute('data-first-received')==='1'; });
    if(eb){ eb.disabled = !oneSel || editBlocked; eb.title = editBlocked ? ('Can’t edit — this '+N.lc+' is already over (completed)') : ('Edit selected '+N.lc); }
    if(db){ db.disabled = checks.length<1 || delBlocked; db.title = delBlocked ? ('Can’t delete — a selected '+N.lc+' has already started (first step received)') : 'Delete selected'; }
  };
  window.wfInstEditSel=function(){
    const checks=[].slice.call(document.querySelectorAll('.wf-inst-chk:checked'));
    if(checks.length!==1) return;
    if(checks[0].getAttribute('data-inst-over')==='1'){ toast('Can’t edit — this '+wfN().lc+' is already over','err'); return; }
    wfEventOpen(window._wfFlowId, Number(checks[0].getAttribute('data-case')));
  };
  window.wfInstDelSel=function(){
    const checks=[].slice.call(document.querySelectorAll('.wf-inst-chk:checked'));
    if(!checks.length) return;
    const N=wfN();
    if(checks.some(function(c){ return c.getAttribute('data-first-received')==='1'; })){ toast('Can’t delete — a selected '+N.lc+' has already started (first step received)','err'); return; }
    const ids=checks.map(function(c){return Number(c.getAttribute('data-case'));});
    const word=(ids.length===1?N.lc:N.lcMany);
    wfConfirm({ title:'Delete '+ids.length+' '+word+'?', body:'This permanently removes the selected '+word+' and any tasks they created.', okLabel:'Delete', okClass:'danger', onOk:async function(){
      try{ const {error}=await ACC().rpc('wf_delete_cases',{p_ids:ids}); if(error)throw error; }catch(e){ toast('Could not delete: '+((e&&e.message)||e),'err'); return; }
      toast('Deleted','ok'); renderPage();
    }});
  };

  async function wfCaseRoute(v, caseId){
    let c=null; try{ const {data}=await ACC().from('flow_cases').select('flow_id').eq('id',caseId).maybeSingle(); c=data; }catch(e){}
    if(!c){ toast('Not found','err'); return navTo('tasks/workflow'); }
    return wfDetailPage(v, c.flow_id, caseId);
  }

  window.wfShowDef=function(){ const box=$('wfTL'); if(box&&window._wfDefTL!=null) box.innerHTML=window._wfDefTL; document.querySelectorAll('.wf-itable tbody tr.sel').forEach(function(r){r.classList.remove('sel');}); };

  window.wfShowCase=async function(caseId, rowEl){
    const box=$('wfTL'); if(box) box.innerHTML='<div class="loader"><div class="spin"></div></div>';
    document.querySelectorAll('.wf-itable tbody tr.sel').forEach(function(r){r.classList.remove('sel');});
    const tr=rowEl||document.querySelector('.wf-itable tbody tr[data-case="'+caseId+'"]'); if(tr)tr.classList.add('sel');
    let c=null,fcs=[],updates=[],atts=[];
    try{ const {data}=await ACC().from('flow_cases').select('*').eq('id',caseId).maybeSingle(); c=data; }catch(e){}
    try{ const {data}=await ACC().from('flow_case_steps').select('*').eq('case_id',caseId).order('seq',{ascending:true}); fcs=data||[]; }catch(e){}
    try{ const {data}=await ACC().from('flow_updates').select('*').eq('case_id',caseId).order('created_at',{ascending:true}); updates=data||[]; }catch(e){}
    if(updates.length){ try{ const {data}=await ACC().from('flow_update_attachments').select('*').in('update_id',updates.map(function(u){return u.id;})); atts=data||[]; }catch(e){} }
    const attsByUpdate={}; atts.forEach(function(a){ (attsByUpdate[a.update_id]=attsByUpdate[a.update_id]||[]).push(a); });
    if(!box)return;
    if(!c){ box.innerHTML='<div class="ac-empty" style="cursor:default">Not found</div>'; return; }
    const det=Array.isArray(c.trigger_details)?c.trigger_details:[];
    const detHtml=wfCaseSummaryHtml(c) || (det.length?('<ul class="wf-detlist">'+det.map(function(d){return '<li>'+(d.label?('<span class="wf-detk">'+esc2(d.label)+'</span> '):'')+esc2(d.value||'')+'</li>';}).join('')+'</ul>'):'');
    const pinned=wfOriginalAttachmentHtml(c);
    box.innerHTML='<div class="wf-tlhead"><div class="wf-tlhead-t"><i class="fa-solid fa-diagram-project"></i> '+esc2(wfN().one)+' '+wfCaseNoText(c)+' '+(c.status==='Done'?'<span class="ac-chip ac-c-Completed">Done</span>':(c.status==='Cancelled'?'<span class="ac-chip" style="background:#fee2e2;color:#b91c1c">Cancelled</span>':'<span class="ac-chip ac-c-Pending">In progress</span>'))+'</div><button class="wf-tlhead-x" onclick="wfShowDef()" title="Show workflow steps"><i class="fa-solid fa-xmark"></i></button></div>'
      +'<div class="wf-trig-box"><i class="fa-solid fa-bolt"></i> <b>Triggering event:</b> '+esc2(c.title||'')+'</div>'+detHtml
      +'<div class="wf-timeline" style="margin-top:12px">'+(wfTimelineHtml(fcs,{live:true,caseStatus:c.status,caseCreatedAt:c.created_at})||'')+'</div>'
      +((updates.length||pinned)?('<div class="wf-updmini"><div class="wf-updmini-h"><i class="fa-solid fa-comments"></i> Updates'+tip('Notes people added while this '+wfN().lc+' moved through the steps, oldest first. Everyone in this workflow can see them.')+'</div>'+pinned+'<div class="wf-updmini-list">'+updates.map(function(u){return wfUpdateHtml(u,attsByUpdate[u.id]);}).join('')+'</div></div>'):'');
    wfHydrateAttThumbs();
  };

  function wfWireDeleteKey(){ if(window._wfKeyWired)return; window._wfKeyWired=true; document.addEventListener('keydown',function(e){ if(e.key!=='Delete')return; if(!window._wfDelId)return; const ae=document.activeElement, tag=(ae&&ae.tagName)||''; if(/INPUT|TEXTAREA|SELECT/.test(tag)||(ae&&ae.isContentEditable))return; window.wfDelete(window._wfDelId); }); }

  window.wfDelete=function(id){
    wfConfirm({ title:'Delete this workflow?', body:'This permanently removes the workflow and all its '+wfN().lcMany+' and their tasks. This cannot be undone.', okLabel:'Delete', okClass:'danger', onOk:async function(){
      try{ const {error}=await ACC().rpc('wf_delete_flow',{p_id:id}); if(error)throw error; }
      catch(e){ toast('Could not delete workflow: '+((e&&e.message)||e),'err'); return; }
      window._wfDelId=null; toast('Workflow deleted','ok'); navTo('tasks/workflow');
    }});
  };

  /* ----- New <Noun> form (e.g. "New Invoice") ----- */
  // Event-field types. Historically every trigger_template field was plain free text; a field
  // entry can now optionally carry a `type` ('text'|'date'|'number'|'select'|'attachment') and,
  // for 'select', an `options:[{label,group?}]` list — absent `type` still means 'text', so every
  // pre-existing workflow's plain-text fields render exactly as before.
  function wfEvtRowHtml(field,value,locked){
    const f=(typeof field==='string')?{label:field}:(field||{});
    const label=f.label||'', type=f.type||'text';
    const labelHtml=locked
      ?('<div class="ac-in wf-evt-labelro" style="flex:1;min-width:0;background:#f8fafc;color:var(--ink);display:flex;align-items:center;gap:7px;overflow:hidden"><i class="fa-solid fa-lock" style="font-size:10px;color:var(--slate);flex:none"></i><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc2(label)+(f.optional?' <span style="color:var(--slate);font-weight:400">(optional)</span>':'')+'</span></div><input type="hidden" class="wf-evt-label" value="'+esc2(label)+'">')
      :('<input class="ac-in wf-evt-label" placeholder="Label (e.g. Customer, Unit no.)" value="'+esc2(label)+'">');
    let valueHtml;
    if(type==='select'){
      const opts=Array.isArray(f.options)?f.options:[];
      const groups={}, order=[];
      opts.forEach(function(o){ const g=(o&&o.group)||''; if(!groups[g]){groups[g]=[];order.push(g);} groups[g].push(o); });
      const optHtml=order.map(function(g){
        const inner=groups[g].map(function(o){ return '<option value="'+esc2(o.label)+'"'+(eq(o.label,value)?' selected':'')+'>'+esc2(o.label)+'</option>'; }).join('');
        return g?('<optgroup label="'+esc2(g)+'">'+inner+'</optgroup>'):inner;
      }).join('');
      valueHtml='<select class="ac-in wf-evt-value">'+(f.optional?'<option value="">—</option>':'<option value="" disabled'+(value?'':' selected')+'>Select…</option>')+optHtml+'</select>';
    } else if(type==='attachment'){
      const has=value && String(value).indexOf('s3:')===0;
      valueHtml='<div class="wf-evt-att">'
        +(has
          ?('<span class="wf-evt-att-name"><i class="fa-solid fa-paperclip"></i> Attached <button type="button" class="ac-btn ic" onclick="wfEvtAttClear(this)" title="Remove"><i class="fa-solid fa-xmark"></i></button></span>')
          :('<label class="wf-evt-attbox"><i class="fa-solid fa-paperclip"></i> Choose a file'
             +'<input type="file" class="wf-evt-attinput" onchange="wfEvtAttPick(this)"></label>'))
        +'<input type="hidden" class="wf-evt-value" value="'+esc2(has?value:'')+'">'
      +'</div>';
    } else {
      const inputType=type==='date'?'date':(type==='number'?'number':'text');
      // "Unique bill Id" always follows the c<4 digits> convention (e.g. c2950) — hinted via
      // placeholder here, enforced in wfEventSave before it's allowed to save.
      const placeholder=eq(label,'Unique bill Id')?'e.g. c2950':(f.optional?'Optional':'Detail');
      valueHtml='<input class="ac-in wf-evt-value" type="'+inputType+'" placeholder="'+esc2(placeholder)+'" value="'+esc2(value||'')+'">';
    }
    const removeBtn=locked?'':'<button class="ac-btn ic danger" title="Remove" onclick="wfEvtRemove(this)"><i class="fa-solid fa-xmark"></i></button>';
    // data-orig remembers what was already saved in this field, so wfEventSave can tell an
    // untouched legacy value apart from something the person actually typed just now.
    return '<div class="wf-evt-row" data-type="'+esc2(type)+'" data-optional="'+(f.optional?'1':'0')+'" data-orig="'+esc2(value||'')+'">'+labelHtml+valueHtml+removeBtn+'</div>';
  }
  window.wfEvtAttPick=async function(input){
    const file=input.files&&input.files[0]; if(!file)return;
    const wrap=input.closest('.wf-evt-att'); if(!wrap)return;
    const box=input.closest('.wf-evt-attbox');
    input.disabled=true;
    if(box){ box.classList.add('busy'); box.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading '+esc2(file.name); box.appendChild(input); }
    try{
      const evtForm=document.querySelector('.wf-evt-form');
      const key=s3KeyForFlowEvent((evtForm&&evtForm.getAttribute('data-flow'))||'0', file.name);
      const {data,error}=await uploadFileToS3(key,file);
      if(error) throw error;
      wrap.innerHTML='<span class="wf-evt-att-name"><i class="fa-solid fa-paperclip"></i> '+esc2(file.name)+' <button type="button" class="ac-btn ic" onclick="wfEvtAttClear(this)" title="Remove"><i class="fa-solid fa-xmark"></i></button></span><input type="hidden" class="wf-evt-value" value="'+esc2(data.path)+'">';
    }catch(e){ toast('Upload failed: '+((e&&e.message)||e),'err'); wfEvtAttReset(wrap); }
  };
  function wfEvtAttReset(wrap){
    if(!wrap) return;
    wrap.innerHTML='<label class="wf-evt-attbox"><i class="fa-solid fa-paperclip"></i> Choose a file'
      +'<input type="file" class="wf-evt-attinput" onchange="wfEvtAttPick(this)"></label>'
      +'<input type="hidden" class="wf-evt-value" value="">';
  }
  window.wfEvtAttClear=function(btn){ wfEvtAttReset(btn.closest('.wf-evt-att')); };
  window.wfEvtAdd=function(){ const w=$('wfEvtDetails'); if(w){ w.insertAdjacentHTML('beforeend', wfEvtRowHtml('','')); const rows=w.querySelectorAll('.wf-evt-value'); const last=rows[rows.length-1]; if(last)try{last.focus();}catch(_){} } };
  window.wfEvtRemove=function(btn){ const r=btn.closest('.wf-evt-row'); if(r)r.remove(); };

  window.wfEventOpen=async function(flowId, caseId){
    wfInjectCss();
    if(!WF_PEOPLE){ try{ WF_PEOPLE=await people(); }catch(e){ WF_PEOPLE=[]; } }
    let flow=null, steps=[], caseRow=null;
    try{ const {data}=await ACC().from('flows').select('*').eq('id',flowId).maybeSingle(); flow=data; }catch(e){}
    try{ const {data}=await ACC().from('flow_steps').select('id').eq('flow_id',flowId); steps=data||[]; }catch(e){}
    if(caseId){ try{ const {data}=await ACC().from('flow_cases').select('*').eq('id',caseId).maybeSingle(); caseRow=data; }catch(e){} }
    if(!flow){ toast('Workflow not found','err'); return; }
    const N=wfNounOf(flow); window._wfNoun=N; window._wfIsBill=wfIsBillFlow(flow);
    if(!caseId && !steps.length){ toast('Add steps to this workflow before starting a '+N.lc,'warn'); return; }
    const editing=!!caseId;
    // Ensure this workflow has 3 detail fields relevant to its triggering event (analyzed by Claude).
    // Fetched once and cached into trigger_template so every instance uses the same fields.
    let tmpl=Array.isArray(flow.trigger_template)?flow.trigger_template:[];
    let usable=tmpl.map(function(t){return ((t&&t.label)||'').trim();}).filter(Boolean);
    if(!editing && usable.length<3 && (flow.trigger_event||'').trim()){
      try{
        const r=await fetch('https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/wf-suggest-fields',{method:'POST',headers:{'Content-Type':'application/json','apikey':'sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n'},body:JSON.stringify({trigger_event:flow.trigger_event, name:flow.name})});
        const d=await r.json();
        if(d&&Array.isArray(d.fields)&&d.fields.length){
          tmpl=d.fields.slice(0,3).map(function(l){return {label:l};});
          try{ await ACC().rpc('wf_set_template',{p_flow_id:flowId, p_fields:tmpl}); }catch(_e){}
        }
      }catch(_e){}
    }
    // Once the detail fields have been defined for this workflow (trigger_template is set), the field
    // LABELS are locked: they can't be edited, added or removed — you only fill in the values.
    let template=tmpl;
    let locked=template.length>0;
    // Every workflow gets an optional Attachment field by default, added lazily the first time
    // anyone opens "New <Noun>"/edits an instance for it (covers pre-existing workflows too,
    // without a one-off migration touching their data ahead of time).
    if(locked && !template.some(function(t){return eq((t&&t.label)||'','Attachment');})){
      template=template.concat([{label:'Attachment',type:'attachment',optional:true}]);
      try{ await ACC().rpc('wf_set_template',{p_flow_id:flowId, p_fields:template}); }catch(_e){}
    }
    let src;
    if(editing){
      const savedByLabel={}; (Array.isArray(caseRow&&caseRow.trigger_details)?caseRow.trigger_details:[]).forEach(function(d){ if(d&&d.label) savedByLabel[d.label]=d.value; });
      src=locked ? template.map(function(t){ return Object.assign({},t,{value:savedByLabel[(t&&t.label)||'']||''}); })
                 : (Array.isArray(caseRow&&caseRow.trigger_details)?caseRow.trigger_details:[]);
    }
    else if(locked){ src=template.map(function(t){ return Object.assign({},t,{value:''}); }); }
    else { src=[]; }
    const rowsHtml=(src.length?src.map(function(t){return wfEvtRowHtml(t, (t&&t.value)||'', locked);}):[wfEvtRowHtml('','',false)]).join('');
    openModal('<div class="modal-head"><h3><i class="fa-solid fa-bolt"></i> '+esc2(editing?('Edit '+N.one+' '+(caseRow?wfCaseNoText(caseRow):caseId)):('New '+N.one))+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
      +'<div class="modal-body wf-evt-form" data-flow="'+flowId+'" style="min-width:min(94vw,520px)">'
        +'<label class="wf-lbl" style="margin-top:0">Workflow</label><div class="wf-ro">'+esc2(flow.name||'')+'</div>'
        +'<label class="wf-lbl">Triggering event</label><div class="wf-ro"><i class="fa-solid fa-bolt" style="color:var(--brand)"></i> '+esc2(flow.trigger_event||'—')+'</div>'
        +'<label class="wf-lbl">Details '+tip(locked?'These detail fields are fixed for this workflow — just fill in the values. They cannot be renamed, added or deleted.':('Specifics for this '+N.lc+'. Add or remove detail fields as needed.'))+'</label>'
        +'<div id="wfEvtDetails">'+rowsHtml+'</div>'
        +(locked?'':'<div class="wf-addstep-ghost" onclick="wfEvtAdd()"><i class="fa-solid fa-plus"></i> Add detail</div>')
      +'</div>'
      +'<div class="modal-foot"><button class="ac-btn" onclick="closeModal()">Cancel</button><button class="ac-btn primary" onclick="wfEventSave('+flowId+','+(editing?caseId:'null')+')"><i class="fa-solid fa-'+(editing?'floppy-disk':'play')+'"></i> '+esc2(editing?'Save changes':('Create '+N.one))+'</button></div>','md');
    setTimeout(function(){ const f=document.querySelector('.wf-evt-form'); if(f){ f.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); wfEventSave(flowId, caseId||null); } }); const fv=f.querySelector('.wf-evt-value'); if(fv)try{fv.focus();}catch(_){} } },30);
  };

  window.wfEventSave=async function(flowId, caseId){
    const wrap=$('wfEvtDetails'); const details=[]; let missing='', badFormat='';
    if(wrap){ [].slice.call(wrap.querySelectorAll('.wf-evt-row')).forEach(function(r){
      const label=((r.querySelector('.wf-evt-label')||{}).value||'').trim();
      let value=((r.querySelector('.wf-evt-value')||{}).value||'').trim();
      if(!missing && label && !value && r.getAttribute('data-optional')!=='1') missing=label;
      // Unique bill Id is always "c" + exactly 4 digits (e.g. c2950) — normalize case, then check.
      // Only what's typed now is checked: invoices recorded before this rule existed hold ids in
      // the old style, and blocking those made every one of them impossible to edit at all, even
      // when the change was to a completely different field. An untouched value passes through.
      const orig=r.getAttribute('data-orig')||'';
      if(eq(label,'Unique bill Id') && value && value!==orig){
        if(!/^c\d{4}$/i.test(value)){ if(!badFormat) badFormat=value; }
        else value='c'+value.slice(1);
      }
      if(label||value) details.push({label:label,value:value});
    }); }
    if(missing){ toast('Please fill in "'+missing+'"','warn'); return; }
    if(badFormat){ toast('Unique bill Id should look like c2950 (c + 4 digits)','warn'); return; }
    const N=wfN();
    try{
      if(caseId){
        const {error}=await ACC().rpc('wf_update_instance',{p_case_id:caseId, p_details:details}); if(error)throw error;
        try{ closeModal(); }catch(e){}
        toast(N.one+' updated','ok');
        if(ROUTE&&ROUTE.tab==='workflow'){ renderPage(); } else { navTo('tasks/workflow/'+flowId); }
      } else {
        const {error}=await ACC().rpc('wf_create_instance',{p_flow_id:flowId, p_details:details}); if(error)throw error;
        try{ closeModal(); }catch(e){}
        toast(N.one+' created — first step assigned','ok');
        if(ROUTE&&ROUTE.tab==='workflow'){ renderPage(); } else { navTo('tasks/workflow/'+flowId); }
      }
    }catch(e){ toast('Could not save '+N.lc+': '+((e&&e.message)||e),'err'); }
  };


  // Attachments (Updates & Feedback, and the pinned original trigger-event Attachment) live in
  // S3 behind presigned URLs — an <img> can't just point at the s3: path, so image attachments
  // render as a placeholder with data-path and get their real src filled in by
  // wfHydrateAttThumbs() after the HTML lands in the DOM (same pattern used for Competitor Ads
  // thumbnails: sign once, cache, reuse).
  window._wfSignCache=window._wfSignCache||{};
  async function wfSignedUrl(path){
    if(!path) return null;
    if(window._wfSignCache[path]) return window._wfSignCache[path];
    const {data,error}=await s3Sign('get', path.slice(3));
    if(error||!data) return null;
    window._wfSignCache[path]=data.url;
    return data.url;
  }
  async function wfHydrateAttThumbs(){
    const els=[].slice.call(document.querySelectorAll('.wf-att-img[data-path]'));
    await Promise.all(els.map(async function(el){
      const path=el.getAttribute('data-path');
      const url=await wfSignedUrl(path);
      if(url && el.isConnected) el.src=url;
    }));
  }
  window.wfAttOpen=function(path,name){ s3OpenSigned(path,name||''); };
  function wfAttachmentHtml(a){
    const name=a.file_name||(a.storage_path||'').split('/').pop();
    const isImg=/\.(png|jpe?g|gif|webp|bmp)$/i.test(name||'');
    if(isImg){
      return '<span class="wf-att-thumb" onclick="event.stopPropagation();wfAttOpen(\''+esc2(a.storage_path)+'\',\''+esc2(name)+'\')" title="'+esc2(name)+'"><img class="wf-att-img" data-path="'+esc2(a.storage_path)+'" alt=""></span>';
    }
    return '<span class="wf-att-file" onclick="event.stopPropagation();wfAttOpen(\''+esc2(a.storage_path)+'\',\''+esc2(name)+'\')"><i class="fa-solid fa-file-arrow-down"></i> '+esc2(name)+'</span>';
  }
  function wfAttachmentsRowHtml(atts){
    if(!atts||!atts.length) return '';
    return '<div class="wf-att-row">'+atts.map(wfAttachmentHtml).join('')+'</div>';
  }
  // The case's own trigger-event Attachment field (if any) — a read-only "original attachment"
  // pinned above the Updates thread, distinct from anything added afterward in Updates & Feedback.
  function wfOriginalAttachmentHtml(c){
    const det=Array.isArray(c&&c.trigger_details)?c.trigger_details:[];
    const f=det.find(function(d){ return d&&eq(d.label,'Attachment')&&d.value; });
    if(!f) return '';
    return '<div class="wf-upd-pinned"><div class="wf-upd-pinned-lbl"><i class="fa-solid fa-thumbtack"></i> Original attachment</div>'+wfAttachmentHtml({storage_path:f.value})+'</div>';
  }

  function wfUpdateHtml(u,atts){
    const attHtml=wfAttachmentsRowHtml(atts);
    if(u.system){ return '<div class="wf-upd-sys"><i class="fa-solid fa-circle-info"></i> '+esc2(wfNm(u.author))+' '+esc2(u.body)+' · '+wfDT(u.created_at)+'</div>'; }
    const mine=eq(u.author,me());
    return '<div class="wf-upd'+(mine?' me':'')+'"><span class="wf-upd-av" style="background:'+colorFor(u.author)+'">'+esc2(iniOf(wfNm(u.author)).toUpperCase())+'</span><div class="wf-upd-b"><div class="wf-upd-meta"><b>'+esc2(wfNm(u.author))+'</b> · '+wfDT(u.created_at)+'</div>'+(u.body?('<div class="wf-upd-body">'+esc2(u.body)+'</div>'):'')+attHtml+'</div></div>';
  }

  /* ----- Workflow task detail (rendered from taskPage when a task is a workflow step) ----- */
  async function wfTaskPage(v, t, members, list, ro){
    wfInjectCss(); window._wfDelId=null; setCrumb(['Accountability','Workflow','Task']);
    if(!WF_PEOPLE){ try{ WF_PEOPLE=list||await people(); }catch(e){ WF_PEOPLE=list||[]; } }
    let fcs=null;
    try{ const {data}=await ACC().from('flow_case_steps').select('*').eq('id',t.flow_case_step_id).maybeSingle(); fcs=data; }catch(e){}
    if(!fcs){ v.innerHTML='<div class="tp-card"><div class="ac-empty" style="cursor:default;border:0">This workflow step no longer exists.</div></div>'; return; }
    let caseRow=null, flow=null, allSteps=[], updates=[];
    try{ const {data}=await ACC().from('flow_cases').select('*').eq('id',fcs.case_id).maybeSingle(); caseRow=data; }catch(e){}
    if(caseRow){ try{ const {data}=await ACC().from('flows').select('*').eq('id',caseRow.flow_id).maybeSingle(); flow=data; }catch(e){} }
    try{ const {data}=await ACC().from('flow_case_steps').select('*').eq('case_id',fcs.case_id).order('seq',{ascending:true}); allSteps=data||[]; }catch(e){}
    try{ const {data}=await ACC().from('flow_updates').select('*').eq('case_id',fcs.case_id).order('created_at',{ascending:true}); updates=data||[]; }catch(e){}
    let atts=[]; if(updates.length){ try{ const {data}=await ACC().from('flow_update_attachments').select('*').in('update_id',updates.map(function(u){return u.id;})); atts=data||[]; }catch(e){} }
    const attsByUpdate={}; atts.forEach(function(a){ (attsByUpdate[a.update_id]=attsByUpdate[a.update_id]||[]).push(a); });
    const idx=allSteps.findIndex(function(s){return s.id===fcs.id;});
    const isFirst=idx<=0, isLast=idx===(allSteps.length-1);
    const amAssignee=(members||[]).some(function(e){return eq(e,me());});
    const received=!!fcs.received_at, forwarded=!!fcs.forwarded_at;
    const caseActive=caseRow && caseRow.status!=='Done';
    let A='';
    if(forwarded){
      // This step is completed and sits in Completed This Week / Archive.
      if(caseRow && caseRow.status==='Done'){
        if(isLast && amAssignee) A='<button class="ac-btn" onclick="wfReopen('+fcs.id+')"><i class="fa-solid fa-rotate-left"></i> Reopen</button>';
        else A='<button class="ac-btn ok" disabled><i class="fa-solid fa-circle-check"></i> Completed</button>';
      } else if(amAssignee){
        A='<button class="ac-btn danger" onclick="wfRevert('+fcs.id+')"><i class="fa-solid fa-rotate-left"></i> Revert</button>';
      } else {
        A='<button class="ac-btn ok" disabled><i class="fa-solid fa-circle-check"></i> Completed</button>';
      }
    } else if(amAssignee && caseActive){
      if(!received){
        A='<button class="ac-btn primary" onclick="wfReceive('+fcs.id+')"><i class="fa-solid fa-inbox"></i> Receive</button>'
         +(isFirst?'':'<button class="ac-btn danger" onclick="wfRejectStart('+fcs.id+','+fcs.case_id+')"><i class="fa-solid fa-ban"></i> Reject</button>');
      } else {
        A='<button class="ac-btn" disabled><i class="fa-solid fa-check"></i> Received</button>';
        if(isLast) A+='<button class="ac-btn ok" onclick="wfDone('+fcs.id+')"><i class="fa-solid fa-flag-checkered"></i> Done</button>';
        else A+='<button class="ac-btn primary" onclick="wfForward('+fcs.id+')"><i class="fa-solid fa-paper-plane"></i> Forward</button>';
      }
    }
    const dueTxt=fcs.due_at?wfDT(fcs.due_at):(t.due_date?fmtDateY(t.due_date):'—');
    const statusChip=forwarded?'<span class="ac-chip ac-c-Completed">Completed</span>':'<span class="ac-chip ac-c-Pending">Pending</span>';
    let takenTxt='—'; if(fcs.received_at&&fcs.forwarded_at) takenTxt=wfHms(new Date(fcs.forwarded_at)-new Date(fcs.received_at)); else if(fcs.received_at) takenTxt='running · '+wfHms(Date.now()-new Date(fcs.received_at));
    const person=fcs.person;
    const wfDetailsArr=Array.isArray(caseRow&&caseRow.trigger_details)?caseRow.trigger_details:[];
    const wfInline=wfDetailsInline(wfDetailsArr);
    const wfInst=((flow&&(flow.trigger_event||flow.name))||'Workflow')+(caseRow?(' #'+wfCaseNoText(caseRow)):'');
    const wfStepName=wfTitleCase(fcs.title||'');
    const wfDescFmt=wfDetailsFmt(wfDetailsArr);
    v.innerHTML='<div class="wf-tp"><div class="tp-head"><div><div class="tp-title"><i class="fa-solid fa-diagram-project" style="color:#1d4ed8"></i> '+esc2([wfStepName,wfInline].filter(Boolean).join(' - ')||t.title)+'</div>'
      +'<div class="tp-sub">Step '+(idx+1)+' of '+allSteps.length+' · '+esc2(wfTitleCase(fcs.title||''))+'</div></div>'
      +'<div class="tp-acts"><button class="ac-btn ic" title="Back" onclick="navTo(\'tasks/work\')"><i class="fa-solid fa-arrow-left"></i></button>'
      +(caseRow?'<button class="ac-btn" title="View '+esc2(wfNounOf(flow).lc)+' timeline" onclick="navTo(\'tasks/workflow/case/'+caseRow.id+'\')"><i class="fa-solid fa-bars-progress"></i><span class="wf-btxt"> Timeline</span></button>':'')
      +A+'</div></div>'
      +'<div class="tp-card"><h3><i class="fa-solid fa-align-left" style="color:#64748b"></i> Description</h3><div class="tp-desc"><b>'+esc2(wfInst+' - '+wfStepName)+'</b>'+(wfDescFmt?'<div style="margin-top:8px;line-height:1.7">'+wfDescFmt+'</div>':'')+(fcs.description?'<div style="margin-top:6px;color:var(--slate)">'+esc2(wfTitleCase(fcs.description))+'</div>':'')+'</div></div>'
      +'<div class="tp-card"><h3><i class="fa-solid fa-circle-info" style="color:#64748b"></i> Details'+tip('Allotted is the time this step is meant to take. Time taken starts counting the moment the step reaches you and stops when you forward it.')+'</h3><div class="tp-grid">'
        +'<div class="tp-f"><div class="k">Due</div><div class="v">'+dueTxt+'</div></div>'
        +'<div class="tp-f"><div class="k">Owner</div><div class="v"><span class="wf-ownerchip"><i class="fa-solid fa-diagram-project"></i> WORKFLOW</span></div></div>'
        +'<div class="tp-f"><div class="k">Status</div><div class="v">'+statusChip+'</div></div>'
        +'<div class="tp-f"><div class="k">Assigned to</div><div class="v">'+(person?('<span class="wf-inline-who"><span class="wf-av" style="background:'+colorFor(person)+'">'+esc2(iniOf(wfNm(person)).toUpperCase())+'</span>'+esc2(wfNm(person))+'</span>'):'—')+'</div></div>'
        +'<div class="tp-f"><div class="k">Allotted</div><div class="v">'+esc2(wfDurText(fcs.duration_value,fcs.duration_unit)||'—')+'</div></div>'
        +'<div class="tp-f"><div class="k">Time taken</div><div class="v">'+takenTxt+'</div></div>'
      +'</div></div>'
      +'<div class="tp-card" id="wfUpdCard"><h3><i class="fa-solid fa-comments" style="color:#16a34a"></i> Updates &amp; Feedback'+tip('Everything posted here is visible to EVERYONE in this workflow — there are no private notes. Whatever you write stays with the '+wfNounOf(flow).lc+' as it moves to the next person, and rejection reasons appear here too.')+'</h3>'
        +wfOriginalAttachmentHtml(caseRow)
        +'<div class="wf-updlist" id="wfUpdList">'+(updates.length?updates.map(function(u){return wfUpdateHtml(u,attsByUpdate[u.id]);}).join(''):'<div class="ac-empty" style="cursor:default;border:0">No updates yet</div>')+'</div>'
        +'<div id="wfRejectBar" class="wf-reject-bar" style="display:none"><span><i class="fa-solid fa-ban"></i> Rejecting this step — add a reason below (optional), then:</span><span class="wf-reject-acts"><button class="ac-btn danger" onclick="wfDoReject('+fcs.id+','+fcs.case_id+')">Confirm rejection</button><button class="ac-btn" onclick="wfRejectCancel()">Cancel</button></span></div>'
        +'<div class="wf-updbar"><input class="ac-in" id="wfUpdIn" placeholder="Write an update…" onkeydown="if(event.key===\'Enter\'){event.preventDefault();wfPostUpdate('+fcs.case_id+');}"><label class="ac-btn ic" title="Attach files" id="wfUpdFileLbl"><i class="fa-solid fa-paperclip"></i><input type="file" id="wfUpdFile" multiple style="display:none" onchange="wfUpdFilePicked(this)"></label><button class="ac-btn primary ic" onclick="wfPostUpdate('+fcs.case_id+')"><i class="fa-solid fa-paper-plane"></i></button></div>'
        +'<div id="wfUpdFileList" class="wf-updfile-list"></div>'
      +'</div></div>';
    wfHydrateAttThumbs();
    if(window._wfAutoReject && window._wfAutoReject===fcs.id){ window._wfAutoReject=null; setTimeout(function(){ wfRejectStart(fcs.id, fcs.case_id); },60); }
  }

  // In-app confirm (no browser dialog, no keyboard shortcuts). opts:{title,body,okLabel,okClass,withNote,notePlaceholder,onOk(note)}
  function wfConfirm(opts){
    opts=opts||{};
    openModal('<div class="modal-head"><h3>'+esc2(opts.title||'Please confirm')+'</h3><span class="x" data-wfx>&times;</span></div>'
      +'<div class="modal-body" style="min-width:min(92vw,430px)">'
        +(opts.body?('<p style="margin:0 0 12px;color:var(--slate);font-size:13.5px;line-height:1.55">'+esc2(opts.body)+'</p>'):'')
        +(opts.withNote?('<label class="wf-lbl" style="margin-top:0"><i class="fa-solid fa-comments"></i> Updates &amp; Feedback</label><textarea id="wfConfirmNote" class="ac-in" rows="3" placeholder="'+esc2(opts.notePlaceholder||'Add a note (optional)')+'" style="resize:vertical;width:100%;box-sizing:border-box"></textarea>'):'')
      +'</div>'
      +'<div class="modal-foot"><button class="ac-btn" data-wfx>Cancel</button><button class="ac-btn '+(opts.okClass||'primary')+'" id="wfConfirmOk">'+esc2(opts.okLabel||'Confirm')+'</button></div>','md');
    setTimeout(function(){
      var ok=document.getElementById('wfConfirmOk');
      if(ok){ ok.onclick=function(){ var note=((document.getElementById('wfConfirmNote')||{}).value||'').trim(); closeModal(); if(opts.onOk) opts.onOk(note); }; }
      [].slice.call(document.querySelectorAll('[data-wfx]')).forEach(function(x){ x.onclick=function(){ closeModal(); if(opts.onCancel) opts.onCancel(); }; });
      if(opts.withNote){ var n=document.getElementById('wfConfirmNote'); if(n){ try{n.focus();}catch(_){} } }
    },30);
  }

  // Ticking the left checkbox of a Workflow task = Forward (not the normal Done/approval flow)
  window.wfRowForward=function(fcsId, cb){
    if(cb) cb.disabled=true;
    wfConfirm({ title:'Forward this step?', body:'This completes your step and passes the workflow to the next person.', okLabel:'Forward', okClass:'primary',
      onOk:async function(){
        try{ const {error}=await ACC().rpc('wf_forward',{p_fcs_id:fcsId}); if(error)throw error; }
        catch(e){ toast('Could not forward: '+((e&&e.message)||e),'err'); if(cb){cb.disabled=false;cb.checked=false;} return; }
        toast('Forwarded to the next person','ok'); renderPage();
      },
      onCancel:function(){ if(cb){cb.disabled=false;cb.checked=false;} }
    });
  };

  window.wfReceive=async function(fcsId){
    try{ const {error}=await ACC().rpc('wf_receive',{p_fcs_id:fcsId}); if(error)throw error; }
    catch(e){ toast('Could not receive: '+((e&&e.message)||e),'err'); return; }
    toast('Received — timer started','ok'); renderPage();
  };

  window.wfForward=async function(fcsId){
    try{ const {error}=await ACC().rpc('wf_forward',{p_fcs_id:fcsId}); if(error)throw error; }
    catch(e){ toast('Could not forward: '+((e&&e.message)||e),'err'); return; }
    toast('Forwarded to the next person','ok'); navTo('tasks/work');
  };

  window.wfDone=async function(fcsId){
    try{ const {error}=await ACC().rpc('wf_done',{p_fcs_id:fcsId}); if(error)throw error; }
    catch(e){ toast('Could not complete: '+((e&&e.message)||e),'err'); return; }
    toast('Workflow completed','ok'); navTo('tasks/work');
  };

  // Reject: an in-app note (Updates & Feedback) then bounce to the previous person
  // Reject flows through the Updates & Feedback section (no popup): scroll there, reveal the confirm bar.
  // Reject now asks for confirmation in a popup (no jumping to Updates & Feedback).
  window.wfRejectStart=function(fcsId, caseId){
    wfConfirm({ title:'Reject this step?', body:'This sends the task back to the previous person.', okLabel:'Reject', okClass:'danger', onOk:async function(){
      try{ const {error}=await ACC().rpc('wf_reject',{p_fcs_id:fcsId}); if(error)throw error; }
      catch(e){ toast('Could not reject: '+((e&&e.message)||e),'err'); return; }
      toast('Step rejected — sent back to the previous person','ok'); navTo('tasks/work');
    }});
  };
  window.wfRejectCancel=function(){ const bar=$('wfRejectBar'); if(bar) bar.style.display='none'; };
  // From a task-list row: same confirmation popup, no navigation needed.
  window.wfRowReject=function(fcsId, caseId, taskId){ wfRejectStart(fcsId, caseId); };
  window.wfDoReject=async function(fcsId, caseId){
    try{ const {error}=await ACC().rpc('wf_reject',{p_fcs_id:fcsId}); if(error)throw error; }
    catch(e){ toast('Could not reject: '+((e&&e.message)||e),'err'); return; }
    toast('Step rejected — sent back to the previous person','ok'); navTo('tasks/work');
  };

  // Revert: pull the flow back to me from whoever currently holds it
  window.wfRevert=function(fcsId){
    wfConfirm({ title:'Revert this step?', body:'The task will be pulled back to you from whoever currently has it, and any steps after yours will be cleared.', okLabel:'Revert', okClass:'danger', onOk:async function(){
      try{ const {error}=await ACC().rpc('wf_revert',{p_fcs_id:fcsId}); if(error)throw error; }
      catch(e){ toast('Could not revert: '+((e&&e.message)||e),'err'); return; }
      toast('Reverted — the task is back with you','ok');
      if(ROUTE&&ROUTE.tab==='workflow'){ renderPage(); } else { navTo('tasks/work'); }
    }});
  };

  // Reopen: bring the completed final step back (instance Done -> In progress)
  window.wfReopen=function(fcsId){
    wfConfirm({ title:'Reopen this workflow?', body:'The final step comes back to you and this '+wfN().lc+' moves from Done back to In progress.', okLabel:'Reopen', okClass:'primary', onOk:async function(){
      try{ const {error}=await ACC().rpc('wf_reopen',{p_fcs_id:fcsId}); if(error)throw error; }
      catch(e){ toast('Could not reopen: '+((e&&e.message)||e),'err'); return; }
      toast('Reopened','ok'); navTo('tasks/work');
    }});
  };

  window.wfUpdFilePicked=function(input){
    const list=$('wfUpdFileList'); if(!list)return;
    const files=input.files?[].slice.call(input.files):[];
    list.innerHTML=files.length?('<i class="fa-solid fa-paperclip"></i> '+files.map(function(f){return esc2(f.name);}).join(', ')):'';
  };
  window.wfPostUpdate=async function(caseId){
    const inp=$('wfUpdIn'); const body=(inp&&inp.value||'').trim();
    const fileInput=$('wfUpdFile'); const files=(fileInput&&fileInput.files)?[].slice.call(fileInput.files):[];
    if(!body && !files.length) return;
    let updateId=null;
    try{ const {data,error}=await ACC().rpc('wf_post_update',{p_case_id:caseId, p_body:body}); if(error)throw error; updateId=data; }
    catch(e){ toast('Could not post update: '+((e&&e.message)||e),'err'); return; }
    for(const file of files){
      try{
        const key=s3KeyForFlowUpdate(caseId, file.name);
        const {data:up,error:upErr}=await uploadFileToS3(key,file);
        if(upErr) throw upErr;
        const {error:insErr}=await ACC().from('flow_update_attachments').insert({update_id:updateId, storage_path:up.path, file_name:file.name});
        if(insErr) throw insErr;
      }catch(e){ toast('Attachment "'+file.name+'" failed: '+((e&&e.message)||e),'err'); }
    }
    if(inp)inp.value=''; if(fileInput)fileInput.value=''; renderPage();
  };

  function wfInjectCss(){
    if(document.getElementById('wfCss')) return;
    const s=document.createElement('style'); s.id='wfCss';
    s.textContent=`
    .wf-page{width:100%}
    .wf-page-head{display:flex;align-items:center;gap:10px;margin:0 0 14px;flex-wrap:wrap}
    .wf-page-head h1{font-size:18px;font-weight:700;color:var(--ink);margin:0;display:flex;align-items:center;gap:9px;flex:1;min-width:0;letter-spacing:-.01em}
    .wf-page-head h1 i{color:var(--brand);font-size:16px}
    .wf-head-acts{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
    .wf-card{background:var(--bg-card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:12px}
    .wf-card.wf-meta{padding:14px 18px}
    .wf-card.wf-tlcard{padding:16px 18px}
    .wf-card-hd{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px;color:var(--ink);margin-bottom:12px;text-transform:uppercase;letter-spacing:.03em}
    .wf-card-hd i{color:var(--slate);font-size:13px}
    .wf-card-hd .cnt{background:var(--brand-a10,#eef2ff);color:var(--brand);border-radius:20px;padding:1px 9px;font-size:11.5px}
    .wf-inst-filterbar{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px;padding:12px;background:var(--bg,#f8fafc);border:1px solid var(--line);border-radius:10px}
    .wf-inst-filter-search{position:relative;flex:1;min-width:180px}
    .wf-inst-filter-search i{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--slate);font-size:12px;pointer-events:none}
    .wf-inst-filter-search .ac-in{width:100%;padding-left:30px;box-sizing:border-box}
    .wf-inst-filter-dates{display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap}
    .wf-inst-filterbar .wf-lbl{font-size:11px;font-weight:600;color:var(--slate);text-transform:uppercase;letter-spacing:.03em;display:flex;flex-direction:column;gap:5px;margin:0}
    .wf-inst-filterbar .wf-lbl .ac-in{min-width:140px}
    .wf-daterange-sep{color:var(--slate);font-size:12px;margin:0 -2px 9px}
    .wf-inst-filter-dates .ac-btn.primary{height:38px}
    .wf-card-hint{font-weight:500;text-transform:none;letter-spacing:0;color:var(--slate);font-size:12px}
    /* list header + full-width rows */
    /* Workflow task Details: always two columns of three, never one long list */
    .wf-tp .tp-grid{grid-template-columns:1fr 1fr;gap:12px 22px}
    .wf-tp .tp-f{min-width:0}
    .wf-tp .tp-f .v{overflow-wrap:anywhere}
    .wf-listhead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap}
    .wf-listhead-t{font-size:15px;font-weight:700;color:var(--ink);display:flex;align-items:center;gap:9px}
    .wf-listhead-t i{color:var(--brand)}
    .wf-list{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--bg-card)}
    .wf-lrow{display:flex;align-items:center;gap:14px;padding:14px 16px;cursor:pointer;border-left:3px solid transparent;border-bottom:1px solid var(--line);transition:background .13s,border-color .13s}
    .wf-lrow:last-child{border-bottom:0}
    .wf-lrow:hover{background:var(--brand-a10,#eef2ff);border-left-color:var(--brand)}
    .wf-lrow-main{flex:1;min-width:0}
    .wf-lrow-name{font-weight:650;font-size:14.5px;color:var(--ink);line-height:1.35;overflow:hidden;text-overflow:ellipsis}
    .wf-lrow-trig{font-size:12.5px;color:var(--slate);display:flex;align-items:center;gap:6px;margin-top:3px}
    .wf-lrow-trig i{color:var(--brand);font-size:11px}
    .wf-lrow-right{display:flex;align-items:center;gap:14px;flex:none}
    .wf-lrow-steps{font-size:12px;font-weight:600;color:var(--slate);background:var(--bg,#f8fafc);border:1px solid var(--line);border-radius:20px;padding:3px 11px;white-space:nowrap}
    .wf-go{color:#cbd5e1;font-size:13px}
    .wf-circles{display:inline-flex;align-items:center}
    .wf-circle{width:28px;height:28px;border-radius:50%;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid var(--bg-card);margin-left:-7px}
    .wf-circle:first-child{margin-left:0}
    .wf-circle.wf-more{background:#94a3b8}
    .wf-circle.wf-none{background:#eef2f6;color:#94a3b8;border-style:dashed}
    /* meta card */
    .wf-desc{color:var(--slate);font-size:13.5px;margin-bottom:12px;line-height:1.6}
    .wf-trig-box{background:linear-gradient(0deg,var(--brand-a10,#eef2ff),var(--brand-a10,#eef2ff));border:1px solid var(--line);border-left:3px solid var(--brand);border-radius:8px;padding:10px 13px;font-size:13px;color:var(--ink)}
    .wf-trig-box i{color:var(--brand)}
    .wf-members-row{display:flex;align-items:center;gap:10px;margin:12px 0 0}
    .wf-mini-lbl{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--slate)}
    /* timeline panel */
    .wf-tlhead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--line)}
    .wf-tlhead-t{font-size:13px;font-weight:700;color:var(--ink);text-transform:uppercase;letter-spacing:.03em;display:flex;align-items:center;gap:8px}
    .wf-tlhead-t i{color:var(--slate)}
    .wf-tlhead-x{border:1px solid var(--line);background:var(--bg-card);color:var(--slate);width:28px;height:28px;border-radius:8px;cursor:pointer;font-size:12px}
    .wf-tlhead-x:hover{border-color:var(--brand);color:var(--brand)}
    .wf-timeline{display:flex;flex-direction:column}
    /* Slim timeline row: one line on a normal screen, wrapping to two on a phone. */
    .wf-tl-item{display:flex;gap:12px;padding-bottom:10px;position:relative}
    .wf-tl-item:last-child{padding-bottom:0}
    .wf-tl-item:not(:last-child)::before{content:'';position:absolute;left:12px;top:26px;bottom:0;width:2px;background:var(--line)}
    .wf-tl-done:not(:last-child)::before{background:#bbf7d0}
    .wf-tl-num{flex:0 0 26px;height:26px;border-radius:50%;background:#cbd5e1;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;z-index:1;margin-top:5px}
    .wf-tl-cur .wf-tl-num{background:var(--brand);box-shadow:0 0 0 4px var(--brand-a10,#eef2ff)}
    .wf-tl-done .wf-tl-num{background:#16a34a}
    .wf-tl-wait .wf-tl-num{background:#cbd5e1}
    /* line 1 = what + who, line 2 = the timestamps on their own rule, so a fully-stamped
       step reads as two calm rows instead of one crowded one */
    .wf-tl-body{flex:1;min-width:0;background:var(--bg,#f8fafc);border:1px solid var(--line);border-radius:10px;padding:9px 15px;display:flex;flex-direction:column;gap:7px}
    .wf-tl-row{display:flex;align-items:center;justify-content:space-between;gap:6px 24px;flex-wrap:wrap;min-width:0}
    .wf-tl-times{display:flex;align-items:center;gap:8px 18px;flex-wrap:wrap;min-width:0;padding-top:7px;border-top:1px dashed var(--line)}
    .wf-tl-times:empty{display:none}
    .wf-tl-cur .wf-tl-body{background:var(--brand-a10,#eef2ff);border-color:var(--brand)}
    .wf-tl-cur .wf-tl-times{border-top-color:#c7d2fe}
    .wf-tl-title{font-weight:650;font-size:13.5px;color:var(--ink);display:flex;align-items:center;flex-wrap:wrap;gap:8px;flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
    .wf-tl-desc{font-size:12.5px;color:var(--slate);margin-top:4px;line-height:1.5}
    .wf-tl-meta{display:flex;align-items:center;gap:6px 14px;flex-wrap:wrap;min-width:0;flex:0 1 auto}
    .wf-tl-when{font-size:11.5px;color:var(--slate);display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
    .wf-tl-when b{font-weight:700;color:var(--ink);font-size:10.5px;text-transform:uppercase;letter-spacing:.03em}
    .wf-tl-when.done b{color:#16a34a}
    .wf-who{display:inline-flex;align-items:center;min-width:0;max-width:100%}
    .wf-av{width:22px;height:22px;border-radius:50%;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:700;margin-right:7px;flex:none}
    .wf-who-nm{font-size:12.5px;color:var(--ink);font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .wf-dept{font-size:11.5px;color:var(--slate);margin-left:8px}
    .wf-dur{font-size:12.5px;color:var(--slate);display:inline-flex;align-items:center;gap:6px}
    .wf-badge{font-size:10.5px;font-weight:700;padding:2px 9px;border-radius:20px;text-transform:none;letter-spacing:0}
    .wf-badge.ok{background:#dcfce7;color:#166534}.wf-badge.cur{background:#dbeafe;color:#1e40af}.wf-badge.wait{background:#eef2f6;color:#94a3b8}
    .wf-tl-track{font-size:11.5px;color:var(--slate);margin-top:7px;padding-top:7px;border-top:1px dashed var(--line)}
    /* form */
    .wf-ro{background:var(--bg,#f8fafc);border:1px solid var(--line);border-radius:9px;padding:10px 12px;font-size:14px;color:var(--ink)}
    .wf-addstep-ghost{display:flex;align-items:center;justify-content:center;gap:8px;padding:11px 12px;border:1px dashed var(--line);border-radius:10px;color:var(--slate);font-size:13px;font-weight:600;cursor:pointer;margin-top:8px;transition:.15s}
    .wf-addstep-ghost:hover{border-color:var(--brand);color:var(--brand);background:var(--brand-a10,#eef2ff)}
    .wf-keyhint{font-size:11.5px;color:var(--slate);text-align:right;margin-top:12px}
    .wf-evt-row{display:flex;gap:8px;margin-bottom:8px}
    .wf-evt-row .wf-evt-label{flex:0 0 40%;min-width:0}
    .wf-evt-row .wf-evt-value{flex:1;min-width:0}
    /* Dropdowns in this form matched the plain text inputs, so a field with a list looked no
       different from one you type into. Now they carry their own caret and hover/focus states. */
    .wf-evt-row select.wf-evt-value{appearance:none;-webkit-appearance:none;-moz-appearance:none;
      height:40px;padding:0 34px 0 12px;cursor:pointer;font-weight:500;
      background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23e0121c' stroke-width='2' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      background-repeat:no-repeat;background-position:right 12px center;background-size:11px 8px;
      transition:border-color .12s,box-shadow .12s}
    .wf-evt-row select.wf-evt-value:hover{border-color:var(--slate)}
    .wf-evt-row select.wf-evt-value:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10,rgba(224,18,28,.12))}
    .wf-evt-row select.wf-evt-value optgroup{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--slate)}
    .wf-evt-row select.wf-evt-value option{font-size:13.5px;font-weight:400;text-transform:none;letter-spacing:0;color:var(--ink);padding:6px 8px}
    /* File picker: the browser's raw "Choose File" control replaced by a proper dashed drop box
       with the real input laid invisibly over it, so it still works with one click. */
    .wf-evt-att{flex:1;min-width:0;display:flex;align-items:center}
    .wf-evt-attbox{position:relative;flex:1;min-width:0;display:flex;align-items:center;justify-content:center;gap:8px;
      height:40px;border:1.5px dashed var(--line);border-radius:9px;background:var(--bg,#f8fafc);
      color:var(--slate);font-size:12.5px;font-weight:600;cursor:pointer;transition:border-color .12s,color .12s,background .12s}
    .wf-evt-attbox:hover{border-color:var(--brand);color:var(--brand);background:var(--brand-a10,rgba(224,18,28,.06))}
    .wf-evt-attbox i{font-size:12px}
    .wf-evt-att .wf-evt-attinput{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}
    .wf-evt-attbox.busy{opacity:.6;pointer-events:none}
    .wf-evt-att-name{display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--ink);background:var(--bg,#f8fafc);border:1px solid var(--line);border-radius:9px;padding:8px 12px;width:100%}
    /* instances table */
    .wf-tablewrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:10px}
    .wf-itable{width:100%;border-collapse:collapse;font-size:13px;min-width:560px}
    .wf-itable th{text-align:left;padding:11px 14px;background:var(--bg,#f8fafc);color:var(--slate);font-weight:700;font-size:11px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;border-bottom:1px solid var(--line)}
    .wf-itable td{padding:11px 14px;border-bottom:1px solid var(--line);white-space:nowrap;color:var(--ink)}
    .wf-itable tbody tr{cursor:pointer;transition:background .12s;border-left:3px solid transparent}
    .wf-itable tbody tr:hover{background:var(--bg,#f8fafc)}
    .wf-itable tbody tr.sel{background:var(--brand-a10,#eef2ff)}
    .wf-itable tbody tr.sel td:first-child{box-shadow:inset 3px 0 0 var(--brand)}
    .wf-itable tbody tr:last-child td{border-bottom:0}
    .wf-trigcell{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px}
    /* Tracker tab — the strip needs real air above it, otherwise it reads as part of the
       timeline card that sits directly above. */
    .wf-tabs{display:flex;gap:4px;margin:26px 0 14px;padding:4px;background:var(--bg-subtle,#f1f5f9);border-radius:11px;overflow-x:auto}
    .wf-tab{flex:none;display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 16px;border:0;border-radius:8px;background:transparent;color:var(--slate);font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;white-space:nowrap;transition:background .14s,color .14s,box-shadow .14s}
    .wf-tab i{font-size:12px}
    .wf-tab:hover{color:var(--ink)}
    .wf-tab.on{background:var(--bg-card,#fff);color:var(--brand);box-shadow:0 1px 3px rgba(15,23,42,.12)}
    .wf-tk-wrap{max-height:72vh;overflow:auto;border-radius:10px}
    .wf-tktable{min-width:100%;font-size:12px}
    .wf-tktable th,.wf-tktable td{padding:8px 11px;white-space:nowrap;border-right:1px solid var(--line)}
    .wf-tktable tbody tr{cursor:default}
    .wf-tktable tbody tr:nth-child(even){background:var(--bg-subtle,#fafbfc)}
    .wf-tktable tbody tr:hover{background:var(--brand-a10,#eef2ff)}
    /* Each step's three columns are banded together with a heavier divider, so at a glance you
       can see where one step ends and the next begins across a very wide table. */
    .wf-tktable th.wf-tk-gap,.wf-tktable td.wf-tk-gap{border-left:2px solid var(--line)}
    /* The step bands read across, so they get a centred, sentence-case look of their own rather
       than the uppercase column-header styling. */
    .wf-tk-code th{text-align:center;background:var(--brand);color:#fff;font-size:11px;font-weight:700;letter-spacing:.08em;padding-top:6px;padding-bottom:6px}
    .wf-tk-code th.wf-tk-nocode{background:var(--bg-subtle,#f8fafc)}
    .wf-tk-band th{text-align:center;text-transform:none;letter-spacing:0;font-weight:600;font-size:11px;color:var(--slate);
      max-width:260px;white-space:normal;line-height:1.45;vertical-align:middle}
    .wf-tk-band th[colspan]{padding-left:12px;padding-right:12px}
    .wf-tk-bandlbl{text-align:left !important;color:var(--ink) !important;font-weight:800 !important;letter-spacing:.06em !important;text-transform:uppercase !important;white-space:nowrap !important;font-size:10.5px !important}
    .wf-tk-cols th{border-bottom:2px solid var(--line);font-size:10.5px}
    .wf-tk-late{color:#dc2626;font-weight:700}
    @media(max-width:760px){
      .wf-tabs{margin-top:20px}
      .wf-tab{padding:0 12px;font-size:12.5px}
      .wf-tktable th,.wf-tktable td{padding:7px 8px}
    }
    /* the per-row top offset is measured and written in by wfTrackerSticky() */
    .wf-tktable thead th{position:sticky;top:0;z-index:2;background:var(--bg-subtle,#f8fafc)}
    .wf-pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap}
    .wf-pill.ok{background:#dcfce7;color:#166534}
    .wf-pill.cur{background:#dbeafe;color:#1e40af}
    .wf-pill.wait{background:#f1f5f9;color:#cbd5e1;padding:3px 12px}
    .wf-pill.wt{background:#fef3c7;color:#92400e}
    .wf-upd-sys{text-align:center;font-size:12px;color:var(--slate);margin:2px 0;padding:4px 8px}
    .wf-upd-sys i{opacity:.6;margin-right:4px}
    .wf-inst-tools{margin-left:auto;display:flex;gap:6px}
    .wf-chk-col{width:36px;text-align:center;white-space:nowrap}
    .wf-inst-chk{width:16px;height:16px;cursor:pointer;accent-color:var(--brand)}
    .wf-owner-pick{display:flex;gap:8px;align-items:center}
    .wf-owner-pick .wf-pp{flex:1;min-width:0}
    .wf-cell{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600}
    .wf-cell.ok{color:#16a34a}.wf-cell.cur{color:var(--brand)}.wf-cell.wait{color:#cbd5e1}
    /* trigger details list */
    .wf-detlist{margin:12px 0 0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}
    .wf-detlist li{font-size:13px;color:var(--ink);background:var(--bg,#f8fafc);border:1px solid var(--line);border-radius:8px;padding:8px 11px;line-height:1.45}
    .wf-detk{font-weight:700;color:var(--slate);display:block;font-size:11px;text-transform:uppercase;letter-spacing:.03em;margin-bottom:1px}
    /* task page bits */
    .wf-ownerchip{display:inline-flex;align-items:center;gap:6px;background:#1d4ed8;color:#fff;font-size:11px;font-weight:800;letter-spacing:.04em;padding:3px 10px;border-radius:20px}
    .wf-inline-who{display:inline-flex;align-items:center;gap:7px}
    /* Roughly five messages tall, then it scrolls — the card never keeps growing. */
    .wf-updlist{display:flex;flex-direction:column;gap:12px;max-height:min(330px,48vh);overflow-y:auto;overscroll-behavior:auto;margin-bottom:12px;padding-right:4px}
    .wf-upd{display:flex;gap:10px;align-items:flex-start}
    .wf-upd.me{flex-direction:row-reverse}
    .wf-upd-av{width:30px;height:30px;border-radius:50%;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex:none}
    .wf-upd-b{background:var(--bg,#f8fafc);border:1px solid var(--line);border-radius:12px;padding:8px 12px;max-width:78%}
    .wf-upd.me .wf-upd-b{background:var(--brand-a10,#eef2ff)}
    .wf-upd-meta{font-size:11px;color:var(--slate);margin-bottom:2px}
    .wf-upd-body{font-size:13.5px;color:var(--ink);line-height:1.5;white-space:pre-wrap;word-break:break-word}
    .wf-att-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
    .wf-att-thumb{display:inline-block;width:64px;height:64px;border-radius:8px;overflow:hidden;border:1px solid var(--line);cursor:pointer;background:var(--bg,#f1f5f9)}
    .wf-att-img{width:100%;height:100%;object-fit:cover;display:block}
    .wf-att-file{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--brand);background:var(--brand-a10,#eef2ff);border-radius:8px;padding:6px 10px;cursor:pointer}
    .wf-upd-pinned{background:var(--bg,#f8fafc);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:12px}
    .wf-upd-pinned-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--slate);margin-bottom:6px;display:flex;align-items:center;gap:6px}
    .wf-updfile-list{font-size:12px;color:var(--slate);margin-top:6px}
    .wf-updbar{display:flex;gap:8px;align-items:center}
    .wf-updbar .ac-in{flex:1}
    .wf-reject-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:9px;padding:9px 12px;font-size:12.5px;font-weight:600;margin-bottom:10px}
    .wf-reject-acts{display:flex;gap:7px;flex:none}
    .wf-updmini{margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}
    .wf-updmini-h{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--slate);margin-bottom:10px;display:flex;align-items:center;gap:7px}
    .wf-updmini-list{display:flex;flex-direction:column;gap:12px;max-height:min(330px,48vh);overflow-y:auto;overscroll-behavior:auto;padding-right:4px}
    /* thin, unobtrusive scrollbars on the message lists */
    .wf-updlist,.wf-updmini-list{scrollbar-width:thin;scrollbar-color:var(--line) transparent}
    .wf-updlist::-webkit-scrollbar,.wf-updmini-list::-webkit-scrollbar{width:6px}
    .wf-updlist::-webkit-scrollbar-thumb,.wf-updmini-list::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}
    @media(max-width:640px){
      .wf-page-head h1{font-size:16px;flex:1 1 100%;order:2}
      .wf-page-head .ac-btn.ic:first-child{order:1}
      /* header buttons: wrap onto their own line and keep a readable width instead of
         being squeezed into three slivers */
      .wf-head-acts{order:3;flex:1 1 100%;gap:8px}
      .wf-head-acts .ac-btn{flex:1 1 auto;min-width:104px;justify-content:center}
      .wf-btxt{display:inline}
      .wf-card{padding:14px}
      /* workflow list: name/trigger on one line, people + step count underneath */
      .wf-lrow{flex-wrap:wrap;padding:13px 14px;gap:9px}
      .wf-lrow-main{flex:1 1 100%}
      .wf-lrow-right{flex:1 1 100%;justify-content:flex-start;gap:10px}
      .wf-lrow-right .wf-go{margin-left:auto}
      .wf-tl-body{padding:8px 12px;gap:5px 14px}
      .wf-tl-body .wf-who-nm{max-width:46vw}
      .wf-upd-b{max-width:82%}
      .wf-detlist{grid-template-columns:1fr}
      .wf-tp .tp-head{flex-wrap:wrap;gap:10px}
      .wf-tp .tp-acts{flex-wrap:wrap;width:100%}
      .wf-tp .tp-acts .ac-btn{flex:1 1 auto;justify-content:center}
      .wf-tp .wf-updbar .ac-in{min-width:0}
    }
    `;
    document.head.appendChild(s);
  }

  /* ---------- SCOREBOARD ---------- */
  async function scoreboardTab(){ const b=$('acBody'); let rows=[]; try{const {data}=await ACC().rpc('scoreboard');rows=data||[];}catch(e){} const medal=i=>i===0?'🥇':i===1?'🥈':i===2?'🥉':'<b style="color:var(--slate)">'+(i+1)+'</b>';
    rows=rows.map(r=>Object.assign({},r,{score:(r.tasks_completed||0)*1+(r.tasks_on_time||0)*1-(r.tasks_late||0)*1})).sort((a,b)=>b.score-a.score);
    b.innerHTML=`<div class="tp-card" style="padding:0"><div style="padding:14px 16px;border-bottom:1px solid var(--line)"><b>Scoreboard</b><div style="font-size:12px;color:var(--slate)">task completed +1 · on-time +1 · overdue −1 (declines automatically reverse the credit)</div></div><div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr><th>#</th><th>Person</th><th>Tasks</th><th>Sub</th><th>On-time</th><th>Overdue</th><th>Score</th></tr></thead><tbody>${rows.length?rows.map((r,i)=>`<tr><td>${medal(i)}</td><td><b>${esc2(r.full_name||r.email)}</b></td><td>${r.tasks_completed}</td><td>${r.checklist_items_done}</td><td style="color:#16a34a">${r.tasks_on_time}</td><td style="color:#dc2626">${r.tasks_late}</td><td style="font-weight:800">${r.score}</td></tr>`).join(''):'<tr><td colspan="7"><div class="ac-empty" style="cursor:default;border:0">No activity yet</div></td></tr>'}</tbody></table></div></div>`; }

  /* ---------- CALENDAR (Google-Calendar-inspired UI) ---------- */
  let GCAL_VIEW='month', GCAL_DATE=null, GCAL_MINI_MONTH=null, GCAL_Q='';
  let GCAL_FILTERS=new Set(['toMe','byMe','meeting','case']);
  let GCAL_LAST=null; // {byDate,list,asg}
  let GCAL_CASES=[]; // Legal cases with an upcoming Next Date — only ever populated for users with 'legal' module access
  // Legal Next Dates ride the same Calendar as tasks/meetings, but visibility is permission-based
  // (module access), not participation-based like tasks/meetings — not everyone who can see the
  // Calendar has Legal access, so this must be checked before ever querying mis_cases.
  function gcalCanSeeCases(){ return !!(state && (state.super || (state.roles && Array.isArray(state.roles.modules) && state.roles.modules.includes('legal')))); }
  async function gcalCasesLoadData(){
    if(!gcalCanSeeCases()){ GCAL_CASES=[]; return GCAL_CASES; }
    try{
      const {data}=await sb.from('mis_cases').select('id,case_type,cause_title,case_no,priority,next_date_iso,court').gte('next_date_iso',todayISO());
      GCAL_CASES=(data||[]).filter(function(c){return !!c.next_date_iso;}).map(function(c){ c.title=c.cause_title||c.case_no||('Case #'+c.id); return c; });
    }catch(e){ GCAL_CASES=[]; }
    return GCAL_CASES;
  }
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
    const [list,{tasks,asg}]=await Promise.all([people(), loadAll(), mtgLoadData(), gcalCasesLoadData()]).then(r=>[r[0],r[1]]);
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
    const mtgItems=(MTG_LIST||[]).filter(function(m){return mtgOccursOn(m,dateStr) && !MTG_DONE.has(m.id+'|'+dateStr);}).map(function(m){return {t:m,kind:'meeting'};});
    // Past dates just stop being included here — same "render-time exclusion, row untouched" pattern
    // used for recurring meetings (mtgOccursOn) rather than any server-side delete/archive.
    const caseItems=(dateStr<istTodayISO())?[]:(GCAL_CASES||[]).filter(function(c){return c.next_date_iso===dateStr;}).map(function(c){return {t:c,kind:'case'};});
    return items.concat(mtgItems).concat(caseItems).filter(x=>{
      if(!GCAL_FILTERS.has(x.kind))return false;
      if(GCAL_Q && !String(x.t.title||'').toLowerCase().includes(GCAL_Q))return false;
      return true;
    });
  }
  function gcalEvColor(kind){ return kind==='toMe'?'#2563eb':(kind==='meeting'?'#ea580c':(kind==='case'?'#1e3a8a':'#16a34a')); }
  function gcalItemKey(x){ return x.kind==='meeting' ? ('m'+x.t.id) : (x.kind==='case' ? ('c'+x.t.id) : String(x.t.id)); }
  window.gcalOpenItem=function(key){
    key=String(key);
    if(key.charAt(0)==='m'){ window.gcalOpenMeetingPanel(Number(key.slice(1))); }
    else if(key.charAt(0)==='c'){ window.gcalOpenCase(Number(key.slice(1))); }
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
    const caseRow=gcalCanSeeCases()
      ? '<label class="gcal-filter-row"><input type="checkbox" '+(GCAL_FILTERS.has('case')?'checked':'')+' onchange="gcalToggleFilter(\'case\',this.checked)"><span class="gcal-filter-dot" style="background:#1e3a8a"></span>Legal next dates</label>'
      : '';
    return '<div class="gcal-filters"><div class="gcal-filters-title">Quick filters</div>'+rows
      +'<label class="gcal-filter-row"><input type="checkbox" '+(GCAL_FILTERS.has('meeting')?'checked':'')+' onchange="gcalToggleFilter(\'meeting\',this.checked)"><span class="gcal-filter-dot" style="background:#ea580c"></span>Meetings</label>'
      +caseRow
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
      // No drag here by design — the Month grid is view-only; click a day to open its agenda panel,
      // where dragging to reschedule is still available (see gcalListDayHtml).
      const evs=items.map(function(x){
        return '<div class="gcal-mev" style="background:'+gcalEvColor(x.kind)+'" onclick="event.stopPropagation();gcalOpenItem(\''+gcalItemKey(x)+'\')" title="'+esc2(x.t.title)+'">'+esc2(x.t.title)+'</div>';
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
    const rt0=m.recur_type||'none';
    const draggable=(rt0==='none'||rt0==='weekly'||rt0==='monthly'); // daily time-drag not offered
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
      const mtgRt0 = x.kind==='meeting' ? (x.t.recur_type||'none') : '';
      // One-time, weekly and monthly meetings are draggable to reschedule; daily is not.
      const mtgDraggable = x.kind==='meeting' && (mtgRt0==='none'||mtgRt0==='weekly'||mtgRt0==='monthly');
      const draggable = x.kind!=='meeting' || mtgDraggable;
      let dragAttrs='';
      if(draggable) dragAttrs = x.kind==='meeting' ? (' data-meeting="'+x.t.id+'" data-date="'+dateStr+'"') : (x.kind==='case' ? (' data-case="'+x.t.id+'" data-date="'+dateStr+'"') : (' data-task="'+x.t.id+'" data-date="'+dateStr+'"'));
      const tag = x.kind==='meeting' ? (mtgFmtTime(x.t.start_time)+(x.t.end_time?(' – '+mtgFmtTime(x.t.end_time)):'')) : (x.kind==='case' ? 'Next date' : (x.kind==='toMe'?'To me':'By me'));
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
  window.gcalOpenCase=function(cid){
    const c=(GCAL_CASES||[]).find(function(x){return x.id===cid;});
    if(!c)return;
    let html='<div class="gcal-panel-title">'+esc2(c.title)+'</div>';
    if(c.case_type) html+='<div class="gcal-panel-row"><i class="fa-solid fa-scale-balanced"></i> '+esc2(c.case_type)+'</div>';
    if(c.case_no) html+='<div class="gcal-panel-row"><i class="fa-solid fa-hashtag"></i> '+esc2(c.case_no)+'</div>';
    if(c.court) html+='<div class="gcal-panel-row"><i class="fa-solid fa-building-columns"></i> '+esc2(c.court)+'</div>';
    if(c.priority) html+='<div class="gcal-panel-row"><i class="fa-solid fa-flag"></i> '+esc2(c.priority)+'</div>';
    html+='<div class="gcal-panel-row"><i class="fa-regular fa-calendar"></i> Next date: '+fmtDateY(c.next_date_iso)+'</div>';
    const panel=$('gcalPanel'), backdrop=$('gcalBackdrop'); if(!panel)return;
    GCAL_PANEL_ANCHOR=null;
    const bodyEl=panel.querySelector('.gcal-panel-body'); if(bodyEl)bodyEl.innerHTML=html;
    const foot=panel.querySelector('.gcal-panel-foot');
    if(foot)foot.innerHTML='<button class="ac-btn" onclick="gcalClosePanel()">Close</button><button class="ac-btn primary" onclick="navTo(\'legal/mis\')"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open in Legal MIS</button>';
    panel.classList.add('open'); if(backdrop)backdrop.classList.add('open');
  };

  /* ---- Create button + floating action button ----
     Task-creation from the calendar is disabled for now — once Meetings exist this
     will be redesigned around them rather than quietly creating a plain Task. */
  window.gcalQuickAdd=function(){ window._mtgAutoOpenCreate=true; navTo('tasks/meetings'); };

  /* ---- drag & drop: dragging a task or one-time-meeting row onto another day moves its date ----
     Uses pointer events (not native HTML5 DnD) to match the touch-friendly drag pattern already used
     elsewhere in this file (wirePointerDrag/wireSwapDrag). By design, the Month grid ITSELF is
     view-only — no drag there at all, on any chip kind — since long/varied content (Legal case
     titles especially) made stray drags too easy to trigger by accident on a small chip. Click a
     day to open its agenda panel (.gcal-lrow[data-task]/[data-meeting]/[data-case]), where dragging
     to reschedule is still available — one-time meetings ARE draggable there, recurring ones aren't
     since "the date" isn't a single field for them. `root` scopes the query so it can be wired
     inside the slide-in panel too, not just #gcalBody.
     Mouse/pen: a small movement threshold distinguishes a drag from a normal click.
     Touch: a movement threshold alone doesn't work on phones — the very first finger move is
     indistinguishable from "the user is trying to scroll the calendar", so instant-arm-on-move would
     fight the page's native scrolling. Instead touch uses a long-press-to-pick-up gesture (like
     reordering a card in Trello/Asana's mobile apps): hold still for ~380ms to arm the drag; moving
     more than a few px before that timer fires cancels arming and lets the normal scroll happen. */
  function gcalWireDrag(root){
    const body=root||$('gcalBody'); if(!body)return;
    body.querySelectorAll('.gcal-lrow[data-task], .gcal-lrow[data-meeting], .gcal-lrow[data-case]').forEach(function(chip){
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
        const cid=chip.dataset.case!=null?Number(chip.dataset.case):null;
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
                else if(mid!=null) gcalMeetingDateDrop(mid,newDate,fromDate);
                else if(cid!=null) gcalCaseDrop(cid,newDate);
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
  // Dragging a Legal case to a new day writes straight into mis_cases.next_date (public schema,
  // not acc — see gcalCasesLoadData). This fully replaces whatever free text was there before,
  // same as dragging a task fully overwrites its due_date; a DB trigger on mis_cases recomputes
  // next_date_iso from the new value and clears next_date_recorded_at (new date = new deadline).
  window.gcalCaseDrop=async function(cid,newDate){
    try{
      if(newDate<todayISO()){ toast('Cannot move a case to a date before today','err'); return; }
      const {error}=await sb.from('mis_cases').update({next_date:newDate}).eq('id',cid);
      if(error){ toast('Failed to move case: '+error.message,'err'); return; }
      toast('Next date moved to '+fmtDateY(newDate),'ok');
      await gcalLoadData();
      await gcalRefresh();
    }catch(e){ toast('Failed to move case','err'); }
  };
  // Dragging a one-time meeting onto another day's section changes its meeting_date. This resyncs
  // meeting_attendees (delete+reinsert, same as a normal edit) so the existing meeting-mailer trigger
  // re-emails attendees with the new date/time, and posts an in-app "meeting_update" notification too —
  // consistent with what a full edit via the meeting form already does on any change.
  // Mandatory choice when rescheduling a recurring meeting (drag/drop). change = {newDate?,newStart?,newEnd?}.
  // Dismissing the popup does NOT reschedule (the calendar re-renders back to how it was).
  function mtgReschedClose(){ const ov=document.getElementById('mtgReschedOv'); if(ov)ov.remove(); }
  window.mtgReschedAsk=function(mid, occDate, change){
    MTG_RESCHED={mid:mid, occDate:occDate, change:change||{}};
    mtgReschedClose(); // rebuild fresh every time so it always reappears
    const ov=document.createElement('div'); ov.id='mtgReschedOv';
    // z-index above the calendar day/meeting panel (200) and everything else, so it's never hidden behind a menu.
    ov.style.cssText='position:fixed;inset:0;z-index:100050;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML='<div style="background:var(--bg-card,#fff);color:var(--ink,#0b1220);border-radius:14px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.35);overflow:hidden;font-family:Segoe UI,Arial,sans-serif">'
      +'<div style="padding:16px 18px;border-bottom:1px solid var(--line,#e2e8f0);font-weight:700;font-size:15px"><i class="fa-solid fa-calendar-day" style="color:#e0121c"></i> Reschedule recurring meeting</div>'
      +'<div style="padding:18px"><p style="color:var(--slate,#64748b);font-size:13.5px;margin:0 0 14px">Apply this change to:</p><div style="display:flex;flex-direction:column;gap:10px">'
      +'<button class="ac-btn" style="justify-content:flex-start;text-align:left" onclick="mtgReschedApply(\'this\')"><i class="fa-solid fa-calendar-day"></i> &nbsp;This time only <span style="color:var(--slate);font-weight:400;margin-left:4px">— just this occurrence</span></button>'
      +'<button class="ac-btn" style="justify-content:flex-start;text-align:left" onclick="mtgReschedApply(\'all\')"><i class="fa-solid fa-repeat"></i> &nbsp;All times <span style="color:var(--slate);font-weight:400;margin-left:4px">— every occurrence</span></button>'
      +'</div></div>'
      +'<div style="padding:12px 18px;border-top:1px solid var(--line,#e2e8f0);text-align:right"><button class="ac-btn" onclick="mtgReschedCancel()">Cancel</button></div></div>';
    ov.addEventListener('click',function(e){ if(e.target===ov) mtgReschedCancel(); });
    document.body.appendChild(ov);
  };
  window.mtgReschedCancel=function(){ MTG_RESCHED=null; mtgReschedClose(); gcalRefresh(); };
  window.mtgReschedApply=async function(scope){
    const R=MTG_RESCHED; MTG_RESCHED=null; mtgReschedClose();
    if(!R) return;
    const m=(MTG_LIST||[]).find(function(x){return x.id===R.mid;}); if(!m){ gcalRefresh(); return; }
    const c=R.change||{};
    try{
      if(scope==='this'){
        const newDate=c.newDate||R.occDate;
        const {data:newId,error}=await sb.rpc('reschedule_meeting_occurrence',{p_meeting_id:R.mid,p_occ_date:R.occDate,p_new_date:newDate,p_new_start:c.newStart||m.start_time,p_new_end:c.newEnd||m.end_time});
        if(error)throw error;
        if(newId && m.mode==='online'){ try{ await mtgSyncGoogle(newId,'sync'); }catch(_e){} }
        toast('This occurrence rescheduled','ok');
      } else {
        const upd={};
        if(c.newStart) upd.start_time=c.newStart;
        if(c.newEnd) upd.end_time=c.newEnd;
        let wkShift=0, moDate=null;
        if(c.newDate){ const d=new Date(c.newDate+'T00:00:00'); if(m.recur_type==='weekly'){ upd.recur_day=d.getDay(); wkShift=d.getDay()-Number(m.recur_day); } else if(m.recur_type==='monthly'){ upd.recur_date=d.getDate(); moDate=d.getDate(); } }
        if(Object.keys(upd).length){ await ACC().from('meetings').update(upd).eq('id',R.mid); if(m.mode==='online'){ try{ await mtgSyncGoogle(R.mid,'sync'); }catch(_e){} } }
        // Keep individually-moved occurrences exactly where they were put (do NOT clear exceptions),
        // but also avoid a duplicate: when the series moves to a new weekday/date, re-point each
        // existing "this time only" skip to the series' NEW slot in that SAME week (weekly) or month
        // (monthly). That way a week/month already holding a moved copy doesn't ALSO get a fresh
        // series occurrence dropped into it.
        try{
          if(m.recur_type==='weekly' && wkShift!==0){
            const {data:sk}=await ACC().from('meeting_skips').select('occ_date').eq('meeting_id',R.mid);
            for(let i=0;i<(sk||[]).length;i++){ const od=sk[i].occ_date, nd=calShiftISO(od,wkShift); if(nd!==od) await ACC().from('meeting_skips').update({occ_date:nd}).eq('meeting_id',R.mid).eq('occ_date',od); }
          } else if(m.recur_type==='monthly' && moDate!=null){
            const {data:sk}=await ACC().from('meeting_skips').select('occ_date').eq('meeting_id',R.mid);
            for(let i=0;i<(sk||[]).length;i++){ const od=sk[i].occ_date, nd=od.slice(0,8)+String(moDate).padStart(2,'0'); if(nd!==od) await ACC().from('meeting_skips').update({occ_date:nd}).eq('meeting_id',R.mid).eq('occ_date',od); }
          }
        }catch(_e){}
        toast('All occurrences updated','ok');
      }
      await gcalLoadData(); await gcalRefresh();
    }catch(e){ toast('Reschedule failed: '+((e&&e.message)||e),'err'); try{ await gcalRefresh(); }catch(_e){} }
  };
  window.gcalMeetingDateDrop=async function(mid,newDate,origDate){
    const m=(MTG_LIST||[]).find(function(x){return x.id===mid;});
    if(!m) return;
    if(m.recur_type && m.recur_type!=='none'){ mtgReschedAsk(mid, origDate||newDate, {newDate:newDate}); return; }
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
    const mm=(MTG_LIST||[]).find(function(x){return x.id===mid;});
    if(mm && mm.recur_type && mm.recur_type!=='none'){ mtgReschedAsk(mid, (typeof GCAL_DATE!=='undefined'?GCAL_DATE:mm.meeting_date), {newStart:newStart, newEnd:newEnd}); return; }
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
  let MTG_LIST=[], MTG_ATT={}, MTG_PPL=[], MTG_DONE=new Set(), MTG_SKIP=new Set(), MTG_RESCHED=null;
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
    if(rt==='none') return m.meeting_date===dateStr;
    // Recurring meetings only occur from today onward — never paint them on past calendar days.
    if(dateStr < istTodayISO()) return false;
    if(MTG_SKIP.has(m.id+'|'+dateStr)) return false; // this occurrence was moved out (This-time reschedule)
    if(rt==='daily')return true;
    if(rt==='weekly')return new Date(dateStr+'T00:00:00').getDay()===m.recur_day;
    if(rt==='monthly')return new Date(dateStr+'T00:00:00').getDate()===Number(m.recur_date);
    return false;
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
    // Which occurrences are already done (a log exists). Recurring meetings keep meeting_id on their
    // logs; one-time meetings are deleted when done so they simply drop off the list. Used to turn the
    // Record button into "Done" and to hide a done occurrence from that day in the calendar.
    try{ const {data:lg}=await ACC().from('meeting_logs').select('meeting_id,occurrence_date').not('meeting_id','is',null); const s=new Set(); (lg||[]).forEach(function(r){ s.add(r.meeting_id+'|'+r.occurrence_date); }); MTG_DONE=s; }catch(e){ MTG_DONE=new Set(); }
    // Occurrences of a recurring meeting that were moved elsewhere ("this time only" reschedule) —
    // hidden from their original day.
    try{ const {data:sk}=await ACC().from('meeting_skips').select('meeting_id,occ_date'); const ss=new Set(); (sk||[]).forEach(function(r){ ss.add(r.meeting_id+'|'+r.occ_date); }); MTG_SKIP=ss; }catch(e){ MTG_SKIP=new Set(); }
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
    if(GOOGLE_CONNECTED===false){
      // A non-thejaingroup.com account can't connect Google Meet at all, so don't offer a
      // Connect button that would only ever fail — the offline banner explains what they CAN do.
      const offDomain=!/@thejaingroup\.com$/i.test(me()||'');
      if(offDomain) return '';
      return '<button class="mtg-gstatus connect" onclick="googleConnect()"><i class="fa-brands fa-google"></i> Connect Google</button>';
    }
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
  // Warn before recording/joining a meeting whose scheduled date is still in the future.
  window.mtgTryRecord=function(id){
    const m=(MTG_LIST||[]).find(function(x){return x.id===id;});
    if(!m) return;
    // Only the occurrence scheduled for TODAY can be recorded. A recurring meeting whose day falls
    // later this week, or a one-time meeting dated in the future, must not be recorded "as today" —
    // show a warning and stop. (Recording writes a log for today's date, so recording a not-today
    // meeting would wrongly mark the wrong day done.)
    const today=istTodayISO();
    const occursToday=(m.recur_type && m.recur_type!=='none') ? mtgOccursOn(m,today) : (m.meeting_date===today);
    if(!occursToday){
      toast('This meeting isn\'t scheduled for today — a meeting can only be recorded on the day it\'s scheduled.','warn');
      return;
    }
    navTo('tasks/meetings/record/'+id);
  };
  window.mtgTryJoin=function(id){
    const m=(MTG_LIST||[]).find(function(x){return x.id===id;});
    if(!m||!m.meet_link) return;
    if((m.recur_type==='none'||!m.recur_type) && m.meeting_date && m.meeting_date>istTodayISO()){
      if(!window.confirm('This meeting is scheduled for '+fmtDate(m.meeting_date)+' (in the future). Join it now anyway?')) return;
    }
    window.open(m.meet_link,'_blank','noopener');
  };
  function mtgCard(m,weekCount){
    const modeColor = m.mode==='offline' ? '#64748b' : '#2563eb';
    const people2=mtgAllAttendees(m);
    const rt=m.recur_type||'none';
    const dateLbl = rt==='none' ? (fmtDate(m.meeting_date)+', ') : '';
    const timeLabel=dateLbl+mtgFmtTime(m.start_time)+(m.end_time?(' – '+mtgFmtTime(m.end_time)):'');
    const recurLbl=mtgRecurLabel(m);
    const whereHtml = m.mode==='offline' ? '<i class="fa-solid fa-people-group"></i> Offline' : '<i class="fa-solid fa-video"></i> Online';
    const doneToday = MTG_DONE.has(m.id+'|'+istTodayISO());
    let join;
    if(doneToday) join='<button class="mtg-join" disabled title="Already done today">Done</button>';
    // Online meetings get Join AND Record — recording an online meeting captures the shared meeting
    // tab's audio as well as the microphone, so it too can be transcribed by Gemini.
    else if(m.mode==='online' && m.meet_link) join='<button class="mtg-join" onclick="event.stopPropagation();mtgTryJoin('+m.id+')" title="Join meeting">Join</button>'
      +'<button class="mtg-join" onclick="event.stopPropagation();mtgTryRecord('+m.id+')" title="Record this meeting">Record</button>';
    // An online meeting with no link yet can still be recorded; Join is what's unavailable.
    else if(m.mode==='online') join='<button class="mtg-join disabled" disabled title="No link added yet">Join</button>'
      +'<button class="mtg-join" onclick="event.stopPropagation();mtgTryRecord('+m.id+')" title="Record this meeting">Record</button>';
    else join='<button class="mtg-join" onclick="event.stopPropagation();mtgTryRecord('+m.id+')" title="Record this meeting">Record</button>';
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
    // Offline-only users (no Google) can invite anyone; online meetings still limit the picker to
    // people who've connected Google (they need to land on the Calendar invite / Meet).
    const pickable = (GOOGLE_CONNECTED===true)
      ? list.filter(function(p){ const e=String(p.email||'').toLowerCase(); return !eq(p.email,my) && (connected.has(e) || selSet.has(e)); })
      : list.filter(function(p){ return !eq(p.email,my); });
    const recurVal = m ? (m.recur_type||'none') : 'none';
    // New meetings default to Offline when Google isn't connected (Online needs a real Meet link).
    const modeVal = m ? (m.mode||'online') : (GOOGLE_CONNECTED===true ? 'online' : 'offline');
    const recurOpts=[['none','One-time'],['daily','Daily'],['weekly','Weekly'],['monthly','Monthly']];
    openModal('<div class="modal-head"><h3><i class="fa-solid fa-video"></i> '+(editing?'Edit Meeting':'Schedule Meeting')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
      +'<div class="modal-body frm">'
      +'<label>Title</label><input id="mtgTitle" placeholder="e.g. Weekly Marketing Sync" value="'+(m?esc2(m.title):'')+'">'
      +'<label>Recurring</label><select id="mtgRecur" onchange="mtgRecurChange()">'+recurOpts.map(function(o){return '<option value="'+o[0]+'"'+(o[0]===recurVal?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select>'
      +((editing && recurVal!=='none')?('<label>Apply changes to <span style="color:#e0121c">*</span></label><select id="mtgScope"><option value="">Choose…</option><option value="all">All occurrences</option><option value="this">This occurrence only (the next one)</option></select>'):'')
      +'<div class="two"><div><label>Mode</label><select id="mtgMode" onchange="mtgModeChange()"><option value="online"'+(modeVal==='online'?' selected':'')+(GOOGLE_CONNECTED===true?'':' disabled')+'>Online'+(GOOGLE_CONNECTED===true?'':' — needs Google')+'</option><option value="offline"'+(modeVal==='offline'?' selected':'')+'>Offline</option></select></div><div id="mtgDateWrap">'+mtgDateFieldHtml(recurVal,m)+'</div></div>'
      +'<div class="two"><div><label>Start time <span style="color:var(--slate);font-weight:400">(24h)</span></label><input type="text" id="mtgStart" inputmode="numeric" maxlength="5" placeholder="HH:MM" value="'+(m?esc2(mtgTimeVal(m.start_time)):'')+'" oninput="mtgTimeMask(this)" onblur="mtgTimeNorm(this)"></div><div><label>End time <span style="color:var(--slate);font-weight:400">(optional, 24h)</span></label><input type="text" id="mtgEnd" inputmode="numeric" maxlength="5" placeholder="HH:MM" value="'+(m?esc2(mtgTimeVal(m.end_time)):'')+'" oninput="mtgTimeMask(this)" onblur="mtgTimeNorm(this)"></div></div>'
      +'<div id="mtgLinkWrap">'+mtgLinkFieldHtml(modeVal,m)+'</div>'
      +'<label>Attendees <span style="color:var(--slate);font-weight:400">('+(GOOGLE_CONNECTED===true?'optional — only people who\'ve connected Google can be added':'optional')+')</span></label>'+msWidget('mtgAttBox',pickable,selAtt)
      +((GOOGLE_CONNECTED===true&&!pickable.length)?'<p style="color:var(--slate);font-size:12.5px;margin:4px 0 0">Nobody else has connected their Google account yet.</p>':'')
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
    if(mode==='online' && GOOGLE_CONNECTED!==true){ toast('Online meetings need a connected Google account — choose Offline, or connect Google first.','warn'); return; }
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
    // The scope choice (this occurrence vs all) only applies when the meeting was ALREADY recurring —
    // that's the only case where the scope selector is actually shown in the form. A one-time meeting
    // being edited (INCLUDING one being converted to Daily/Weekly/Monthly) has just a single occurrence,
    // so it falls through to the normal update below. Keying this off the ORIGINAL recur type (not the
    // new form value) fixes the bug where converting One-time → recurring demanded a scope choice whose
    // dropdown never existed, leaving the user unable to save.
    const origMtg = editing ? (MTG_LIST||[]).find(function(x){return x.id===id;}) : null;
    const origRecur = (origMtg && origMtg.recur_type) ? origMtg.recur_type : 'none';
    if(editing && origRecur!=='none'){
      const scope=$('mtgScope')?$('mtgScope').value:'';
      if(!scope){ toast('Choose whether changes apply to this occurrence or all occurrences','warn'); return; }
      if(scope==='this'){
        const orig=(MTG_LIST||[]).find(function(x){return x.id===id;})||{};
        let occ=istTodayISO(); for(let i=0;i<400;i++){ if(mtgOccursOn(orig,occ))break; occ=calShiftISO(occ,1); }
        const b=$('mtgSaveBtn'); if(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…';}
        try{
          const {data:newId,error}=await sb.rpc('reschedule_meeting_occurrence',{p_meeting_id:id,p_occ_date:occ,p_new_date:occ,p_new_start:start,p_new_end:end});
          if(error)throw error;
          if(newId && mode==='online'){ try{ await mtgSyncGoogle(newId,'sync'); }catch(_e){} }
          toast('This occurrence updated','ok'); closeModal(); await mtgLoadData(); mtgRenderOnly();
        }catch(e){ toast('Could not update this occurrence: '+((e&&e.message)||e),'err'); if(b){b.disabled=false;b.innerHTML='<i class="fa-solid fa-check"></i> Save changes';} }
        return;
      }
    }
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
      if(l.attendance_status==='pending') return '<span class="mtg-log-badge pending">Members pending</span>';
      if(l.attendance_status==='recorded') return '<span class="mtg-log-badge ready"><i class="fa-solid fa-user-check"></i> '+((l.present_emails||[]).length)+' present</span>';
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
    let audioSrc=null;
    // Either kind of meeting can now carry a recording, so this no longer checks the mode.
    if(l.audio_url && isS3Path(l.audio_url)){ try{ const {data}=await s3Sign('get', l.audio_url.slice(3)); if(data&&data.url)audioSrc=data.url; }catch(_e){} }
    const durationHtml = '<div class="gcal-panel-row"><i class="fa-regular fa-clock"></i> '+esc2(mtgLogTimeLabel(l))
      +(actualDur?(' <span style="color:#166534;font-weight:600;margin-left:6px">'+esc2(actualDur)+' actual</span>'):' <span style="color:var(--slate);font-weight:400;margin-left:6px">(scheduled)</span>')
      +'</div>'
      +((l.actual_start&&l.actual_end)?('<div class="gcal-panel-row"><i class="fa-solid fa-microphone" style="color:#e0121c"></i> Recorded <b>'+esc2(mtgClockIST(l.actual_start)+' – '+mtgClockIST(l.actual_end))+'</b> <span style="color:var(--slate);font-size:12px">IST</span></div>'):'');
    let attendeesHtml;
    if(l.mode==='offline'){
      if(l.attendance_status==='not_marked_done'){
        attendeesHtml='<div class="gcal-panel-row"><i class="fa-solid fa-users"></i> Invited: '+esc2(invitedNames.join(', ')||'—')+'</div>'
          +'<p style="color:var(--slate);font-size:13px;margin:6px 0 0">This meeting was <b>not marked done</b> — it wasn\'t recorded on the scheduled day, so it moved to Archive the following day.</p>';
      } else {
        const present=(l.present_emails||[]);
        const presentL=present.map(function(e){return String(e).toLowerCase();});
        const missingEmails=(l.attendee_emails||[]).filter(function(e){return presentL.indexOf(String(e).toLowerCase())===-1;});
        if(!present.length){
          attendeesHtml='<div class="gcal-panel-row"><i class="fa-solid fa-users"></i> Invited: '+esc2(invitedNames.join(', ')||'—')+'</div>'
            +'<p style="color:#b45309;font-size:13px;margin:6px 0 0"><b>Members pending</b> — nobody has been recorded as present yet.</p>'
            +'<div style="margin-top:10px"><button class="ac-btn primary" onclick="navTo(\'tasks/meetings/wrap/'+l.id+'\')"><i class="fa-solid fa-user-plus"></i> Add members</button></div>';
        } else {
          attendeesHtml='<div style="margin-bottom:6px"><b style="font-size:12.5px;color:var(--slate)">Present ('+present.length+')</b></div>'
            +present.map(function(e){ return '<div class="mtg-log-attendee"><i class="fa-solid fa-circle-check" style="color:#16a34a"></i> '+esc2(nameOf(plist,e)||e)+'</div>'; }).join('')
            +(missingEmails.length?('<div style="margin-top:10px"><b style="font-size:12.5px;color:#b45309">Invited but absent ('+missingEmails.length+')</b></div>'+missingEmails.map(function(e){ return '<div class="mtg-log-attendee"><i class="fa-solid fa-user-xmark" style="color:#b45309"></i> '+esc2(nameOf(plist,e)||e)+'</div>'; }).join('')):'');
        }
      }
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
    const transcriptHtml=mtgTranscriptHtml(l);
    // Both kinds of meeting can be recorded in the portal now, so the panel is the same for both.
    // The old message about the Google Workspace plan referred to Google's OWN recording feature,
    // which we no longer depend on for a transcript.
    const recordingHtml = audioSrc
      ? ('<audio controls preload="none" style="width:100%;margin-top:4px" src="'+esc2(audioSrc)+'"></audio>')
      : ('<p style="color:var(--slate);font-size:13px;margin:6px 0 0">No recording was captured for this meeting.'
         +(l.mode==='online'?' Use the <b>Record</b> button during an online meeting and share the meeting tab\'s audio to capture one.':'')+'</p>');
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

  /* ---------- OFFLINE MEETING RECORDING + WRAP-UP (record -> transcribe -> members -> log) ---------- */
  let MTG_REC=null, MTG_WRAP=null;
  function mtgSecFmt(s){ s=Math.max(0,s|0); const m=Math.floor(s/60), ss=s%60; return String(m).padStart(2,'0')+':'+String(ss).padStart(2,'0'); }
  function mtgClockIST(iso){ try{ return new Date(iso).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'Asia/Kolkata'}); }catch(e){ return ''; } }
  let MTG_LOG_LANG='en';   // which transcript version the user is viewing
  const MTG_LANG_NAMES={en:'English',hi:'Hindi',bn:'Bengali',ta:'Tamil',te:'Telugu',mr:'Marathi',gu:'Gujarati',ur:'Urdu',pa:'Punjabi'};
  function mtgLangName(c){return MTG_LANG_NAMES[String(c||'').toLowerCase()]||String(c||'').toUpperCase();}
  function mtgTrText(l,lang){ return (lang==='bn')?(l.transcript_bn||l.transcript||''):(l.transcript_en||l.transcript||''); }
  function mtgTrBody(l,lang){
    const txt=mtgTrText(l,lang);
    if(!txt) return '<p style="color:var(--slate);font-size:13px;margin:8px 0 0">'+(lang==='bn'?'The original-language version isn\'t stored for this recording — record it again to get both versions.':'No transcript text available.')+'</p>';
    return '<div class="mtg-log-transcript">'+esc2(txt).replace(/\n/g,'<br>')+'</div>';
  }
  window.mtgSetLang=function(lang){
    MTG_LOG_LANG=lang;
    const l=window._mtgLogRow; if(!l)return;
    const b=document.getElementById('mtgTrBody'); if(b)b.innerHTML=mtgTrBody(l,lang);
    ['en','bn'].forEach(function(k){ const btn=document.getElementById('mtgLang_'+k); if(btn){ if(k===lang)btn.classList.add('primary'); else btn.classList.remove('primary'); } });
  };
  function mtgTranscriptHtml(l){
    if(l.transcript_status==='ready'){
      window._mtgLogRow=l;
      const sum=(l.summary||'').trim();
      const sumHtml=sum?('<div class="mtg-log-summary"><div class="mtg-log-sumh"><i class="fa-solid fa-wand-magic-sparkles"></i> AI Summary</div><div>'+esc2(sum).replace(/\n/g,'<br>')+'</div></div>'):'';
      // quick facts about the recording
      const enTxt=mtgTrText(l,'en'), words=enTxt?enTxt.trim().split(/\s+/).length:0;
      const langs=Array.isArray(l.languages)?l.languages.filter(Boolean):[];
      const facts=[];
      if(l.num_speakers)facts.push(['Speakers',String(l.num_speakers)]);
      if(langs.length)facts.push(['Languages',langs.map(mtgLangName).join(', ')]);
      if(words)facts.push(['Words',words.toLocaleString('en-IN')]);
      const factsHtml=facts.length?('<div class="mtg-tr-facts">'+facts.map(function(f){return '<div class="mtg-tr-fact"><div class="k">'+esc2(f[0])+'</div><div class="v">'+esc2(f[1])+'</div></div>';}).join('')+'</div>'):'';
      const hasBn=!!(l.transcript_bn&&String(l.transcript_bn).trim());
      const lang=(MTG_LOG_LANG==='bn'&&hasBn)?'bn':'en';
      const toggle='<div class="mtg-tr-bar"><div class="mtg-tr-h"><i class="fa-solid fa-quote-left"></i> Transcript</div>'
        +'<div class="mtg-tr-btns"><button class="ac-btn'+(lang==='en'?' primary':'')+'" id="mtgLang_en" onclick="mtgSetLang(\'en\')">English</button>'
        +'<button class="ac-btn'+(lang==='bn'?' primary':'')+'" id="mtgLang_bn" onclick="mtgSetLang(\'bn\')">বাংলা / Original</button></div></div>';
      return factsHtml+sumHtml+toggle+'<div id="mtgTrBody">'+mtgTrBody(l,lang)+'</div>';
    }
    if(l.transcript_status==='processing') return '<p style="color:var(--slate);font-size:13px;margin:6px 0 0"><i class="fa-solid fa-spinner fa-spin"></i> Transcribing the recording&hellip; this appears here automatically once ready.</p>';
    if(l.transcript_status==='pending') return '<p style="color:var(--slate);font-size:13px;margin:6px 0 0">Transcript queued&hellip;</p>';
    if(l.transcript_status==='failed') return '<p style="color:#b45309;font-size:13px;margin:6px 0 0">Transcription failed for this recording.</p>';
    // 'unavailable' was set on online meetings back when a transcript could only come from Google's
    // own recording. It can now come from a recording made here, so say what to do about it.
    if(l.transcript_status==='unavailable'||!l.transcript_status){
      return '<p style="color:var(--slate);font-size:13px;margin:6px 0 0">No transcript — this meeting wasn\'t recorded'
        +(l.mode==='online'?' in the portal. Record the next one with the <b>Record</b> button and it will be transcribed automatically.':'.')+'</p>';
    }
    return '<p style="color:var(--slate);font-size:13px;margin:6px 0 0">No transcript for this meeting.</p>';
  }
  function mtgInjectRecCss(){
    if(document.getElementById('mtgRecCss'))return;
    const s=document.createElement('style'); s.id='mtgRecCss';
    s.textContent='.mtg-rec-card{text-align:center;padding:28px 20px}.mtg-rec-dot{width:16px;height:16px;border-radius:50%;background:#cbd5e1;margin:0 auto 14px}.mtg-rec-dot.on{background:#e0121c;animation:mtgpulse 1.2s infinite}@keyframes mtgpulse{0%{box-shadow:0 0 0 0 rgba(224,18,28,.5)}70%{box-shadow:0 0 0 13px rgba(224,18,28,0)}100%{box-shadow:0 0 0 0 rgba(224,18,28,0)}}.mtg-rec-timer{font-size:42px;font-weight:800;letter-spacing:1px;color:var(--ink)}.mtg-rec-hint{color:var(--slate);font-size:13px;max-width:440px;margin:12px auto 22px;line-height:1.55}.mtg-rec-btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}.ac-btn.lg{padding:12px 22px;font-size:15px}.mtg-miss{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:8px;padding:8px 11px;font-size:12.5px}.mtg-log-transcript{white-space:pre-wrap;font-size:13.5px;line-height:1.6;color:var(--ink);max-height:420px;overflow:auto}';
    document.head.appendChild(s);
  }
  async function mtgRecCall(payload){
    try{
      const {data:{session}}=await sb.auth.getSession();
      const token=session&&session.access_token;
      const res=await fetch(SUPABASE_URL+'/functions/v1/meeting-record',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'apikey':SUPABASE_KEY},body:JSON.stringify(payload)});
      return await res.json().catch(function(){return {error:'bad response'};});
    }catch(e){ return {error:String(e)}; }
  }
  // Upload recording audio THROUGH Supabase (meeting-audio-upload) rather than browser->S3 directly,
  // so it works from any site origin (the S3 bucket's CORS only trusts the production domain).
  // Returns the same shape as uploadFileToS3: {data:{path}} | {error}.
  async function mtgUploadAudio(key, blob){
    try{
      const {data:{session}}=await sb.auth.getSession();
      const token=session&&session.access_token;
      const res=await fetch(SUPABASE_URL+'/functions/v1/meeting-audio-upload?key='+encodeURIComponent(key),{method:'POST',headers:{'Content-Type':blob.type||'application/octet-stream','Authorization':'Bearer '+token,'apikey':SUPABASE_KEY},body:blob});
      const out=await res.json().catch(function(){return {};});
      if(!res.ok||out.error) return {error:{message:out.error||('upload HTTP '+res.status)}};
      return {data:{path:out.path}};
    }catch(e){ return {error:{message:String(e)}}; }
  }
  async function mtgRecordPage(v, meetingId){
    injectCss(); mtgInjectRecCss(); setCrumb(['Accountability','Record Meeting']);
    v.innerHTML='<div class="loader"><div class="spin"></div></div>';
    let m=(MTG_LIST||[]).find(function(x){return x.id===meetingId;});
    if(!m){ try{ const {data}=await ACC().from('meetings').select('*').eq('id',meetingId).maybeSingle(); m=data; }catch(e){} }
    if(!m){ v.innerHTML='<div class="tp-card"><div class="ac-empty" style="cursor:default;border:0">Meeting not found (it may already be archived).</div><div style="margin-top:12px"><button class="ac-btn" onclick="navTo(\'tasks/meetings\')">Back to Meetings</button></div></div>'; return; }
    MTG_REC={meeting:m, rec:null, chunks:[], stream:null, startedAt:null, wakeLock:null, secs:0, timer:null, mime:''};
    const when=mtgFmtTime(m.start_time)+(m.end_time?(' – '+mtgFmtTime(m.end_time)):'');
    v.innerHTML='<div class="tp-head">'
      +'<div><div class="tp-title"><i class="fa-solid fa-microphone" style="color:#e0121c"></i> Record — '+esc2(m.title)+'</div><div class="tp-sub">'+esc2(when)+' · '+(m.mode==='online'?'Online':'Offline')+'</div></div>'
      +'<div class="tp-acts"><button class="ac-btn ic" title="Cancel" onclick="mtgRecCancel()"><i class="fa-solid fa-arrow-left"></i></button></div>'
      +'</div>'
      +'<div class="tp-card mtg-rec-card">'
        +'<div class="mtg-rec-dot" id="mtgRecDot"></div>'
        +'<div class="mtg-rec-timer" id="mtgRecTimer">00:00</div>'
        +'<div class="mtg-rec-hint" id="mtgRecHint">'
          +(m.mode==='online'
             ? 'Tap Start, then choose the <b>Meet tab</b> and tick <b>Share tab audio</b> — that captures everyone else. Your microphone is recorded too, so both sides are transcribed.'
             : 'Tap Start when the meeting begins. Keep this screen open — recording captures this device\'s microphone.')
        +'</div>'
        +'<div class="mtg-rec-btns">'
          +'<button class="ac-btn primary lg" id="mtgRecStart" onclick="mtgRecStart()"><i class="fa-solid fa-microphone"></i> Start recording</button>'
          +'<button class="ac-btn danger lg" id="mtgRecStop" style="display:none" onclick="mtgRecStop()"><i class="fa-solid fa-stop"></i> Stop &amp; finish</button>'
        +'</div>'
      +'</div>';
  }
  window.mtgRecStart=async function(){
    const R=MTG_REC; if(!R||!R.meeting)return;
    if(typeof MediaRecorder==='undefined'||!navigator.mediaDevices){ toast('Recording isn\'t supported on this browser.','err'); return; }
    // An OFFLINE meeting happens in the room, so the microphone hears everyone.
    // An ONLINE meeting does not: the other people arrive as sound coming OUT of this device, which
    // a microphone either misses entirely (headphones) or picks up faintly. So for online meetings
    // we also ask the browser to share the Meet tab's audio and mix the two together, giving Gemini
    // one track with both sides of the conversation. If that share is declined we fall back to the
    // microphone alone rather than failing outright.
    const isOnline=(R.meeting.mode==='online');
    let stream, mic=null, tab=null, mixCtx=null;
    try{ mic=await navigator.mediaDevices.getUserMedia({audio:true}); }
    catch(e){ toast('Microphone permission is needed to record.','err'); return; }
    if(isOnline && navigator.mediaDevices.getDisplayMedia){
      try{
        tab=await navigator.mediaDevices.getDisplayMedia({audio:true, video:true});
        // we only want the sound — drop the picture immediately so nothing is captured visually
        (tab.getVideoTracks()||[]).forEach(function(t){ t.stop(); tab.removeTrack(t); });
        if(!(tab.getAudioTracks()||[]).length){
          toast('That share had no sound — tick “Share tab audio” when picking the Meet tab. Recording the microphone only.','warn');
          try{ (tab.getTracks()||[]).forEach(function(t){t.stop();}); }catch(_e){}
          tab=null;
        }
      }catch(_e){ toast('Recording the microphone only — the meeting tab wasn\'t shared.','warn'); tab=null; }
    }
    if(tab){
      try{
        const AC=window.AudioContext||window.webkitAudioContext;
        mixCtx=new AC();
        const dest=mixCtx.createMediaStreamDestination();
        mixCtx.createMediaStreamSource(mic).connect(dest);
        mixCtx.createMediaStreamSource(tab).connect(dest);
        stream=dest.stream;
      }catch(_e){ stream=mic; try{ if(mixCtx)mixCtx.close(); }catch(_e2){} mixCtx=null; }
    } else { stream=mic; }
    let mime='audio/webm';
    if(!MediaRecorder.isTypeSupported(mime)) mime=MediaRecorder.isTypeSupported('audio/mp4')?'audio/mp4':'';
    let rec; try{ rec=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream); }catch(e){ rec=new MediaRecorder(stream); }
    R.stream=stream; R.rec=rec; R.chunks=[]; R.mime=rec.mimeType||mime||'audio/webm';
    R.extraStreams=[mic,tab].filter(Boolean); R.mixCtx=mixCtx;   // stopped alongside R.stream later
    rec.ondataavailable=function(e){ if(e.data&&e.data.size)R.chunks.push(e.data); };
    rec.start(1000);
    R.startedAt=new Date().toISOString(); R.secs=0;
    R.timer=setInterval(function(){ R.secs++; const el=$('mtgRecTimer'); if(el)el.textContent=mtgSecFmt(R.secs); },1000);
    const dot=$('mtgRecDot'); if(dot)dot.classList.add('on');
    const st=$('mtgRecStart'), sp=$('mtgRecStop'), h=$('mtgRecHint');
    if(st)st.style.display='none'; if(sp)sp.style.display='';
    if(h)h.textContent='Recording… keep this screen on and the app open. Tap Stop when the meeting ends.';
    try{ if(navigator.wakeLock&&navigator.wakeLock.request) R.wakeLock=await navigator.wakeLock.request('screen'); }catch(_e){}
  };
  window.mtgRecStop=async function(){
    const R=MTG_REC; if(!R||!R.rec)return;
    if(R.stopping) return; R.stopping=true;  // guard against a double Stop firing save-recording twice
    const sp=$('mtgRecStop'); if(sp){sp.disabled=true;sp.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Finishing…';}
    if(R.timer){clearInterval(R.timer);R.timer=null;}
    const endedAt=new Date().toISOString();
    await new Promise(function(resolve){ try{ R.rec.onstop=resolve; R.rec.stop(); }catch(_e){ resolve(); } });
    try{ (R.stream.getTracks()||[]).forEach(function(t){t.stop();}); }catch(_e){}
    // the microphone and the shared-tab stream are separate from the mixed one handed to the recorder
    try{ (R.extraStreams||[]).forEach(function(s){ (s.getTracks()||[]).forEach(function(t){t.stop();}); }); }catch(_e){}
    try{ if(R.mixCtx){ R.mixCtx.close(); R.mixCtx=null; } }catch(_e){}
    try{ if(R.wakeLock){R.wakeLock.release();R.wakeLock=null;} }catch(_e){}
    const blob=new Blob(R.chunks,{type:R.mime||'audio/webm'});
    const occ=istTodayISO();
    const ext=(R.mime&&R.mime.indexOf('mp4')>=0)?'mp4':'webm';
    let audioPath=null;
    if(blob.size){
      const key='accountability/meeting-audio/'+R.meeting.id+'-'+occ+'-'+Date.now()+'.'+ext;
      const up=await mtgUploadAudio(key,blob);
      if(up&&up.data)audioPath=up.data.path; else toast('Audio upload failed — you can still log attendees, but there will be no transcript.','warn');
    }
    const resp=await mtgRecCall({action:'save-recording',meeting_id:R.meeting.id,occ:occ,actual_start:R.startedAt,actual_end:endedAt,audio_url:audioPath});
    if(!resp||!resp.log_id){ toast('Could not save the recording: '+((resp&&resp.error)||'unknown error'),'err'); if(sp){sp.disabled=false;sp.innerHTML='<i class="fa-solid fa-stop"></i> Stop &amp; finish';} return; }
    MTG_REC=null;
    navTo('tasks/meetings/wrap/'+resp.log_id);
  };
  window.mtgRecCancel=function(){
    const R=MTG_REC;
    if(R&&R.rec&&R.rec.state&&R.rec.state!=='inactive'){
      if(!window.confirm('Discard this recording? Nothing will be saved.'))return;
      if(R.timer)clearInterval(R.timer);
      try{R.rec.stop();}catch(_e){}
      try{(R.stream.getTracks()||[]).forEach(function(t){t.stop();});}catch(_e){}
      try{ if(R.wakeLock)R.wakeLock.release(); }catch(_e){}
    }
    MTG_REC=null; navTo('tasks/meetings');
  };
  async function mtgWrapPage(v, logId){
    injectCss(); mtgInjectRecCss(); setCrumb(['Accountability','Meeting Wrap-up']);
    v.innerHTML='<div class="loader"><div class="spin"></div></div>';
    let l=null; try{ const {data}=await ACC().from('meeting_logs').select('*').eq('id',logId).maybeSingle(); l=data; }catch(e){}
    if(!l){ v.innerHTML='<div class="tp-card"><div class="ac-empty" style="cursor:default;border:0">Log not found.</div></div>'; return; }
    const dir=await people();
    const invited=(l.attendee_emails||[]);
    // Members list = ONLY the people invited when the meeting was created (this already includes the
    // organiser). Tick who actually attended; the rest are marked absent.
    const memberList=invited.map(function(e){ const p=dir.find(function(x){return eq(x.email,e);}); return {email:e, name:(p?p.name:e), depts:(p&&p.depts)?p.depts:[]}; });
    const presel=(l.present_emails&&l.present_emails.length)?l.present_emails:invited.slice();
    MTG_WRAP={logId:logId, invited:invited, people:memberList, l:l};
    const dateIST=fmtDateY(l.occurrence_date);
    const recRange=(l.actual_start&&l.actual_end)?(mtgClockIST(l.actual_start)+' – '+mtgClockIST(l.actual_end)):'';
    const durTxt=(l.actual_start&&l.actual_end)?mtgSecFmt(Math.round((new Date(l.actual_end)-new Date(l.actual_start))/1000)):'';
    v.innerHTML='<div class="tp-head">'
      +'<div><div class="tp-title"><i class="fa-solid fa-clipboard-check" style="color:#16a34a"></i> Wrap up — '+esc2(l.title)+'</div><div class="tp-sub">'+esc2(dateIST)+' · Offline</div></div>'
      +'</div>'
      +'<div class="tp-card">'
        +'<div class="gcal-panel-row"><i class="fa-regular fa-calendar"></i> Date (IST): <b>'+esc2(dateIST)+'</b></div>'
        +(recRange?('<div class="gcal-panel-row"><i class="fa-regular fa-clock"></i> Recording: <b>'+esc2(recRange)+'</b>'+(durTxt?(' <span style="color:var(--slate)">('+esc2(durTxt)+')</span>'):'')+' <span style="color:var(--slate);font-size:12px">IST</span></div>'):'')
      +'</div>'
      +'<div class="tp-card"><h3><i class="fa-solid fa-file-lines" style="color:#64748b"></i> Transcript</h3><div id="mtgWrapTranscript">'+mtgTranscriptHtml(l)+'</div></div>'
      +'<div class="tp-card"><h3><i class="fa-solid fa-users" style="color:#e0121c"></i> Members present <span style="color:#e0121c">*</span></h3>'
        +'<p style="color:var(--slate);font-size:12.5px;margin:0 0 8px">Tick everyone who actually attended — this is required before saving.</p>'
        +msWidget('mtgWrapMembers',memberList,presel)
        +'<div id="mtgWrapMissing" style="margin-top:10px"></div>'
      +'</div>'
      +'<div class="wf-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px"><button class="ac-btn primary" id="mtgWrapSave" onclick="mtgWrapSave()"><i class="fa-solid fa-floppy-disk"></i> Save to Logs</button></div>'
      +'<div style="color:var(--slate);font-size:12px;margin-top:8px;text-align:right">Members are required — leaving without saving keeps this occurrence marked <b>Pending</b>.</div>';
    const mb=document.getElementById('mtgWrapMembers'); if(mb){ mb.addEventListener('click',function(){ setTimeout(mtgWrapUpdateMissing,0); }); }
    mtgWrapUpdateMissing();
    mtgWrapPollTranscript(logId);
  }
  function mtgWrapUpdateMissing(){
    const box=document.getElementById('mtgWrapMissing'); if(!box||!MTG_WRAP)return;
    const present=(typeof msGet==='function'?msGet('mtgWrapMembers'):[]);
    const presentL=present.map(function(e){return String(e).toLowerCase();});
    const missing=(MTG_WRAP.invited||[]).filter(function(e){return presentL.indexOf(String(e).toLowerCase())===-1;});
    if(missing.length){ box.innerHTML='<div class="mtg-miss"><i class="fa-solid fa-user-xmark"></i> Invited but not ticked present: '+missing.map(function(e){return esc2(nameOf(MTG_WRAP.people,e)||e);}).join(', ')+'</div>'; }
    else box.innerHTML='';
  }
  function mtgWrapPollTranscript(logId){
    let n=0;
    const iv=setInterval(async function(){
      n++;
      const el=document.getElementById('mtgWrapTranscript');
      if(!el||n>120){ clearInterval(iv); return; }
      try{ const {data}=await ACC().from('meeting_logs').select('transcript,transcript_en,transcript_bn,summary,languages,num_speakers,transcript_status').eq('id',logId).maybeSingle();
        if(data){ el.innerHTML=mtgTranscriptHtml(data); if(data.transcript_status==='ready'||data.transcript_status==='failed'||data.transcript_status==='none'){ clearInterval(iv); } }
      }catch(e){}
    },5000);
  }
  window.mtgWrapSave=async function(){
    if(!MTG_WRAP)return;
    const present=(typeof msGet==='function'?msGet('mtgWrapMembers'):[]);
    if(!present.length){ toast('Add at least the members who attended before saving.','warn'); mtgWrapUpdateMissing(); return; }
    const btn=$('mtgWrapSave'); if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…';}
    const resp=await mtgRecCall({action:'save-members',log_id:MTG_WRAP.logId,present_emails:present});
    if(!resp||!resp.ok){ toast('Could not save: '+((resp&&resp.error)||'unknown error'),'err'); if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-floppy-disk"></i> Save to Logs';} return; }
    toast('Saved to Logs','ok');
    const l=MTG_WRAP.l, lid=MTG_WRAP.logId; MTG_WRAP=null;
    if(l && l.recur_type && l.recur_type!=='none' && l.meeting_id!=null) navTo('tasks/meetings/logs/'+l.meeting_id);
    else navTo('tasks/meetings/log/'+lid);
  };

  /* ---------- WAY A: in-browser transcription worker (transformers.js, WASM/WebGPU) ----------
     Distributed & free: whichever logged-in DESKTOP browser has the portal open picks up pending
     offline-meeting recordings, transcribes them locally (no install, no dedicated machine), and
     posts the text back. Jobs are claimed atomically server-side so two open browsers never do the
     same one. Gated to desktop + visible tab to avoid draining phones / background machines. */
  const WT_CDN='https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3';
  const WT_MODEL='onnx-community/whisper-base';   // multilingual (hi/en/bn); small enough for browsers
  let WT_started=false, WT_pipe=null, WT_pipePromise=null, WT_busy=false;
  function wtIsMobile(){ return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent||''); }
  function wtChip(show,txt){
    let c=document.getElementById('wtChip');
    if(!show){ if(c)c.remove(); return; }
    mtgInjectRecCss();
    if(!c){ c=document.createElement('div'); c.id='wtChip'; c.style.cssText='position:fixed;bottom:16px;right:16px;z-index:9999;background:#0a0a0c;color:#fff;border:1px solid rgba(224,18,28,.5);border-radius:10px;padding:8px 12px;font:600 12px Segoe UI,Arial,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.28);display:flex;align-items:center;gap:8px'; document.body.appendChild(c); }
    c.innerHTML='<span style="width:8px;height:8px;border-radius:50%;background:#e0121c;display:inline-block;animation:mtgpulse 1.2s infinite"></span> '+esc2(txt);
  }
  async function wtLoadPipe(){
    if(WT_pipe) return WT_pipe;
    if(WT_pipePromise) return WT_pipePromise;
    WT_pipePromise=(async function(){
      const mod=await import(WT_CDN);
      const opts={};
      try{ if(navigator.gpu) opts.device='webgpu'; }catch(_e){}
      WT_pipe=await mod.pipeline('automatic-speech-recognition', WT_MODEL, opts);
      return WT_pipe;
    })();
    return WT_pipePromise;
  }
  async function wtDecode(url){
    const res=await fetch(url); if(!res.ok) throw new Error('audio fetch '+res.status);
    const buf=await res.arrayBuffer();
    const AC=window.AudioContext||window.webkitAudioContext;
    const ctx=new AC({sampleRate:16000});
    const audio=await ctx.decodeAudioData(buf);
    const data=audio.getChannelData(0).slice();
    try{ ctx.close(); }catch(_e){}
    return data;
  }
  async function wtTick(){
    if(!WT_started) return;
    const again=function(ms){ setTimeout(wtTick,ms); };
    if(document.visibilityState!=='visible' || WT_busy){ return again(15000); }
    let job=null;
    try{ const r=await mtgRecCall({action:'claim-transcription'}); if(r&&r.log_id)job=r; }catch(_e){}
    if(!job){ return again(60000); }
    WT_busy=true; wtChip(true,'Transcribing a meeting…');
    try{
      const pipe=await wtLoadPipe();
      let src=job.audio_url;
      if(typeof src==='string' && src.indexOf('s3:')===0){ const {data}=await s3Sign('get',src.slice(3)); src=data&&data.url; }
      if(!src) throw new Error('no audio url');
      const audio=await wtDecode(src);
      const out=await pipe(audio,{chunk_length_s:30,stride_length_s:5,task:'transcribe'});
      const text=(out&&out.text!=null?String(out.text):'').trim();
      await mtgRecCall({action:'save-transcript',log_id:job.log_id,transcript:text,status:'ready'});
    }catch(e){
      // release the job so another browser/attempt can try (claim() gives up after 3 tries)
      try{ await mtgRecCall({action:'save-transcript',log_id:job.log_id,status:'processing'}); }catch(_e){}
    }finally{ WT_busy=false; wtChip(false); again(3000); }
  }
  // TURNED OFF. Recordings are transcribed server-side by GEMINI (the transcribe-pending function,
  // which runs on its own every couple of minutes) — the same engine the Transcription module uses.
  // Gemini is markedly better on the Bengali/Hindi/English code-switching in these meetings than the
  // small in-browser Whisper model was, and it doesn't need anyone to leave a desktop browser open.
  // Both paths claim from the same queue, so leaving this running would race Gemini and sometimes
  // win with the worse transcript. The worker code above is left in place as a fallback should the
  // Gemini key ever be withdrawn.
  function mtgStartBrowserTranscriber(){ return; }

  function mtgRenderOnly(){
    try{ mtgStartBrowserTranscriber(); }catch(e){}
    const b=$('acBody'); if(!b)return;
    // Meetings are open to everyone: anyone can create and run OFFLINE meetings without Google.
    // Online (Google Meet) meetings still need a connected thejaingroup.com Google account — that's
    // enforced in the Schedule form below, instead of locking the whole section for everyone.
    let mtgBanner='';
    if(GOOGLE_CONNECTED!==true){
      const myEmail=me();
      const offDomain=!/@thejaingroup\.com$/i.test(myEmail||'');
      mtgBanner='<div class="mtg-connect-banner"><i class="fa-brands fa-google mcb-ico"></i><div class="mcb-txt">'
        +(offDomain
            ? 'You\'re signed in as <b>'+esc2(myEmail)+'</b>. Online (Google Meet) meetings need a thejaingroup.com Google account — but you can create and run <b>Offline meetings</b> right here.'
            : 'You can create and run <b>Offline meetings</b> right away. Connect Google to also schedule <b>Online</b> meetings with an auto-created Meet link.')
        +'</div>'
        +(offDomain?'':'<button class="mcb-btn" onclick="googleConnect()"><i class="fa-brands fa-google"></i> Connect Google</button>')
        +'</div>';
    }
    const groups=mtgGroupedSections(MTG_GROUP);
    groups.forEach(function(g){ g.items=g.items.slice().sort(function(a,b){return mtgSortKey(a).localeCompare(mtgSortKey(b));}); });
    let body=groups.map(function(g){ const isWeek=/This Week$/.test(g.label); return '<div class="mtg-sec-label">'+esc2(g.label)+'</div>'+g.items.map(function(m){ return mtgCard(m,isWeek?m._weekCount:null); }).join(''); }).join('');
    if(!groups.length) body='<div class="ac-empty" style="cursor:default;border:0">No meetings yet — click <b>Schedule Meeting</b> to add one.</div>';
    b.innerHTML='<div class="mtg-page">'
      +'<div class="mtg-main">'
      +'<div class="mtg-toolbar"><div class="mtg-toolbar-title">Meetings</div>'+mtgGoogleStatusHtml()+'<button class="mtg-create" onclick="mtgOpenCreate()"><i class="fa-solid fa-plus"></i> Schedule Meeting</button></div>'
      +mtgBanner
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
    const byMe=done.filter(t=>isOwner(t)&&!isSelf(t,asg)&&!t.parent_task_id&&t.flow_case_step_id==null);
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
    // Workflow step state (per-task) so rows can show Forward vs Receive/Reject correctly
    window._wfStepInfo={};
    try{
      const wfIds=tasks.filter(function(t){return t.flow_case_step_id!=null;}).map(function(t){return t.flow_case_step_id;});
      if(wfIds.length){
        const {data:steps}=await ACC().from('flow_case_steps').select('id,case_id,seq,received_at,forwarded_at,title').in('id',wfIds);
        const caseIds=Array.from(new Set((steps||[]).map(function(s){return s.case_id;})));
        let allc=[]; if(caseIds.length){ const r=await ACC().from('flow_case_steps').select('case_id,seq,received_at,forwarded_at').in('case_id',caseIds); allc=(r&&r.data)||[]; }
        let casesD=[]; if(caseIds.length){ const r=await ACC().from('flow_cases').select('id,case_no,flow_id,trigger_details').in('id',caseIds); casesD=(r&&r.data)||[]; }
        const caseMap={}; casesD.forEach(function(c){ caseMap[c.id]=c; });
        const flowIds=Array.from(new Set(casesD.map(function(c){return c.flow_id;})));
        let flowsD=[]; if(flowIds.length){ const r=await ACC().from('flows').select('id,name,trigger_event').in('id',flowIds); flowsD=(r&&r.data)||[]; }
        const flowMap={}; flowsD.forEach(function(f){ flowMap[f.id]=f; });
        const bounds={}, bySeq={};
        allc.forEach(function(s){ const bb=bounds[s.case_id]||(bounds[s.case_id]={min:s.seq,max:s.seq}); if(s.seq<bb.min)bb.min=s.seq; if(s.seq>bb.max)bb.max=s.seq; (bySeq[s.case_id]=bySeq[s.case_id]||{})[s.seq]=s; });
        (steps||[]).forEach(function(s){
          const bb=bounds[s.case_id]||{min:s.seq,max:s.seq};
          const c=caseMap[s.case_id]||{}; const f=flowMap[c.flow_id]||{};
          const nextStep=(bySeq[s.case_id]||{})[s.seq+1]||null;
          window._wfStepInfo[s.id]={seq:s.seq,case_id:s.case_id,received_at:s.received_at,forwarded_at:s.forwarded_at,minSeq:bb.min,maxSeq:bb.max,stepTitle:s.title,details:(Array.isArray(c.trigger_details)?c.trigger_details:[]),caseNo:c.case_no,flowName:f.name,triggerEvent:f.trigger_event,nextReceived:!!(nextStep&&nextStep.received_at),nextExists:!!nextStep};
        });
      }
    }catch(e){ window._wfStepInfo={}; }

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
    const byMeArr=tasks.filter(t=>isOwner(t)&&stOf(t)==='open'&&!isSelf(t,asg)&&t.flow_case_step_id==null);
    const awaArr=tasks.filter(t=>isMemb(t,asg)&&stOf(t)==='await');
    const pend=tasks.filter(t=>isOwner(t)&&stOf(t)==='await'&&t.flow_case_step_id==null);

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
    const byMeC=doneWk.filter(t=>isOwner(t)&&!isSelf(t,asg)&&!t.parent_task_id&&t.flow_case_step_id==null);
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
    const wfInfo=(t.flow_case_step_id!=null)?((window._wfStepInfo||{})[t.flow_case_step_id]||null):null;
    const wfReceived=wfInfo&&!!wfInfo.received_at;
    const wfNeedsReceive=wfInfo&&!wfReceived;
    const chk=opt.checkable?(t.flow_case_step_id!=null
      ? (wfNeedsReceive ? ''
         : `<input type="checkbox" class="ac-rowchk" title="Forward to the next person" onclick="event.stopPropagation()" onchange="wfRowForward(${t.flow_case_step_id},this)">`)
      : `<input type="checkbox" class="ac-rowchk" title="${opt.owner?'Mark complete':'Mark done — send for approval'}" onclick="event.stopPropagation()" onchange="accRowCheck(${t.id},${!!opt.owner},this)">`):'';
    const wfIsFirst=wfInfo&&wfInfo.minSeq!=null&&wfInfo.seq===wfInfo.minSeq;
    const wfRR=(opt.checkable&&wfNeedsReceive)?`<div style="display:flex;gap:5px;flex:none" onclick="event.stopPropagation()"><button class="ac-btn ok ic" style="height:30px;width:30px" title="Receive" onclick="wfReceive(${t.flow_case_step_id})"><i class="fa-solid fa-inbox"></i></button>${wfIsFirst?'':`<button class="ac-btn danger ic" style="height:30px;width:30px" title="Reject" onclick="wfRowReject(${t.flow_case_step_id},${wfInfo.case_id},${t.id})"><i class="fa-solid fa-ban"></i></button>`}</div>`:'';
    const hover=opt.approve?` onmouseenter="pendHover(${t.id})" onmouseleave="pendUnhover(${t.id})"`:'';
    const grip=opt.noDrag?'<span class="grip-sp"></span>':'<i class="fa-solid fa-grip-vertical grip" onclick="event.stopPropagation()"></i>';
    const letterHtml='';
    let meta='', doneBadge2='';
    if(opt.showDoneDate){
      // Awaiting Approval rows: only the marked-done date (date icon) + on-time/overdue badge + members.
      const parts=[];
      if(t.completed_at) parts.push(`<span title="Marked done"><i class="fa-regular fa-calendar"></i> ${fmtDate(t.completed_at)}</span>`);
      if(t._projName) parts.push(`<i class="fa-solid fa-diagram-project"></i> ${esc2(t._projName)}`);
      meta=parts.length?`<div class="rtd">${parts.join(' · ')}</div>`:'';
      doneBadge2=dueBadge(t.due_date,t.completed_at);
    } else {
      const metaParts=[t.due_date?`<i class="fa-regular fa-calendar"></i> ${fmtDate(t.due_date)}`:'',t._projName?`<i class="fa-solid fa-diagram-project"></i> ${esc2(t._projName)}`:''].filter(Boolean);
      meta=metaParts.length?`<div class="rtd">${metaParts.join(' · ')}</div>`:'';
    }
    const wfIcon2='';
    const ownerVis=(t.flow_case_step_id!=null)
      ? `<span title="Owner: Workflow" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#1d4ed8;color:#fff;font-size:11px;border:2px solid var(--bg-card)"><i class="fa-solid fa-diagram-project"></i></span>`
      : (emails.length?avatars(list,emails):'');
    const wfDet=(wfInfo&&wfInfo.details)?wfDetailsInline(wfInfo.details):'';
    const wfStepNm=(wfInfo&&wfInfo.stepTitle)?wfTitleCase(wfInfo.stepTitle):'';
    const wfCombined=[wfStepNm,wfDet].filter(Boolean).join(' - ');
    const wfTitle=wfInfo?(esc2(wfCombined)||esc2(t.title)):esc2(t.title);
    return `<div class="ac-row" data-id="${t.id}" onclick="navTo('tasks/task/${t.id}')"${hover}>${chk}${grip}${letterHtml}<div class="ti"><div class="t">${wfIcon2}${wfTitle}</div></div>${wfRR}<div class="rt">${meta}${doneBadge2}${ownerVis}</div>${approve}</div>`;
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
    if(t.flow_case_step_id!=null){ return wfTaskPage(v, t, (aR.data||[]).map(function(r){return r.email;}), list, ro); }
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
    try{ mtgStartBrowserTranscriber(); }catch(e){}
    try{
      const qs=new URLSearchParams(location.search);
      const g=qs.get('google');
      if(g){
        if(g==='ok'){
          toast('Google account connected','ok');
          // Just returned from a successful Google connect. Re-check the connection
          // and repaint the current screen so the Meetings view flips to "Connected"
          // right away — otherwise a render that ran before the connection completed
          // leaves the old "Connect Google" button on screen until a manual refresh.
          (async function(){
            try{ await mtgCheckGoogleConnected(); if(window.PAGE==='tasks' && typeof renderPage==='function') renderPage(); }catch(e){}
          })();
        }
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
