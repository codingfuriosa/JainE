/* ================================ USABILITY ================================
   Which parts of the portal are actually being used, and by whom. Systems and the Administrator
   only — enforced in the database by erp_usability_report(), which refuses anyone else outright;
   everything here is presentation on top of that one call. */
const USB_BANDS=[
  ['Very Active','#15803d','#dcfce7'],
  ['Active',     '#0369a1','#e0f2fe'],
  ['Less',       '#b45309','#fef3c7'],
  ['Inactive',   '#64748b','#f1f5f9']
];
function usbBandStyle(b){ const f=USB_BANDS.find(function(x){return x[0]===b;})||USB_BANDS[3]; return {ink:f[1],bg:f[2]}; }
// Opens on the past 30 days — one of the four fixed presets, no custom entry to fall back to.
const USB={preset:'30d',from:null,to:null,email:'',dept:'',rows:null,people:null};
/* The presets the user asked for, resolved against IST because a "month" is a month where the
   people using this actually are.
   The comment above this used to claim the same range came out "whatever the browser's own
   timezone happens to be set to", and the code underneath it simply read new Date() - which is
   local time, so the claim was only true on an Indian machine. Everywhere else the window slid by
   a day against the server, which counts strictly in IST: someone opening "This Month" on the 1st
   from a machine set behind IST asked for a range that began before the month did. Now the clock
   is actually moved to Kolkata first, and the rest of the maths is unchanged. */
function usbIstNow(){
  // en-US gives "M/D/YYYY, h:mm:ss AM" for this locale, which Date can parse back; the point is
  // only to land on the right calendar day in Kolkata, not to preserve the instant.
  try{ return new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'})); }
  catch(e){ return new Date(); }
}
function usbRange(preset){
  const now=usbIstNow(), y=now.getFullYear(), m=now.getMonth(), d=now.getDate();
  const iso=function(dt){ return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0'); };
  if(preset==='week'){ const dow=(now.getDay()+6)%7; return {from:iso(new Date(y,m,d-dow)), to:iso(now)}; }   // Monday-start
  if(preset==='month'){ return {from:iso(new Date(y,m,1)), to:iso(now)}; }
  if(preset==='prev'){ return {from:iso(new Date(y,m-1,1)), to:iso(new Date(y,m,0))}; }                        // day 0 = last of prev
  return {from:iso(new Date(y,m,d-29)), to:iso(now)};                                                          // past 30 days
}
function usbCurrentRange(){
  if(USB.preset==='custom'&&USB.from&&USB.to) return {from:USB.from,to:USB.to};
  return usbRange(USB.preset);
}
async function usbLoad(){
  const r=usbCurrentRange();
  try{
    const {data,error}=await sb.rpc('erp_usability_report',{p_from:r.from,p_to:r.to,p_email:USB.email||null,p_department:USB.dept||null});
    if(error)throw error;
    USB.rows=data||[];
  }catch(e){ USB.rows=null; USB.err=(e&&e.message)||String(e); }
  /* Workflow health and transcription health used to be fetched here as well. They belong to Daily
     Checks and are drawn only there, but that page used to share this loader, so the Usability page
     was waiting on two round trips for figures it never prints. Daily Checks now loads its own
     three (it refreshes itself every minute, which this loader is not built for), and this one is
     back to fetching the one report the page it serves actually draws. */
  if(!USB.people){ try{ USB.people=await getPeople(); }catch(e){ USB.people=[]; } }
  // A per-feature drill-down cached under the old range/person would show stale names against the
  // new filters, so any change here throws it out rather than risk a misleading answer.
  USB_FEAT_CACHE={}; USB_FEAT_OPEN.clear();
}
let USB_FEAT_CACHE={};
const USB_FEAT_OPEN=new Set();
/* The filter bar had class "inp" on its controls, which is styled NOWHERE in this codebase — so the
   dropdowns rendered as raw browser widgets of differing heights next to properly styled cards. The
   styled select in this app is .sel; these use it, with the rest scoped under .usb- so nothing here
   can leak into another screen. */
const USB_CSS='<style id="usbCss">'
  +'.usb-bar{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-top:14px}'
  +'.usb-xl{margin-left:auto;height:38px;display:inline-flex;align-items:center;gap:8px;white-space:nowrap}'
  +'.usb-f{display:flex;flex-direction:column;gap:5px;min-width:0}'
  +'.usb-f>label{font-size:10.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--slate)}'
  +'.usb-f .sel,.usb-f input[type=date]{height:38px;border:1px solid var(--line);border-radius:9px;padding:0 11px;'
    +'font-size:13px;font-family:inherit;background:#fff;color:#334155;cursor:pointer;transition:border-color .15s,box-shadow .15s}'
  +'.usb-f .sel:focus,.usb-f input[type=date]:focus{outline:none;border-color:#a78bfa;box-shadow:0 0 0 3px rgba(124,58,237,.13)}'
  +'.usb-f .sel:hover,.usb-f input[type=date]:hover{border-color:#c4b5fd}'
  /* The chosen window, pinned right so the eye lands on it after the controls rather than before. */
  +'.usb-range{margin-left:auto;display:flex;align-items:center;gap:8px;height:38px;padding:0 13px;border-radius:9px;'
    +'background:#faf5ff;border:1px solid #e9d5ff;color:#6b21a8;font-size:12.5px;font-weight:600;white-space:nowrap}'
  +'@media(max-width:720px){.usb-range{margin-left:0;width:100%;justify-content:center}.usb-f{flex:1 1 44%}}'
  +'.usb-feat-row{cursor:pointer}'
  +'.usb-feat-row:hover td{background:#faf5ff}'
  +'.usb-feat-chev{color:var(--slate);font-size:10px;margin-right:8px;display:inline-block;width:10px;transition:transform .15s}'
  +'.usb-feat-chev.open{transform:rotate(90deg)}'
  +'.usb-wf-cell{cursor:pointer;user-select:none}'
  +'.usb-wf-cell:hover{background:#fffbeb}'
  +'.usb-wf-cell.open{background:#fffbeb}'
  +'.usb-users-row td{background:#fbfaff;border-top:none;padding:0}'
  +'.usb-users-wrap{padding:4px 14px 12px 34px}'
  +'.usb-user-line{display:flex;justify-content:space-between;gap:14px;padding:6px 0;font-size:12.5px;border-bottom:1px solid #f1eefc}'
  +'.usb-user-line:last-child{border-bottom:none}'
  +'.usb-user-clickable{cursor:pointer;border-radius:6px;padding-left:6px;padding-right:6px;margin:0 -6px}'
  +'.usb-user-clickable:hover{background:#f3effc}'
  +'.usb-user-name{color:var(--ink)}'
  +'.usb-user-meta{color:var(--slate);white-space:nowrap}'
  +'</style>';
/* Linked to the Department filter: once a department is picked, Person narrows down to just that
   department's people — a flat A-Z list, since grouping by department would be pointless when
   there is only one. With no department picked it falls back to one flat list grouped by
   department (a person's first listed one) rather than one A-Z list of the whole company — with
   dozens of names, "who's Reception again?" was the whole problem. Anyone with no department lands
   in one "Unassigned" group at the end, never mixed silently into the rest. */
function usbPersonOptionsHtml(){
  const people=(USB.people||[]).filter(function(p){
    return !USB.dept || (Array.isArray(p.depts) && p.depts.indexOf(USB.dept)!==-1);
  });
  if(USB.dept){
    return people.slice().sort(function(a,b){return String(a.name||a.email).localeCompare(String(b.name||b.email));})
      .map(function(p){ return '<option value="'+esc(p.email)+'"'+(USB.email===p.email?' selected':'')+'>'+esc(p.name||p.email)+'</option>'; }).join('');
  }
  const byDept={};
  people.forEach(function(p){
    const dept=(Array.isArray(p.depts)&&p.depts.length)?p.depts[0]:'Unassigned';
    (byDept[dept]=byDept[dept]||[]).push(p);
  });
  const depts=Object.keys(byDept).sort(function(a,b){
    if(a==='Unassigned')return 1; if(b==='Unassigned')return -1;
    return a.localeCompare(b);
  });
  return depts.map(function(dept){
    const list=byDept[dept].slice().sort(function(a,b){return String(a.name||a.email).localeCompare(String(b.name||b.email));});
    return '<optgroup label="'+esc(dept)+'">'
      +list.map(function(p){ return '<option value="'+esc(p.email)+'"'+(USB.email===p.email?' selected':'')+'>'+esc(p.name||p.email)+'</option>'; }).join('')
    +'</optgroup>';
  }).join('');
}
// Every department any person carries, A-Z. A person's own first-listed department is what
// erp_log_usage stamps onto their events, so this list is deliberately every department seen
// anywhere in USB.people rather than just first-listed ones — the filter should offer everything
// there's a chance of matching.
function usbDeptOptionsHtml(){
  const set=new Set();
  (USB.people||[]).forEach(function(p){ (Array.isArray(p.depts)?p.depts:[]).forEach(function(d){ if(d) set.add(d); }); });
  return Array.from(set).sort(function(a,b){return a.localeCompare(b);})
    .map(function(d){ return '<option value="'+esc(d)+'"'+(USB.dept===d?' selected':'')+'>'+esc(d)+'</option>'; }).join('');
}
function usbControlsHtml(){
  const r=usbCurrentRange();
  const opt=function(v,l){ return '<option value="'+v+'"'+(USB.preset===v?' selected':'')+'>'+esc(l)+'</option>'; };
  /* Always emitted, never guarded behind "is #usbCss already in the DOM?" — every caller sets it via
     v.innerHTML=..., which fully replaces v's subtree (style tag included) on each render. The old
     document.getElementById('usbCss') check read that OUTGOING subtree a moment before it was
     discarded: if a previous render's style tag was still sitting there when this string was built,
     the check saw it as "already present" and skipped re-adding it — then the innerHTML assignment
     destroyed that old tag anyway, leaving the new markup with no style tag at all. That is exactly
     the "styled after a hard reload, stacked and bare after an in-app re-render" bug — a hard reload
     never has a stale tag to see, so it always got the CSS; a filter change or repeat visit within
     the SPA usually did have one, so it usually lost it. */
  return USB_CSS
    +'<div class="card card-pad usb-bar">'
    +'<div class="usb-f"><label for="usbPreset">Period</label>'
      +'<select class="sel" id="usbPreset" onchange="usbSetPreset(this.value)" style="min-width:180px">'
        +opt('week','This Week')+opt('month','This Month')+opt('prev','Previous Month')+opt('30d','Past 30 Days')+opt('custom','Custom range…')
      +'</select></div>'
    /* Only shown once Custom is actually picked — the four fixed presets need no date fields of
       their own, and showing them unconditionally was the exact clutter that got these removed
       before. Editing either field keeps the dropdown's own "Custom range…" option correctly
       selected, since usbSetCustom sets USB.preset itself. */
    +(USB.preset==='custom'
      ? '<div class="usb-f"><label for="usbFrom">From</label><input type="date" id="usbFrom" value="'+esc(r.from)+'" max="'+esc(r.to)+'" onchange="usbSetCustom()"></div>'
        +'<div class="usb-f"><label for="usbTo">To</label><input type="date" id="usbTo" value="'+esc(r.to)+'" min="'+esc(r.from)+'" onchange="usbSetCustom()"></div>'
      : '')
    +'<div class="usb-f"><label for="usbDept">Department</label>'
      +'<select class="sel" id="usbDept" onchange="usbSetDept(this.value)" style="min-width:170px">'
        +'<option value="">All departments</option>'
        +usbDeptOptionsHtml()
      +'</select></div>'
    +'<div class="usb-f"><label for="usbPerson">Person</label>'
      +'<select class="sel" id="usbPerson" onchange="usbSetPerson(this.value)" style="min-width:220px">'
        +'<option value="">'+(USB.dept?'Everyone in '+esc(USB.dept):'Everyone')+'</option>'
        +usbPersonOptionsHtml()
      +'</select></div>'
    +'<div class="usb-range"><i class="fa-regular fa-calendar"></i> '+esc(fmtDate(r.from))+' &rarr; '+esc(fmtDate(r.to))+'</div>'
    // Only makes sense once the report is already narrowed to one person — "full activity log"
    // for everyone at once would be every event the company generated, not a report anyone reads.
    +(USB.email?'<button class="btn usb-xl" onclick="usbOpenUserActivity()"><i class="fa-solid fa-list-ul"></i> Full Activity Log</button>':'')
    +'<button class="btn btn-primary usb-xl" id="usbXl" onclick="usbExport(this)"><i class="fa-solid fa-file-excel"></i> Extract to Excel</button>'
  +'</div>';
}
window.usbSetPreset=function(v){
  // Switching into Custom starts the two date fields from whatever range was already showing,
  // not blank — the whole point is to nudge an existing window, not start from nothing.
  if(v==='custom'&&!(USB.from&&USB.to)){ const r=usbRange(USB.preset); USB.from=r.from; USB.to=r.to; }
  USB.preset=v; renderPage();
};
window.usbSetCustom=function(){ const f=$('usbFrom'),t=$('usbTo'); if(f&&t&&f.value&&t.value){ USB.from=f.value; USB.to=t.value; USB.preset='custom'; renderPage(); } };
// Person is linked to Department, not a separate filter beside it: picking someone fills in their
// own department too (so the two never disagree), and picking a department narrows the Person list
// down to that department's people, dropping whoever was picked if they no longer belong to it.
window.usbSetPerson=function(v){
  USB.email=v||'';
  if(v){
    const p=(USB.people||[]).find(function(x){return x.email===v;});
    USB.dept=(p&&Array.isArray(p.depts)&&p.depts.length)?p.depts[0]:'';
  }
  renderPage();
};
window.usbSetDept=function(v){
  USB.dept=v||'';
  if(v && USB.email){
    const p=(USB.people||[]).find(function(x){return x.email===USB.email;});
    if(!(p&&Array.isArray(p.depts)&&p.depts.indexOf(v)!==-1)) USB.email='';
  }
  renderPage();
};
/* ---- Extract to Excel -------------------------------------------------------------------
   A real .xlsx, not a CSV renamed - so it opens with the header frozen and filterable, the counts
   as numbers that actually sum, the date as a date, and each feature's activity in the same colour
   it wears on screen. A CSV would have been three lines of code and would have arrived as grey
   text needing to be formatted by hand every single time.
   The library is fetched only when the button is pressed. In the page head it would have made all
   thirty-odd pages carry 270KB for one button on one screen. It comes from jsdelivr, which the app
   already depends on for Supabase and Chart.js, so it is not a new host to trust - and if it cannot
   be reached the export falls back to CSV and says so rather than failing silently. */
function usbLoadXlsx(){
  if(window.ExcelJS) return Promise.resolve(true);
  if(window._usbXlP) return window._usbXlP;
  window._usbXlP=new Promise(function(res){
    const el=document.createElement('script');
    el.src='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    el.onload=function(){ res(!!window.ExcelJS); };
    el.onerror=function(){ window._usbXlP=null; res(false); };   // cleared, so a later click retries
    document.head.appendChild(el);
  });
  return window._usbXlP;
}
// the four activity bands in the same colours the screen uses: [ink, fill]
const USB_XL_BAND={'Very Active':['FF166534','FFDCFCE7'],'Active':['FF0369A1','FFE0F2FE'],
                   'Less':['FFB45309','FFFEF3C7'],'Inactive':['FF64748B','FFF1F5F9']};
function usbExportName(r){
  return 'Usability '+r.from+' to '+r.to+(USB.email?(' - '+USB.email.split('@')[0]):(USB.dept?(' - '+USB.dept):''));
}
function usbSaveBlob(blob,name){
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); },2000);
}
/* Only reached if the library could not be loaded. Same rows, same order, no formatting - and the
   toast says why, so nobody is left wondering why this one came out plain. */
function usbExportCsv(rows,r,who){
  const q=function(v){ v=(v==null?'':String(v)); return /[",\n]/.test(v)?('"'+v.replace(/"/g,'""')+'"'):v; };
  const out=[['Portal Usability'],[fmtDate(r.from)+' to '+fmtDate(r.to),who],[],
    ['Module','Tab','Feature','Uses','People','Last used','Activity']];
  rows.forEach(function(x){ out.push([x.module_label||x.module_id||'',x.tab||'',x.feature||'',
    Number(x.uses||0),Number(x.users||0),
    x.last_used?fmtDate(String(x.last_used).slice(0,10)):'',x.band||'Inactive']); });
  usbSaveBlob(new Blob(['﻿'+out.map(function(l){return l.map(q).join(',');}).join('\r\n')],
    {type:'text/csv;charset=utf-8'}), usbExportName(r)+'.csv');
  toast('Could not reach the spreadsheet library - exported as a plain CSV instead','warn');
}
window.usbExport=async function(btn){
  const rows=(USB.rows||[]).slice();
  if(!rows.length){ toast('Nothing to extract for this period','warn'); return; }
  const r=usbCurrentRange();
  const who=USB.email
    ? (((USB.people||[]).find(function(p){return p.email===USB.email;})||{}).name||USB.email)
    : 'Everyone';
  const restore=btn?btn.innerHTML:'';
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Preparing…'; }
  try{
    if(!(await usbLoadXlsx())){ usbExportCsv(rows,r,who); return; }

    const wb=new ExcelJS.Workbook();
    wb.creator='JAIN-E'; wb.created=new Date();

    /* Sheet 1 - every feature. Freezing four rows keeps the title, the range line and the header
       on screen while scrolling, which is the difference between a sheet you can read and one you
       get lost in at row 300. */
    const ws=wb.addWorksheet('Features',{views:[{state:'frozen',ySplit:4}]});
    ws.columns=[{width:22},{width:20},{width:42},{width:9},{width:9},{width:15},{width:14}];
    ws.mergeCells('A1:G1');
    ws.getCell('A1').value='Portal Usability';
    ws.getCell('A1').font={size:16,bold:true,color:{argb:'FF5B21B6'}};
    ws.getRow(1).height=26;
    ws.mergeCells('A2:G2');
    ws.getCell('A2').value=fmtDate(r.from)+'  →  '+fmtDate(r.to)
      +'      ·      '+who
      +'      ·      '+rows.length+' features'
      +'      ·      '+rows.reduce(function(a,x){return a+Number(x.uses||0);},0)+' uses';
    ws.getCell('A2').font={size:11,color:{argb:'FF64748B'}};

    const head=ws.getRow(4);
    head.values=['Module','Tab','Feature','Uses','People','Last used','Activity'];
    head.height=22;
    head.eachCell(function(c){
      c.font={bold:true,color:{argb:'FFFFFFFF'},size:11};
      c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF7C3AED'}};
      c.alignment={vertical:'middle',horizontal:'left'};
    });

    rows.forEach(function(x,i){
      const row=ws.addRow([x.module_label||x.module_id||'', x.tab||'', x.feature||'',
        Number(x.uses||0), Number(x.users||0),
        x.last_used?new Date(x.last_used):null, x.band||'Inactive']);
      if(i%2) row.eachCell(function(c){ c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFAFAFC'}}; });
      row.getCell(4).numFmt='#,##0';
      row.getCell(5).numFmt='#,##0';
      row.getCell(6).numFmt='dd mmm yyyy';
      const b=USB_XL_BAND[x.band]||USB_XL_BAND.Inactive;
      const bc=row.getCell(7);
      bc.font={bold:true,color:{argb:b[0]},size:10};
      bc.fill={type:'pattern',pattern:'solid',fgColor:{argb:b[1]}};
      bc.alignment={horizontal:'center'};
    });
    // filter set on the header, so whoever opens it can slice by module or band without setting up
    ws.autoFilter={from:{row:4,column:1},to:{row:4+rows.length,column:7}};

    /* Sheet 2 - the same numbers rolled up per module, because "which module is actually being
       used" is the question this report gets opened to answer, and totting that up by hand off two
       hundred rows is exactly the work an export is supposed to remove. */
    const by={};
    rows.forEach(function(x){
      const k=x.module_label||x.module_id||'(none)';
      const m=by[k]||(by[k]={features:0,used:0,uses:0,people:0});
      m.features++; m.uses+=Number(x.uses||0);
      if(Number(x.uses||0)>0) m.used++;
      m.people=Math.max(m.people,Number(x.users||0));
    });
    const ms=wb.addWorksheet('By module',{views:[{state:'frozen',ySplit:1}]});
    ms.columns=[{width:26},{width:12},{width:12},{width:10},{width:14}];
    const mh=ms.getRow(1);
    mh.values=['Module','Features','Used','Uses','Most people'];
    mh.height=22;
    mh.eachCell(function(c){
      c.font={bold:true,color:{argb:'FFFFFFFF'},size:11};
      c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF7C3AED'}};
      c.alignment={vertical:'middle'};
    });
    Object.keys(by).sort(function(a,b){ return by[b].uses-by[a].uses || a.localeCompare(b); })
      .forEach(function(k){
        const m=by[k];
        const row=ms.addRow([k,m.features,m.used,m.uses,m.people]);
        row.getCell(4).numFmt='#,##0';
        // a module nobody has touched is the finding, not a gap - so it is marked, not left blank
        if(!m.used) row.eachCell(function(c){ c.font={color:{argb:'FF94A3B8'},italic:true}; });
      });

    const buf=await wb.xlsx.writeBuffer();
    usbSaveBlob(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),
      usbExportName(r)+'.xlsx');
    toast('Extracted '+rows.length+' features to Excel','ok');
  }catch(e){
    try{ console.error('usbExport',e); }catch(_e){}
    toast('Could not build the spreadsheet: '+((e&&e.message)||e),'err');
  }finally{ if(btn){ btn.disabled=false; btn.innerHTML=restore; } }
};

// One bar showing how a set of features splits across the four bands.
function usbBandBar(rows){
  const total=rows.length||1;
  return '<div style="display:flex;height:8px;border-radius:5px;overflow:hidden;background:#f1f5f9">'
    +USB_BANDS.map(function(b){
        const n=rows.filter(function(r){return r.band===b[0];}).length;
        return n?'<div title="'+esc(b[0]+': '+n)+'" style="width:'+(n*100/total)+'%;background:'+b[1]+'"></div>':'';
      }).join('')
  +'</div>';
}
function usbBandChips(rows){
  return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">'
    +USB_BANDS.map(function(b){
        const n=rows.filter(function(r){return r.band===b[0];}).length;
        const s=usbBandStyle(b[0]);
        return '<span class="badge" style="background:'+s.bg+';color:'+s.ink+'">'+esc(b[0])+' '+n+'</span>';
      }).join('')
  +'</div>';
}
function usbModuleGridHtml(){
  const rows=USB.rows||[];
  const by={};
  rows.forEach(function(r){ (by[r.module_id]=by[r.module_id]||{label:r.module_label,rows:[]}).rows.push(r); });
  const mods=Object.keys(by).sort(function(a,b){ return by[a].label.localeCompare(by[b].label); });
  if(!mods.length)return '<div class="card card-pad empty" style="margin-top:16px;padding:40px"><i class="fa-solid fa-chart-simple"></i><div>No features registered yet</div></div>';
  return '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-top:16px">'
    +mods.map(function(id){
      const g=by[id], uses=g.rows.reduce(function(a,r){return a+Number(r.uses||0);},0);
      const used=g.rows.filter(function(r){return Number(r.uses||0)>0;}).length;
      return '<div class="card card-pad" style="cursor:pointer" onclick="navTo(\'usability/'+encodeURIComponent(id)+'\')">'
        +'<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">'
          +'<div style="font-weight:700;font-size:14px">'+esc(g.label)+'</div>'
          +'<div style="font-size:18px;font-weight:800;color:'+(uses?'#0f766e':'var(--slate)')+'">'+uses.toLocaleString('en-IN')+'</div>'
        +'</div>'
        +'<div style="font-size:12px;color:var(--slate);margin:2px 0 10px">'+used+' of '+g.rows.length+' features used · '+uses.toLocaleString('en-IN')+' use'+(uses===1?'':'s')+'</div>'
        +usbBandBar(g.rows)+usbBandChips(g.rows)
      +'</div>';
    }).join('')
  +'</div>';
}
function usbModuleDetailHtml(moduleId){
  const rows=(USB.rows||[]).filter(function(r){return String(r.module_id)===String(moduleId);});
  if(!rows.length)return '<div class="card card-pad empty" style="margin-top:16px;padding:40px"><i class="fa-solid fa-triangle-exclamation"></i><div>Module not found</div><button class="btn btn-sm" style="margin-top:12px" onclick="navTo(\'usability\')">Back</button></div>';
  const label=rows[0].module_label;
  const tabs=[]; rows.forEach(function(r){ if(tabs.indexOf(r.tab)===-1)tabs.push(r.tab); });
  const head='<div class="page-head" style="padding:0 0 10px"><div><h1 style="font-size:17px"><i class="fa-solid fa-chart-simple" style="color:#7c3aed"></i> '+esc(label)+'</h1>'
    +'<p>'+rows.length+' features across '+tabs.length+' tab'+(tabs.length===1?'':'s')+'</p></div>'
    +'<button class="btn btn-sm" onclick="goBack(\'usability\')"><i class="fa-solid fa-arrow-left"></i> All modules</button></div>';
  const body=tabs.map(function(tb){
    const list=rows.filter(function(r){return r.tab===tb;});
    return '<div class="card" style="margin-bottom:14px">'
      +'<div class="card-pad" style="padding-bottom:8px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'
        +'<div class="sec-title" style="margin:0"><i class="fa-solid fa-folder-open" style="color:#7c3aed"></i> '+esc(tb)+'</div>'
        +'<div style="font-size:12px;color:var(--slate)">'+list.reduce(function(a,r){return a+Number(r.uses||0);},0).toLocaleString('en-IN')+' uses</div>'
      +'</div></div>'
      +'<div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr>'
        +'<th>Feature</th><th style="width:90px">Uses</th><th style="width:90px">People</th><th style="width:130px">Last used</th><th style="width:120px">Activity</th>'
      +'</tr></thead><tbody>'
      +list.map(function(r){
          const s=usbBandStyle(r.band);
          const open=USB_FEAT_OPEN.has(r.feature_key);
          const clickable=Number(r.uses||0)>0;   // nobody used it — nothing to expand into
          const chev=clickable?'<span class="usb-feat-chev'+(open?' open':'')+'"><i class="fa-solid fa-chevron-right"></i></span>':'<span class="usb-feat-chev" style="visibility:hidden"><i class="fa-solid fa-chevron-right"></i></span>';
          const row='<tr class="'+(clickable?'usb-feat-row':'')+'"'+(clickable?' onclick="usbToggleFeature(\''+escJs(r.feature_key)+'\')"':'')+'>'
            +'<td>'+chev+esc(r.feature)+'</td>'
            +'<td><b>'+Number(r.uses||0).toLocaleString('en-IN')+'</b></td>'
            +'<td>'+Number(r.users||0)+'</td>'
            +'<td style="color:var(--slate);font-size:12px">'+(r.last_used?esc(fmtDate(r.last_used)):'—')+'</td>'
            +'<td><span class="badge" style="background:'+s.bg+';color:'+s.ink+';white-space:nowrap">'+esc(r.band)+'</span></td></tr>';
          return row+(open?usbFeatureUsersRowHtml(r):'');
        }).join('')
      +'</tbody></table></div></div>';
  }).join('');
  return head+usbControlsHtml()+body;
}
