/* ============================ LEGAL MIS ============================ */
/* Hearing-date window. Filters the table by Next Date and is what the causelist export
   uses — the export refuses to run on "All dates", since a causelist is by definition
   for a period. */
// [value, label, icon] — a native <select> can't carry icons, so this feeds a custom menu.
const MIS_RANGES=[
  ['all','All dates','fa-infinity'],
  ['this_month','This Month','fa-calendar-day'],
  ['next_month','Next Month','fa-calendar-plus'],
  ['next_week','Next Week','fa-calendar-week'],
  ['next_30','Next 30 Days','fa-calendar-days'],
  ['custom','Custom','fa-sliders']
];
function misRangeDef(v){ return MIS_RANGES.filter(function(r){return r[0]===(v||MIS_RANGE);})[0]||MIS_RANGES[0]; }
let MIS_RANGE='all', MIS_FROM='', MIS_TO='';
function misDay(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function misAddDays(d,n){ const x=new Date(d.getTime()); x.setDate(x.getDate()+n); return x; }
// Weeks run Monday to Sunday, matching how the courts list them.
function misMonday(d){ const x=new Date(d.getTime()); x.setDate(x.getDate()-((x.getDay()+6)%7)); return x; }
function misRangeDates(){
  const t=new Date(); t.setHours(12,0,0,0);
  switch(MIS_RANGE){
    case 'this_month':  return {from:misDay(new Date(t.getFullYear(),t.getMonth(),1)),   to:misDay(new Date(t.getFullYear(),t.getMonth()+1,0))};
    case 'next_month':  return {from:misDay(new Date(t.getFullYear(),t.getMonth()+1,1)), to:misDay(new Date(t.getFullYear(),t.getMonth()+2,0))};
    case 'next_week':   { const m=misAddDays(misMonday(t),7); return {from:misDay(m), to:misDay(misAddDays(m,6))}; }
    case 'next_30':     return {from:misDay(t), to:misDay(misAddDays(t,30))};
    case 'custom':      return (MIS_FROM&&MIS_TO)?{from:MIS_FROM,to:MIS_TO}:null;
    default:            return null;
  }
}
function misRangeLabel(){
  const r=misRangeDates(); if(!r) return '';
  const f=s=>{const d=new Date(s+'T00:00:00');return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();};
  return f(r.from)+' – '+f(r.to);
}
window.misSetRange=function(v){
  MIS_RANGE=v;
  if(v==='custom'&&(!MIS_FROM||!MIS_TO)){ const t=new Date(); MIS_FROM=misDay(t); MIS_TO=misDay(misAddDays(t,30)); }
  legalMIS();
};
// Custom date-range menu. Replaces the plain <select> so each period can carry its own icon and
// the active one can be ticked — neither is possible inside a native dropdown.
window.misRangeToggle=function(){
  const w=$('misRangeMenu'); if(!w) return;
  w.classList.toggle('open');
  if(w.classList.contains('open') && !window._misRangeWired){
    window._misRangeWired=true;
    document.addEventListener('click',function(e){
      const m=$('misRangeMenu');
      if(m && !m.contains(e.target)) m.classList.remove('open');
    });
  }
};
window.misRangePick=function(v){ const m=$('misRangeMenu'); if(m)m.classList.remove('open'); misSetRange(v); };
// To can never be earlier than From. Picking a From date raises To's floor, and clears a To that
// has just become impossible rather than leaving a backwards range sitting there.
window.misDateFromChange=function(){
  const f=$('misFrom'), t=$('misTo'); if(!f||!t) return;
  t.min=f.value||'';
  if(f.value && t.value && t.value<f.value){ t.value=''; toast('To date cleared — it was before the From date','warn'); }
  misFilter();
};
window.misDateToChange=function(){
  const f=$('misFrom'), t=$('misTo'); if(!f||!t) return;
  if(f.value && t.value && t.value<f.value){ t.value=f.value; toast('To date cannot be before the From date','warn'); }
  misFilter();
};
// A row's hearing date, preferring the sortable copy and falling back to parsing the text.
function misRowIso(r){
  if(r.next_date_iso) return String(r.next_date_iso).slice(0,10);
  const d=misToIso(r.next_date); return d?misIsoStr(d):null;
}
function misInRange(r){
  const w=misRangeDates(); if(!w) return true;
  const iso=misRowIso(r);
  // A case with no date is BETWEEN actions — the last one was executed and the next has not been
  // set yet. It has to stay on screen, otherwise executing an action makes the case disappear and
  // there is no way back to it to add the next one. Only the causelist wants dated cases only.
  if(!iso) return true;
  return iso>=w.from && iso<=w.to;
}
/* THE CAUSELIST IS A LIST OF HEARINGS, so the date it lists a matter under is the case's own
   NEXT DATE - the day it is next before the court - and not the Action Date, which is an
   internal commitment about when somebody here will do something about it.

   It used the Action Date for both, and the two are not the same day. Money Suit 59/2018 is
   listed on 11/09/2026 and carries an action date of 03/07/2026: the causelist dated it July
   and left it off September's altogether. Two matters - WBRERA/COM/000800/2024 and A.P. No.
   206/2025 - have a hearing date and no action date at all, so they appeared on no causelist
   ever, which is how this came to light.

   The Action Date remains the right date everywhere else: the Calendar, the Scoreboard and the
   pinned rows are about what this office has undertaken to do, not about court listings. So
   this is a separate reading, used by the causelist alone; a case with no hearing date of its
   own still falls back to the action date rather than vanishing. */
function misHearingIso(r){
  if(r.case_next_date_iso) return String(r.case_next_date_iso).slice(0,10);
  const c=misToIso(r.case_next_date); if(c) return misIsoStr(c);
  return misRowIso(r);
}
// The causelist wants a real date on every row, and it wants the HEARING date.
function misInRangeDated(r){
  const iso=misHearingIso(r); if(!iso) return false;
  const w=misRangeDates(); if(!w) return true;
  return iso>=w.from && iso<=w.to;
}

const MIS_FIELDS=[
  {k:'case_type',l:'Case Type'},
  {k:'cause_title',l:'Cause Title / Parties'},
  {k:'case_no',l:'Case No.'},
  {k:'previous_date',l:'Previous Date'},
  {k:'case_next_date',l:'Next Date'},
  {k:'next_date',l:'Action Date'},
  {k:'priority',l:'Priority'},
  {k:'advocate_incharge',l:'Advocate In-Charge'},
  {k:'court',l:'Court'},
  {k:'status',l:'Status / Purpose'},
  {k:'action_needed',l:'Action Needed'},
  {k:'action_executed_date',l:'Action Executed'},
  {k:'remarks',l:'Remarks'},
  {k:'project_land_name',l:'Project / Land'},
  {k:'date_of_filing',l:'Date of Filing'},
  {k:'pc_in_charge',l:'PC In-Charge'},
  {k:'file_no',l:'File No.'},
  {k:'cnr_no',l:'CNR No.'}
];
function misLabel(k){const f=MIS_FIELDS.find(x=>x.k===k);return f?f.l:k;}

/* Fields offering a dropdown of what's already in use while still accepting a new value.
   A <datalist> gives both: pick from the list, or type something new — and because the new
   value is saved onto the row, it is in the list automatically next time. No extra table. */
const MIS_SUGGEST=new Set(['case_type','project_land_name','pc_in_charge']);
const MIS_PC_DEFAULT='ANKITA BHANDARI';
function misDistinct(k){
  const seen=new Map();
  (window._misRows||[]).forEach(r=>{ const v=String(r[k]==null?'':r[k]).trim(); if(!v)return;
    const key=v.toLowerCase(); if(!seen.has(key)) seen.set(key,v); });
  return [...seen.values()].sort((a,b)=>a.localeCompare(b));
}
// The level most cases already sit at — pre-selected on a new case, still changeable.
function misCommonPriority(){
  const c={High:0,Medium:0,Low:0};
  (window._misRows||[]).forEach(r=>{ const p=String(r.priority||'').trim(); if(c[p]!==undefined)c[p]++; });
  return (c.High>=c.Medium&&c.High>=c.Low)?'High':(c.Medium>=c.Low?'Medium':'Low');
}
// Guidance sits in an (i) beside the label rather than as grey text under the field, so the
// form stays compact and the rows line up.
function misTip(text){
  if(!text) return '';
  return '<span class="mis-tip" tabindex="0" role="button" aria-label="More information" data-tip="'+esc(text)+'">i</span>';
}
function misInput(k,vals,opt){
  opt=opt||{};
  const v=(vals||{})[k]||'';
  const ro=opt.readonly?' readonly style="background:var(--bg,#f8fafc);color:var(--slate)"':'';
  const lab='<label>'+misLabel(k)+misTip(opt.hint)+'</label>';
  if(k==='priority'){
    const cur=v||opt.dflt||'';
    return '<div>'+lab+'<select id="misF_'+k+'" class="sel">'
      +['High','Medium','Low'].map(p=>'<option value="'+p+'"'+(String(cur).toLowerCase()===p.toLowerCase()?' selected':'')+'>'+p+'</option>').join('')
      +'</select></div>';
  }
  if(k==='next_date'||k==='case_next_date'){
    // A real date picker, not the flexible free-text dates used elsewhere — this is the one
    // place a date is picked rather than typed, so there's no ambiguous format to parse. Its
    // value is already ISO, which misToIso reads just as well as the typed dd/mm/yyyy forms.
    return '<div>'+lab+'<input type="date" id="misF_'+k+'" class="sel" value="'+esc(v)+'"'+ro+'></div>';
  }
  if(MIS_SUGGEST.has(k)){
    // A real dropdown that also accepts a new value: the list opens on click and filters as you
    // type. A bare <datalist> only opens once you start typing, which hid the existing values.
    const opts=misDistinct(k);
    return '<div class="mis-combo" data-k="'+k+'">'+lab
      +'<div class="mis-combo-wrap">'
        +'<input id="misF_'+k+'" class="sel" autocomplete="off" value="'+esc(v||opt.dflt||'')+'"'+ro
          +' onfocus="misComboOpen(this)" oninput="misComboOpen(this)" onclick="misComboOpen(this)">'
        +'<i class="fa-solid fa-chevron-down mis-combo-caret" onclick="misComboToggle(this)"></i>'
        +'<div class="mis-combo-list">'+opts.map(x=>'<div class="mis-combo-opt" data-v="'+esc(x)+'" onmousedown="misComboPick(this)">'+esc(x)+'</div>').join('')
          +(opts.length?'':'<div class="mis-combo-none">Nothing recorded yet — just type</div>')+'</div>'
      +'</div></div>';
  }
  return '<div>'+lab+'<input id="misF_'+k+'" class="sel" value="'+esc(v)+'"'+ro+'></div>';
}
window.misComboOpen=function(inp){
  const box=inp.closest('.mis-combo'); if(!box)return;
  document.querySelectorAll('.mis-combo.open').forEach(function(x){ if(x!==box) x.classList.remove('open'); });
  box.classList.add('open');
  const q=(inp.value||'').toLowerCase();
  box.querySelectorAll('.mis-combo-opt').forEach(function(o){
    o.style.display=(!q||o.dataset.v.toLowerCase().includes(q))?'':'none';
  });
};
window.misComboToggle=function(ic){
  const box=ic.closest('.mis-combo'); if(!box)return;
  const wasOpen=box.classList.contains('open');
  document.querySelectorAll('.mis-combo.open').forEach(function(x){x.classList.remove('open');});
  if(!wasOpen){ box.classList.add('open');
    box.querySelectorAll('.mis-combo-opt').forEach(function(o){o.style.display='';});
    const inp=box.querySelector('input'); if(inp) try{inp.focus();}catch(e){} }
};
window.misComboPick=function(el){
  const box=el.closest('.mis-combo'); if(!box)return;
  const inp=box.querySelector('input'); if(inp) inp.value=el.dataset.v||'';
  box.classList.remove('open');
};
if(!window._misComboWired){ window._misComboWired=true;
  document.addEventListener('click',function(e){
    if(!(e.target&&e.target.closest&&e.target.closest('.mis-combo')))
      document.querySelectorAll('.mis-combo.open').forEach(function(x){x.classList.remove('open');});
  });
}
function misArea(k,vals,rows){
  // Remarks accumulate. The box is left empty so what you type is ADDED to what is already there
  // (comma separated); the existing text is shown underneath rather than sitting in the box where
  // it is easy to overwrite by accident.
  if(k==='remarks'){
    const cur=String((vals||{}).remarks||'').trim();
    return '<div style="margin-bottom:14px"><label>Remarks'+misTip('Whatever you type is added to the existing remarks, separated by a comma. Nothing is replaced.')+'</label>'
      +'<textarea id="misF_remarks" class="sel" rows="'+(rows||2)+'" placeholder="'+(cur?'Add another remark…':'Add a remark…')+'"></textarea>'
      +(cur?('<div style="font-size:12px;color:var(--slate);margin-top:6px;line-height:1.5"><b>So far:</b> '+esc(cur)+'</div>'):'')
    +'</div>';
  }
  return '<div style="margin-bottom:14px"><label>'+misLabel(k)+'</label><textarea id="misF_'+k+'" class="sel" rows="'+(rows||3)+'">'+esc((vals||{})[k]||'')+'</textarea></div>';
}
const MIS_AREA_FIELDS=new Set(['cause_title','status','remarks','action_needed']);

/* mode 'add'  — Previous Date is not shown at all; it only ever comes from a real reschedule.
   mode 'edit' — Status and Next Date come first because they are what actually get changed,
                 and Previous Date is read-only: it fills itself from the old Next Date the
                 moment Next Date is edited. */
function misFormHtml(vals,mode){
  vals=vals||{}; mode=mode||'add';
  const isEdit=(mode==='edit');
  let html='', pending=null;
  function flush(){ if(pending!==null){ html+='<div class="two">'+pending+'</div>'; pending=null; } }
  function put(k,opt){
    if(MIS_AREA_FIELDS.has(k)){ flush(); html+=misArea(k,vals,k==='cause_title'?2:3); return; }
    const cell=misInput(k,vals,opt);
    if(pending===null) pending=cell;
    else { html+='<div class="two">'+pending+cell+'</div>'; pending=null; }
  }
  const done=new Set();
  if(isEdit){
    // The three things that actually change on an open case. The Action Date and Previous Date are
    // not here at all — they are moved by executing an action, not by hand.
    html+='<div class="mis-prio-head"><i class="fa-solid fa-bolt"></i> Usually updated</div>';
    put('priority',{dflt:misCommonPriority()});       done.add('priority');
    put('status');                                    done.add('status');
    flush();
    put('remarks');                                   done.add('remarks');
    html+='<div class="mis-prio-head" style="margin-top:6px"><i class="fa-solid fa-list"></i> Case details</div>';
  }
  MIS_FIELDS.forEach(f=>{
    if(done.has(f.k)) return;
    /* Previous Date never appears here — it only ever comes from a real reschedule, moved by the
       action panel. The Action Date field (internally next_date) is different: a brand-new case
       can already have a hearing date on hand (e.g. straight off a court notice), so Add Case lets
       it be entered up front. On an EXISTING case, though, it keeps coming from the action panel
       only, to stay in step with Previous Date and the action history. Next Date (case_next_date)
       is a separate, independent date — always editable on both Add and Edit, never touched by the
       action panel. */
    if(f.k==='previous_date') return;
    if(f.k==='next_date'&&isEdit) return;
    // The action fields live in their own panel (click a case), not in the case record forms.
    if(f.k==='action_needed'||f.k==='action_date'||f.k==='action_executed_date') return;
    // No (i) tooltips on the Add Case form — they only appear when editing.
    if(f.k==='priority')     return put(f.k,{dflt:misCommonPriority()});
    if(f.k==='pc_in_charge') return put(f.k,{dflt:isEdit?'':MIS_PC_DEFAULT,hint:isEdit?'left blank saves as NA':''});
    put(f.k);
  });
  flush();
  return html;
}
function misTrunc(s,n){s=String(s==null?'':s).replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'…':s;}
function misPriorityTag(p){
  const s=String(p||'').toLowerCase();
  let cls='t-gray',label=p||'—';
  if(s.indexOf('high')===0){cls='t-red';}
  else if(s.indexOf('medium')===0){cls='t-amber';}
  else if(s.indexOf('low')===0){cls='t-green';}
  if(!p)return '<span class="mis-ptag mis-ptag--gray">—</span>';
  return '<span class="mis-ptag mis-ptag--'+cls.replace('t-','')+'">'+esc(misTrunc(label,14))+'</span>';
}
const MIS_CLAMP=new Set(['cause_title','court','status','remarks','project_land_name','action_needed']);
const MIS_NOWRAP_TRUNC=new Set(['case_no','advocate_incharge','file_no','cnr_no']);
const MIS_WIDTH={case_type:170,cause_title:240,case_no:160,previous_date:100,case_next_date:100,next_date:100,priority:100,advocate_incharge:150,court:160,status:200,action_needed:200,action_executed_date:120,remarks:180,project_land_name:160,date_of_filing:105,pc_in_charge:120,file_no:130,cnr_no:190};
function misCellHtml(f,r){
  const v=r[f.k];
  if(f.k==='priority')return '<td>'+misPriorityTag(v)+'</td>';
  if(f.k==='case_type')return '<td style="font-weight:600;white-space:nowrap">'+esc(v||'—')+'</td>';
  // An action that is open is the one thing on the row somebody has to act on, so it is the one
  // thing written in full colour rather than the same grey as everything else.
  if(f.k==='action_needed'&&String(v||'').trim())
    return '<td><div class="mis-cell-clamp mis-action-live" title="'+esc(v)+'">'
      +'<i class="fa-solid fa-bolt"></i> '+esc(v)+'</div></td>';
  if(MIS_CLAMP.has(f.k))return '<td><div class="mis-cell-clamp" title="'+esc(v||'')+'">'+esc(v||'—')+'</div></td>';
  if(MIS_NOWRAP_TRUNC.has(f.k))return '<td style="white-space:nowrap;color:var(--slate)" title="'+esc(v||'')+'">'+esc(misTrunc(v,26)||'—')+'</td>';
  return '<td style="white-space:nowrap;color:var(--slate)">'+esc(v||'—')+'</td>';
}
// "Pinned" rows (a parsed, non-past next_date_iso — i.e. currently showing on the Calendar) get a
// dedicated 6-dot grip handle next to the checkbox. Sliding THAT HANDLE left toggles the checkbox
// into a grey, disabled "handled" state (slide again to release it) — a normal click directly on
// the checkbox is a totally separate action (plain bulk-select, unaffected). While grey/handled,
// the row is excluded from the Edit/Delete selection count; a normally-checked row still counts as
// one selected row same as always.
function misRowHtml(r,isPinned){
  // Sliding the 6-dot handle left marks the whole CASE complete. The handle is shown ONLY on pinned
  // rows (a case with an upcoming Action Date). Completing drops the case from the Calendar pins, but
  // it STAYS on the Scoreboard with its accumulated action scores.
  const completed=!!r.completed_at;
  const cbAttrs=completed?'checked disabled':'';
  const cbCls='mis-cb mis-row-cb'+(completed?' mis-handled':'');
  const handle=isPinned?`<i class="fa-solid fa-grip-vertical drag-handle mis-handle" data-id="${r.id}" title="Slide left to mark this case complete"></i>`:'';
  // A live case with no Action Date is between actions — say so rather than leaving it looking blank.
  const awaiting=isPinned&&!completed&&!r.next_date_iso;
  const openAct=isPinned&&!completed&&!!String(r.action_needed||'').trim();
  /* One blue bar, and it marks a date still ahead of us - the cases actually coming up.
     Drawing it on everything pinned put it on all 179 rows, because a case is pinned until it is
     deliberately completed and none had been yet, so the bar carried no information at all.
     No date, or a date already gone by, means no bar. */
  const upcoming=isPinned&&!completed&&!!r.next_date_iso&&String(r.next_date_iso).slice(0,10)>=misIsoStr(new Date());
  /* A case carrying an open action is highlighted outright - a tinted row, not a stripe in the
     margin. Executing an action clears both the action and its date, so the row loses the blue
     bar and goes quiet; that is correct, there is genuinely nothing scheduled any more, but it
     must not sink out of sight. Just-executed cases are lifted to the top of the list instead
     (see the ordering in legalMIS) so the next action can be written straight away. */
  const justDone=isPinned&&!completed&&!openAct&&!!String(r.action_executed_date||'').trim();
  const tip=openAct?'Action open: '+String(r.action_needed).slice(0,60)
    :(justDone?'Action executed '+r.action_executed_date+' — click to write the next one'
    :(awaiting?'Waiting for its next action — click to add one':''));
  return `<tr data-id="${r.id}" class="${isPinned?'mis-pinned':''}${completed?' mis-completed':''}${awaiting?' mis-awaiting':''}${openAct?' mis-open-action':''}${justDone?' mis-just-done':''}" title="${esc(tip)}" style="${upcoming?'border-left:3px solid #1e3a8a':''}${completed?'opacity:.55':''}" onclick="if(!event.target.closest('.mis-cb')&&!event.target.closest('.mis-handle'))misActionPanel(${r.id})">
    <td onclick="event.stopPropagation()" class="mis-cb-cell"><input type="checkbox" class="${cbCls}" data-id="${r.id}" ${cbAttrs} onchange="misRowCheck(this)">${handle}</td>
    ${MIS_FIELDS.map(f=>misCellHtml(f,r)).join('')}
    <td onclick="event.stopPropagation()" class="mis-up-cell">${misUploadBtnHtml(r)}</td>
  </tr>`;
}
/* ---------- Legal documents: the papers filed against a case ----------
   They live in S3 under legal/<SUB-CATEGORY>/<CASE FOLDER>/..., the same Legal Vault root the
   rest of the app uses, and are indexed by mis_case_folders / mis_case_files. The row button
   opens the case's folder to add to it; the toolbar's Documents button opens it to read. */
/* The row button is UPLOAD — it opens the form. The toolbar's Documents button is a different
   thing: it walks you to that case's folder in the Legal Documents tab, where the files actually
   live, rather than showing them in a box of their own. */
function misUploadBtnHtml(r){
  const n=(window._misDocCounts||{})[r.id]||0;
  return '<button class="btn btn-sm mis-upbtn'+(n?' has':'')+'" title="'
    +(n?('Add to the '+n+' document'+(n===1?'':'s')+' filed for this case'):'Upload documents for this case')
    +'" onclick="event.stopPropagation();misDocsOpen('+r.id+')"><i class="fa-solid fa-cloud-arrow-up"></i>'
    +(n?('<span class="mis-upn">'+n+'</span>'):'')+'</button>';
}
// Documents: straight to the folder in the Legal vault.
window.misDocsSel=function(){
  let id=null; window._misSel.forEach(function(x){ id=x; });
  const fid=(window._misDocFolders||{})[id];
  if(fid) navTo('legal/cat/'+fid);
  else toast('No documents folder for this case yet — use the upload button on its row','warn');
};

// The closest case type already on the case — the folder's category defaults to it rather than
// making somebody choose from a list they have to think about.
/* The categories are whatever sits under Litigation in the Legal vault, read fresh — a second
   hardcoded list would drift from the tree and start creating near-duplicate folders, which is
   exactly how the upper-case twins appeared. The list below is only a fallback. */
let MIS_DOC_CATS=['Civil Case Matters','Consumer Matters','Criminal Matters','High Court Matters','RERA Case Matter'];
async function misLoadDocCats(){
  try{
    const {data:root}=await sb.schema('doc').from('folders').select('id')
      .eq('department','Legal').eq('name','Litigation').is('parent_id',null).maybeSingle();
    if(!root) return MIS_DOC_CATS;
    const {data:kids}=await sb.schema('doc').from('folders').select('name')
      .eq('department','Legal').eq('parent_id',root.id).order('name',{ascending:true});
    if(kids&&kids.length) MIS_DOC_CATS=kids.map(function(k){ return k.name; });
  }catch(e){}
  return MIS_DOC_CATS;
}
function misGuessCat(caseType){
  const t=String(caseType||'').toLowerCase();
  if(!t) return MIS_DOC_CATS[0];
  let best=MIS_DOC_CATS[0], score=-1;
  MIS_DOC_CATS.forEach(function(c){
    const words=c.toLowerCase().replace(/\s*matters?\s*$/,'').split(/\s+/).filter(Boolean);
    const s=words.reduce(function(a,w){ return a+(t.indexOf(w)!==-1?w.length:0); },0);
    if(s>score){ score=s; best=c; }
  });
  return score>0?best:MIS_DOC_CATS[0];
}
window.misDocsOpen=async function(caseId){
  const row=(window._misRows||[]).find(function(r){ return r.id===caseId; })||{};
  // `frm` is what styles labels and fields in every other modal — without it the form renders bare.
  /* width, not min-width: min-width sets a floor the panel can be pushed past, so a long file name
     or folder name widened it and the whole panel scrolled sideways. A fixed width with everything
     inside it boxed to 100% keeps it still. */
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-cloud-arrow-up"></i> Upload documents</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm mis-doc-modal"><div class="loader"><div class="spin"></div></div></div>','md');
  let folder=null, files=[];
  await misLoadDocCats();
  try{
    const {data:fo}=await sb.from('mis_case_folders').select('*').eq('case_id',caseId).maybeSingle(); folder=fo||null;
    if(folder){ const {data:fi}=await sb.from('mis_case_files').select('*').eq('folder_id',folder.id).order('file_name',{ascending:true}); files=fi||[]; }
  }catch(e){ toast('Could not load documents: '+((e&&e.message)||e),'err'); }
  const body=document.querySelector('.modal-body'); if(!body)return;
  const title=String(row.cause_title||('Case '+caseId)).replace(/\s+/g,' ').trim();
  const cat=folder?folder.sub_category:misGuessCat(row.case_type);
  const name=folder?folder.folder_name:title;
  /* Existing papers are listed but never removable here — a filed document is part of the record.
     Adding more is always allowed. */
  const listHtml=files.length
    ? '<div class="mis-doclist">'+files.map(function(f){
        const up=!!f.uploaded_at;
        return '<div class="mis-docrow"'+(up?(' onclick="s3OpenSigned(\'s3:'+esc(f.storage_key)+'\',\''+esc(String(f.file_name).split("/").pop().replace(/'/g,""))+'\')"'):'')+'>'
          +'<i class="fa-solid fa-'+(/\.pdf$/i.test(f.file_name)?'file-pdf':'file')+'"></i>'
          +'<span class="mis-docname" title="'+esc(f.file_name)+'">'+esc(f.file_name)+'</span>'
          +'<span class="mis-docsz">'+(f.size_bytes?misBytes(f.size_bytes):'')+'</span>'
          +(up?'<i class="fa-solid fa-arrow-up-right-from-square mis-docgo"></i>':'<span class="mis-docpend">not uploaded</span>')
        +'</div>';
      }).join('')+'</div>'
    : '<div class="empty" style="padding:22px;border:1px dashed var(--line);border-radius:10px;color:var(--slate);text-align:center">No documents filed yet</div>';
  const totalMb=files.reduce(function(a,f){ return a+(Number(f.size_bytes)||0); },0);
  body.innerHTML=
    // where these papers are going, stated once at the top
     '<div class="mis-doc-head">'
      +'<div class="mis-doc-case" title="'+esc(title)+'">'+esc(title)+'</div>'
      +'<div class="mis-doc-path"><i class="fa-solid fa-folder-tree"></i> Legal Documents · Litigation · '
        +'<b id="misDocPathCat">'+esc(cat)+'</b> · <b id="misDocPathName">'+esc(name)+'</b></div>'
     +'</div>'
    +legalRenameWarnHtml()
    +'<div class="dropzone" onclick="document.getElementById(\'misDocInput\').click()">'
      +'<i class="fa-solid fa-cloud-arrow-up"></i><div>Click to choose files</div>'
      +'<div style="font-size:12px;margin-top:4px">PDF, Word, images — several at once</div></div>'
    +'<input type="file" id="misDocInput" class="hidden" multiple onchange="misDocsPick(this,'+caseId+')">'
    +'<div id="misDocProg" class="mis-doc-prog" style="display:none"></div>'
    +'<div class="two" style="margin-top:14px">'
      +'<div><label>Category</label><select id="misDocCat"'+(folder?' disabled':'')+' onchange="misDocPathSync()">'
        +MIS_DOC_CATS.map(function(c){ return '<option value="'+esc(c)+'"'+(c===cat?' selected':'')+'>'+esc(c)+'</option>'; }).join('')
      +'</select></div>'
      +'<div><label>Folder name</label><input id="misDocName" value="'+esc(name)+'"'+(folder?'':' placeholder="Defaults to the case name"')+' oninput="misDocPathSync()"></div>'
    +'</div>'
    +(folder?'<div class="mis-hint">Fixed once the folder exists — everything already filed stays where it is.</div>':'')
    +'<div class="mis-doc-sec"><span>Already filed</span>'
      +(files.length?('<span class="mis-doc-meta">'+files.length+' file'+(files.length===1?'':'s')+' · '+misBytes(totalMb)+'</span>'):'')+'</div>'
    +listHtml
    +(folder?('<div class="mis-doc-foot">'
        +'<span class="mis-hint">Filed papers are part of the record — open to read, not removed here.</span>'
        +'<button class="btn" onclick="closeModal();misOpenDocsFolder('+caseId+')"><i class="fa-solid fa-folder-open"></i> Open in Documents</button>'
      +'</div>'):'');
};
function misBytes(n){ n=Number(n)||0; return n>1048576?((n/1048576).toFixed(1)+' MB'):(n>1024?Math.round(n/1024)+' KB':n+' B'); }
// The path line at the top follows the two fields as they are typed, so where the papers will land
// is visible before anything is uploaded.
window.misDocPathSync=function(){
  const c=$('misDocPathCat'), n=$('misDocPathName');
  if(c&&$('misDocCat')) c.textContent=$('misDocCat').value||'';
  if(n&&$('misDocName')) n.textContent=($('misDocName').value||'').trim()||'—';
};
window.misOpenDocsFolder=function(caseId){
  const fid=(window._misDocFolders||{})[caseId];
  if(fid) navTo('legal/cat/'+fid); else navTo('legal');
};
window.misDocsPick=async function(input,caseId){
  const picked=[].slice.call(input.files||[]); if(!picked.length)return;
  const cat=($('misDocCat')||{}).value||misGuessCat(''), nm=(($('misDocName')||{}).value||'').trim();
  if(!nm){ toast('Give the folder a name','err'); return; }
  const prog=$('misDocProg'); if(prog){ prog.style.display='block'; }
  input.disabled=true;
  const seg=function(s){ return String(s||'').replace(/[^\w.\- ]/g,'-').replace(/\s+/g,'-').replace(/-{2,}/g,'-').replace(/^[-.]+|[-.]+$/g,'')||'x'; };
  const prefix='legal/'+seg(cat)+'/'+seg(nm);
  let folderId=null, docFolderId=null;
  try{
    const {data:ex}=await sb.from('mis_case_folders').select('id,doc_folder_id').eq('case_id',caseId).maybeSingle();
    if(ex){ folderId=ex.id; docFolderId=ex.doc_folder_id||null; }
    else{
      const {data:ins,error}=await sb.from('mis_case_folders')
        .insert({case_id:caseId,sub_category:cat,folder_name:nm,storage_prefix:prefix,created_by:state.email})
        .select('id').single();
      if(error) throw error; folderId=ins.id;
    }
    /* The file has to land in the Legal vault's folder tree as well, or it sits in S3 unseen —
       the Documents tab lists doc.documents, not our index. Build Litigation > category > case
       on the way in if this case has never been filed before. */
    if(!docFolderId){
      const D=()=>sb.schema('doc');
      const findOrAdd=async function(name,parent){
        let q=D().from('folders').select('id').eq('department','Legal').eq('name',name);
        q=(parent==null)?q.is('parent_id',null):q.eq('parent_id',parent);
        const {data:hit}=await q.maybeSingle();
        if(hit) return hit.id;
        const {data:mk,error}=await D().from('folders')
          .insert({department:'Legal',name:name,parent_id:parent,created_by:state.email}).select('id').single();
        if(error) throw error; return mk.id;
      };
      const rootId=await findOrAdd('Litigation',null);
      const catId=await findOrAdd(cat,rootId);
      docFolderId=await findOrAdd(nm,catId);
      await sb.from('mis_case_folders').update({doc_folder_id:docFolderId}).eq('id',folderId);
    }
    let done=0;
    for(const f of picked){
      if(prog) prog.textContent='Uploading '+(done+1)+' of '+picked.length+' — '+f.name;
      const key=prefix+'/'+seg(f.name);
      const {data,error}=await uploadFileToS3(key,f);
      if(error) throw error;
      const storedPath=String(data.path||('s3:'+key));
      await sb.from('mis_case_files').insert({folder_id:folderId,file_name:f.name,
        storage_key:storedPath.replace(/^s3:/,''),store:'s3',
        size_bytes:f.size,content_type:f.type||'application/octet-stream',
        uploaded_at:new Date().toISOString(),created_by:state.email});
      await sb.schema('doc').from('documents').insert({title:f.name,department:'Legal',
        category:'Litigation / '+cat+' / '+nm, folder_id:docFolderId,
        storage_path:storedPath.indexOf('s3:')===0?storedPath:('s3:'+key),
        file_name:f.name,file_size:f.size,file_type:f.type||'application/octet-stream',
        status:'Active',visibility:'Internal',uploaded_by:state.email});
      done++;
    }
    window._misDocFolders[caseId]=docFolderId;
    toast(done+' document'+(done===1?'':'s')+' added','ok');
    window._misDocCounts[caseId]=(window._misDocCounts[caseId]||0)+done;
    closeModal(); legalMIS();
  }catch(e){ toast('Upload failed: '+((e&&e.message)||e),'err'); input.disabled=false; if(prog)prog.style.display='none'; }
};

// Sliding the grip handle left toggles next_date_recorded_at (today's date, or cleared) — feeds
// the Scoreboard score. Mouse AND touch both use pointer events. Scoped to the handle icon only —
// dragging elsewhere on the row does nothing, so a plain click anywhere else still opens Edit.
function misWireSwipe(){
  document.querySelectorAll('#misTbody .mis-handle').forEach(function(handle){
    if(handle._dragWired)return; handle._dragWired=true;
    handle.style.touchAction='pan-y';
    handle.addEventListener('pointerdown',function(e){
      e.stopPropagation();
      const tr=handle.closest('tr'); if(!tr)return;
      const startX=e.clientX,startY=e.clientY;
      let dx=0,armed=false;
      function move(ev){
        dx=ev.clientX-startX; const dy=ev.clientY-startY;
        if(!armed){ if(Math.abs(dx)<8||Math.abs(dx)<Math.abs(dy))return; armed=true; tr.classList.add('mis-swiping'); }
        if(dx<0){ ev.preventDefault(); tr.style.transition='none'; tr.style.transform='translateX('+Math.max(dx,-88)+'px)'; }
      }
      function up(){
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        tr.classList.remove('mis-swiping');
        tr.style.transition='transform .15s'; tr.style.transform='';
        if(armed&&dx<-44) misSwipeToggle(Number(tr.dataset.id));
      }
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',up);
    });
  });
}
window.misSwipeToggle=async function(id){
  const row=(window._misRows||[]).find(r=>r.id===id);
  if(!row)return;
  const nowCompleted=!row.completed_at;
  // A case with an action still open is not finished. Execute (record its Execution Date) or clear
  // that action first — then the case can be completed.
  if(nowCompleted && String(row.action_needed||'').trim()){
    toast('This case still has an action open — "'+String(row.action_needed).slice(0,44)
      +'". Record its Action Execution Date first, then complete the case.','warn');
    return;
  }
  const {error}=await sb.from('mis_cases').update({completed_at:nowCompleted?todayStr():null}).eq('id',id);
  if(error){toast('Could not update: '+error.message,'err');return;}
  row.completed_at=nowCompleted?todayStr():null;
  toast(nowCompleted?'Case completed — off the Calendar and Scoreboard':'Case reopened','ok');
  // Completing changes whether the row is pinned and scored, so re-render the list.
  legalMIS();
};
async function legalMIS(){
  setCrumb(['Legal','MIS']);
  const hAct=$('legalHeadActions');if(hAct)hAct.innerHTML='';
  const body=$('legalBody');if(!body)return;
  loader(body);
  let rows=[];
  try{const {data,error}=await sb.from('mis_cases').select('*').order('id',{ascending:true});if(error)throw error;rows=data||[];}catch(e){toast((e&&e.message)||'Could not load MIS cases','err');}
  window._misRows=rows;
  window._misSel=new Set();
  // Anything this account exported and never finished answering nudges right here, not only
  // silently again at the next login (clrevCheckPending covers that separately) — same claim,
  // just checked on demand instead of only once at boot.
  try{
    const myPending=rows.filter(function(r){ return r.causelist_pending_by===state.email && !clrevAlreadyActioned(r); });
    if(hAct && myPending.length){
      hAct.innerHTML='<button class="btn" style="background:var(--warn-50);border-color:var(--warn);color:#b45309" '
        +'onclick="clrevCheckPending()" title="Reopen the causelist action-review popup"><i class="fa-solid fa-triangle-exclamation"></i> '
        +myPending.length+' matter'+(myPending.length===1?'':'s')+' awaiting your review</button>';
    }
  }catch(e){}
  /* How many papers are filed against each case, so the Documents button knows whether it has
     anything to open and the row can say so at a glance. One small query for the whole table. */
  window._misDocCounts={}; window._misDocFolders={};
  try{
    /* Both reads go out together. mis_case_files is selected with no filter at all - it never
       depended on which folders came back, only on there being some - so waiting for the folder
       list first bought nothing and cost a round trip, about 65ms. The guard below is kept: with no
       folders, byFolder is empty, every lookup misses and the counts stay empty exactly as before,
       so the extra read cannot change what is shown. */
    const [foRes,fiRes]=await Promise.all([
      sb.from('mis_case_folders').select('id,case_id,doc_folder_id'),
      sb.from('mis_case_files').select('folder_id')
    ]);
    const fo=foRes&&foRes.data;
    const byFolder={}; (fo||[]).forEach(function(f){ byFolder[f.id]=f.case_id; if(f.doc_folder_id) window._misDocFolders[f.case_id]=f.doc_folder_id; });
    if((fo||[]).length){
      const fi=fiRes&&fiRes.data;
      (fi||[]).forEach(function(x){ const cid=byFolder[x.folder_id]; if(cid!=null) window._misDocCounts[cid]=(window._misDocCounts[cid]||0)+1; });
    }
  }catch(e){}
  const searchKeys=MIS_FIELDS.map(f=>f.k);
  rows.forEach(r=>{ r._blob=searchKeys.map(k=>String(r[k]||'')).join(' ␟ ').toLowerCase(); });
  /* "Pinned" means the case is still live — it is NOT tied to having a date. Executing an action
     clears the Action Date, and while pinning depended on that date the case dropped out of the
     pinned list the moment its action was executed, losing its handle and reading as finished.
     A case leaves the pinned list one way only: somebody slides the 6-dot handle left.

     Ordering, top to bottom — live work first, then what is coming up:
       1. an action OPEN, soonest date first — a live commitment with a deadline;
       2. just executed, most recent first — the action is done and its date cleared, so this case
          is waiting for somebody to decide the next one. It is the freshest work on the list;
       3. a date today or later, soonest first — the hearings actually approaching;
       4. never actioned, no date — quiet, nothing is running;
       5. a date already gone by, most recent first — dormant.
     Rank 2 exists because executing an action clears the action AND its date, which dropped the
     case straight out of the dated block and left it sitting among 73 dateless rows in the middle
     of the list — handled, and immediately lost. Dates still have to beat plain datelessness, which
     is why rank 4 sits below rank 3: ranking every dateless case above the upcoming ones buried
     this week's hearings under 73 rows of nothing. */
  const todayS=todayStr();
  const misIsoToday=misIsoStr(new Date());
  const isPinnedRow=r=>!r.completed_at;
  const misOpenAction=r=>!!String(r.action_needed||'').trim();
  const misJustDone=r=>!misOpenAction(r)&&!!String(r.action_executed_date||'').trim();
  const misPinRank=r=>{
    if(misOpenAction(r)) return 0;
    if(misJustDone(r)) return 1;                                    // awaiting its next action
    if(!r.next_date_iso) return 3;                                  // never actioned, no date
    return String(r.next_date_iso).slice(0,10)>=misIsoToday?2:4;    // upcoming beats gone-by
  };
  const misPinned=rows.filter(isPinnedRow).sort((x,y)=>{
    const rx=misPinRank(x), ry=misPinRank(y);
    if(rx!==ry) return rx-ry;
    // Just-executed cases order on when they were executed, newest first — they have no next date.
    if(rx===1){
      const ex=misToIso(x.action_executed_date), ey=misToIso(y.action_executed_date);
      const sx=ex?misIsoStr(ex):'', sy=ey?misIsoStr(ey):'';
      return sy.localeCompare(sx);
    }
    const dx=String(x.next_date_iso||'').slice(0,10), dy=String(y.next_date_iso||'').slice(0,10);
    if(!dx&&!dy) return 0;
    if(!dx) return -1;
    if(!dy) return 1;
    // Gone-by dates read newest first — the most recently lapsed matters most.
    return rx===4?dy.localeCompare(dx):dx.localeCompare(dy);
  });
  const misRest=rows.filter(r=>!isPinnedRow(r));
  const misOrdered=misPinned.concat(misRest);
  body.innerHTML=`
    <style>
      .mis-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
      .mis-toolbar .mis-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0}
      .mis-toolbar .mis-filters{display:flex;gap:8px;align-items:center;margin-left:auto;flex:1 1 260px;flex-wrap:wrap;min-width:0}
      /* Every control in this strip is the same height and shape, so the row reads as one piece
         instead of buttons of assorted sizes sitting next to each other. */
      .mis-toolbar .btn{height:36px;padding:0 13px;display:inline-flex;align-items:center;gap:7px;
        border-radius:9px;font-size:13px;font-weight:600;line-height:1;white-space:nowrap;border:1px solid var(--line);
        background:var(--bg-card);color:var(--ink);cursor:pointer;transition:background .12s,border-color .12s,box-shadow .12s}
      .mis-toolbar .btn i{font-size:12px}
      .mis-toolbar .btn:not(:disabled):hover{background:var(--bg-subtle,#f8fafc);border-color:var(--slate)}
      /* A disabled button that only fades out reads as broken. Keep a dashed outline so it is
         clearly a button that is waiting for something (a row to be selected). */
      .mis-toolbar .btn:disabled{cursor:not-allowed;opacity:1;color:var(--slate);
        background:var(--bg-subtle,#f8fafc);border:1px dashed var(--line)}
      .mis-toolbar .btn:disabled i{opacity:.65}
      .mis-toolbar .btn-primary{background:var(--brand);border-color:var(--brand);color:#fff}
      /* Must restate the background: the generic hover rule above has the same specificity, so
         without this the primary button went white on hover with only its border left coloured. */
      .mis-toolbar .btn-primary:not(:disabled):hover{background:var(--brand);border-color:var(--brand);color:#fff;filter:brightness(1.09)}
      .mis-toolbar .btn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--brand-a10)}
      .mis-search-wrap{position:relative;display:flex;align-items:center;flex:1;min-width:0}
      .mis-search-wrap i{position:absolute;left:10px;color:var(--slate);font-size:13px;pointer-events:none}
      .mis-search-wrap input{padding-left:30px;height:36px;width:100%;min-width:0;border:1px solid var(--line);border-radius:8px;font-size:13px;background:var(--bg-card);color:var(--ink)}
      .mis-search-wrap input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
      select.mis-sel{height:36px;padding:0 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:var(--bg-card);color:var(--ink);cursor:pointer;min-width:150px}
      select.mis-sel:focus{outline:none;border-color:var(--brand)}
      .mis-count{font-size:12.5px;color:var(--slate);white-space:nowrap;padding:0 4px}
      .mis-ptag{display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:600;white-space:nowrap}
      .mis-ptag--red{background:#fee2e2;color:#991b1b}
      .mis-ptag--amber{background:#fef3c7;color:#92400e}
      .mis-ptag--green{background:#d1fae5;color:#065f46}
      .mis-ptag--gray{background:#f1f5f9;color:#475569}
      /* section heading inside the Edit Case form */
      .mis-prio-head{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--slate);padding-bottom:7px;margin-bottom:12px;border-bottom:1px solid var(--line)}
      .mis-prio-head i{color:var(--brand)}
      /* breathing room above the long text areas in the form */
      .frm textarea.sel{margin-top:2px}
      .frm > div[style*="margin-bottom:14px"]{margin-top:14px}
      /* (i) tooltip beside a field label */
      .mis-tip{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--slate);color:#fff;font:italic 700 10px/1 Georgia,serif;margin-left:6px;cursor:help;position:relative;vertical-align:middle;text-transform:none;letter-spacing:0}
      .mis-tip:hover,.mis-tip:focus{background:var(--brand);outline:none}
      .mis-tip::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 7px);left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:6px 9px;border-radius:6px;font:500 11px/1.45 inherit;white-space:normal;width:max-content;max-width:230px;text-align:center;opacity:0;visibility:hidden;transition:opacity .12s;z-index:60;box-shadow:0 6px 18px rgba(0,0,0,.22)}
      .mis-tip:hover::after,.mis-tip:focus::after{opacity:1;visibility:visible}
      /* dropdown that also accepts a new value */
      .mis-combo-wrap{position:relative}
      .mis-combo-wrap input{padding-right:30px}
      .mis-combo-caret{position:absolute;right:11px;top:50%;transform:translateY(-50%);color:var(--slate);font-size:11px;cursor:pointer;pointer-events:auto}
      .mis-combo.open .mis-combo-caret{transform:translateY(-50%) rotate(180deg)}
      .mis-combo-list{display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:70;background:var(--bg-card);border:1px solid var(--line);border-radius:9px;box-shadow:0 10px 26px rgba(15,23,42,.16);max-height:210px;overflow-y:auto;padding:5px}
      .mis-combo.open .mis-combo-list{display:block}
      .mis-combo-opt{padding:7px 9px;border-radius:6px;font-size:13px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .mis-combo-opt:hover{background:var(--brand-a10,#eef2ff);color:var(--brand)}
      .mis-combo-none{padding:7px 9px;font-size:12px;color:var(--slate)}
      /* date-range filter */
      .mis-range{display:flex;align-items:center;gap:6px;flex-wrap:nowrap}
      .mis-range input[type=date]{height:36px;border:1px solid var(--line);border-radius:8px;padding:0 8px;font-size:12.5px;font-family:inherit;background:var(--bg-card);color:var(--ink);min-width:0;flex:1 1 132px}
      .mis-range input[type=date]:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
      .mis-range .to{font-size:12px;color:var(--slate);flex:none}
      /* date-range picker (custom, so each period can carry an icon) */
      .mis-rangemenu{position:relative;flex:0 0 auto}
      .mis-range-btn{height:36px;display:inline-flex;align-items:center;gap:8px;padding:0 12px;border:1px solid var(--line);
        border-radius:9px;background:var(--bg-card);color:var(--ink);font-size:13px;font-weight:600;font-family:inherit;
        cursor:pointer;white-space:nowrap;transition:border-color .12s,box-shadow .12s}
      .mis-range-btn:hover{border-color:var(--slate)}
      .mis-range-btn:focus-visible{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
      .mis-range-btn > i:first-child{color:var(--brand);font-size:12.5px}
      .mis-range-txt{min-width:88px;text-align:left}
      .mis-range-caret{font-size:9px;color:var(--slate);transition:transform .15s}
      .mis-rangemenu.open .mis-range-btn{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
      .mis-rangemenu.open .mis-range-caret{transform:rotate(180deg)}
      .mis-range-list{display:none;position:absolute;top:calc(100% + 6px);left:0;min-width:210px;z-index:80;
        background:var(--bg-card);border:1px solid var(--line);border-radius:11px;padding:6px;
        box-shadow:0 14px 34px rgba(15,23,42,.18)}
      .mis-rangemenu.open .mis-range-list{display:block}
      .mis-range-opt{width:100%;display:flex;align-items:center;gap:10px;padding:8px 10px;border:0;border-radius:8px;
        background:transparent;color:var(--ink);font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;text-align:left}
      .mis-range-opt:hover{background:var(--bg-subtle,#f8fafc)}
      .mis-range-oi{width:15px;text-align:center;color:var(--slate);font-size:12.5px}
      .mis-range-tick{margin-left:auto;font-size:11px;color:var(--brand);opacity:0}
      .mis-range-opt.on{color:var(--brand);font-weight:700;background:var(--brand-a10,#eef2ff)}
      .mis-range-opt.on .mis-range-oi{color:var(--brand)}
      .mis-range-opt.on .mis-range-tick{opacity:1}
      select.mis-sel{appearance:none;-webkit-appearance:none;padding-right:30px;font-weight:600;
        background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2364748b' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
        background-repeat:no-repeat;background-position:right 10px center;background-size:11px 8px}
      select.mis-sel:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
      /* Custom range needs real room — give the filter row its own line rather than letting
         the date inputs squeeze the search box into nothing. */
      .mis-toolbar.has-custom .mis-filters{flex:1 1 100%;margin-left:0;flex-wrap:nowrap}
      .mis-toolbar.has-custom .mis-search-wrap{flex:1 1 160px;min-width:120px}
      @media(max-width:1100px){
        .mis-toolbar .mis-filters{margin-left:0;flex:1 1 100%;flex-wrap:wrap}
        .mis-toolbar.has-custom .mis-filters{flex-wrap:wrap}
      }
      @media(max-width:760px){
        .mis-toolbar{gap:10px}
        .mis-toolbar .mis-actions{flex:1 1 100%;display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .mis-toolbar .mis-actions .btn{width:100%;justify-content:center;white-space:nowrap}
        .mis-toolbar .mis-actions .btn:first-child{grid-column:1/-1}
        .mis-count{grid-column:1/-1;text-align:center}
        .mis-filters select.mis-sel{flex:1 1 100%;min-width:0}
        .mis-rangemenu{flex:1 1 100%}
        .mis-range-btn{width:100%;justify-content:flex-start}
        .mis-range-caret{margin-left:auto}
        .mis-range-list{left:0;right:0;min-width:0}
        .mis-filters .mis-search-wrap,.mis-toolbar.has-custom .mis-search-wrap{flex:1 1 100%}
        .mis-filters .btn{flex:1 1 100%;justify-content:center}
        .mis-range{flex:1 1 100%;flex-wrap:nowrap}
      }
      #misTbl{width:100%;border-collapse:collapse;font-size:13px;min-width:2200px;table-layout:fixed}
      #misTbl thead th{background:var(--bg-subtle,#f8fafc);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--slate);padding:10px 12px;border-bottom:2px solid var(--line);text-align:left;white-space:nowrap}
      #misTbl tbody tr{border-bottom:1px solid var(--line-2);transition:background .12s;cursor:pointer}
      #misTbl tbody tr:hover{background:var(--bg-hover,#f8fafc)}
      #misTbl tbody tr.mis-selected{background:#eff6ff}
      #misTbl tbody tr.mis-ai-match{background:#fefaf0}
      .mis-ai-badge{margin-left:6px}
      #misTbl tbody td{padding:11px 12px;vertical-align:top}
      .mis-cb{width:16px;height:16px;cursor:pointer;accent-color:var(--brand)}
      .mis-cb:disabled{cursor:not-allowed}
      .mis-cb.mis-handled{accent-color:#94a3b8}
      .mis-cb-cell{display:flex;align-items:center;gap:11px}
      .mis-handle{touch-action:pan-y;-webkit-user-select:none;user-select:none}
      #misTbl tbody tr.mis-swiping{background:#eef2ff;-webkit-user-select:none;user-select:none}
      .mis-cell-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;width:100%}
      /* The Docs column is pinned to the right-hand edge. The table is 2200px wide and this is its
         last column, so it sat off-screen until you scrolled the whole way across — the button was
         mostly cut off. Pinned, it is reachable from any scroll position. */
      /* Every cell in this table is overflow:hidden, which was shaving the button off inside its own
         56px column once the count was there too. This one gets room and is allowed to show it. */
      #misTbl thead th:last-child,#misTbl td.mis-up-cell{position:sticky;right:0;z-index:2;width:78px;
        min-width:78px;max-width:78px;padding-left:6px;padding-right:10px;overflow:visible;
        box-shadow:-7px 0 9px -7px rgba(15,23,42,.18)}
      #misTbl thead th:last-child{z-index:3;background:var(--bg-subtle,#f8fafc)}
      #misTbl td.mis-up-cell{background:var(--bg-card,#fff)}
      #misTbl tbody tr:hover td.mis-up-cell{background:var(--bg-hover,#f8fafc)}
      #misTbl tbody tr.mis-open-action td.mis-up-cell{background:#fffbeb}
      #misTbl tbody tr.mis-open-action:hover td.mis-up-cell{background:#fef3c7}
      .mis-up-cell{text-align:center;white-space:nowrap}
      .mis-upbtn{height:28px;min-width:28px;padding:0 7px;display:inline-flex;align-items:center;gap:4px;justify-content:center;
        border:1px dashed var(--line);border-radius:7px;background:var(--bg-card);color:var(--slate);cursor:pointer}
      .mis-upbtn.has{border-style:solid;border-color:#c7d2fe;background:#eef2ff;color:#1e3a8a;font-weight:700}
      .mis-upbtn:hover{border-color:#1e3a8a;color:#1e3a8a}
      .mis-upn{font-size:11px}
      /* Upload panel: where it is going, then the drop area, then what is already there.
         It never scrolls sideways — the panel is a fixed width and everything in it is boxed to
         that width, so long file names and folder names ellipsis or wrap instead of stretching it. */
      .mis-doc-modal{width:min(94vw,620px);max-width:100%;overflow-x:hidden;box-sizing:border-box}
      .mis-doc-modal *{max-width:100%;box-sizing:border-box}
      .mis-doc-modal .two{grid-template-columns:1fr 1fr;gap:12px}
      .mis-doc-modal .two>div{min-width:0}
      .mis-doc-modal select,.mis-doc-modal input[type=text],.mis-doc-modal input:not([type]){width:100%}
      @media(max-width:520px){ .mis-doc-modal .two{grid-template-columns:1fr} }
      .mis-doc-head{padding:11px 13px;border:1px solid var(--line);border-left:3px solid #1e3a8a;
        border-radius:9px;background:var(--bg-subtle,#f8fafc);margin-bottom:14px}
      .mis-doc-case{font-weight:700;font-size:14px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;
        display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
      .mis-doc-path{font-size:11.5px;color:var(--slate);margin-top:5px;overflow-wrap:anywhere}
      .mis-doc-path b{color:#1e3a8a;font-weight:650}
      .mis-doc-path i{margin-right:4px;opacity:.75}
      .mis-doc-sec{display:flex;align-items:baseline;gap:9px;margin:16px 0 7px;font-size:11.5px;
        font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--slate)}
      .mis-doc-meta{font-weight:400;text-transform:none;letter-spacing:0;font-size:11.5px;margin-left:auto}
      /* A file name is one unbroken word and will not wrap on its own — it pushed the panel wider
         than itself, which is where the sideways scroll came from. */
      .mis-doc-prog{margin-top:10px;padding:9px 12px;border-radius:8px;background:#eef2ff;color:#1e3a8a;
        font-size:12.5px;font-weight:600;overflow-wrap:anywhere;word-break:break-word}
      .mis-doc-foot{display:flex;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap}
      .mis-doc-foot .mis-hint{flex:1;min-width:180px;margin:0}
      .mis-doclist{max-height:240px;overflow:auto;border:1px solid var(--line);border-radius:10px}
      .mis-docrow{display:flex;align-items:center;gap:10px;padding:9px 12px;border-top:1px solid var(--line);font-size:13px;cursor:pointer}
      .mis-docrow:first-child{border-top:0}
      .mis-docrow:hover{background:#f5f8ff}
      .mis-docrow>i:first-child{color:#dc2626;font-size:14px;flex:none;width:15px;text-align:center}
      .mis-docname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mis-docsz{color:var(--slate);font-size:11.5px;white-space:nowrap}
      .mis-docgo{color:var(--slate);font-size:10px;opacity:0;transition:opacity .12s}
      .mis-docrow:hover .mis-docgo{opacity:1}
      .mis-docpend{color:#b45309;font-size:11px;white-space:nowrap}
      .mis-ro{padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--bg-subtle,#f8fafc);font-size:13.5px}
      .mis-hint{font-size:11.5px;color:var(--slate);margin-top:4px}
      /* A case with an action open is the work in hand — the whole row is tinted so it is picked
         out at a glance, and the action itself is the only text on the row in full colour. */
      #misTbody tr.mis-open-action{background:#fffbeb}
      #misTbody tr.mis-open-action:hover{background:#fef3c7}
      .mis-action-live{font-weight:650;color:#b45309}
      .mis-action-live i{font-size:10px;margin-right:3px;opacity:.8}
      /* Just executed: nothing is scheduled yet, so it stays quiet — a thin amber edge only,
         enough to find it while its next action is being decided. */
      #misTbody tr.mis-just-done{box-shadow:inset 3px 0 0 #fbbf24}
      /* Desktop only — mobile keeps exactly the widths above. A person's name never fills a
         150px column, while Cause Title and Status are the ones people actually need to read,
         so the slack is taken off the name/date columns and handed to the text ones.
         !important is needed because the widths are inline on each <col>. */
      @media(min-width:769px){
        #misTbl col:nth-child(3){width:320px !important}   /* Cause Title / Parties */
        #misTbl col:nth-child(5){width:92px  !important}   /* Previous Date */
        #misTbl col:nth-child(6){width:92px  !important}   /* Next Date */
        #misTbl col:nth-child(7){width:92px  !important}   /* Priority */
        #misTbl col:nth-child(8){width:128px !important}   /* Advocate In-Charge */
        #misTbl col:nth-child(10){width:260px !important}  /* Status / Purpose */
        #misTbl col:nth-child(11){width:260px !important}  /* Action Needed */
        #misTbl col:nth-child(12){width:230px !important}  /* Remarks */
        #misTbl col:nth-child(14){width:95px  !important}  /* Date of Filing */
        #misTbl col:nth-child(15){width:108px !important}  /* PC In-Charge */
        /* the wider columns can afford a third line before they clip */
        .mis-cell-clamp{-webkit-line-clamp:3}
      }
      #misTbl td,#misTbl th{overflow:hidden}
      @media(max-width:768px){
        .mis-toolbar{flex-direction:column;align-items:stretch}
        .mis-toolbar .mis-actions{width:100%}
        .mis-toolbar .mis-actions .btn{flex:1 1 auto;justify-content:center}
        .mis-count{width:100%;text-align:center;order:99}
        .mis-toolbar .mis-filters{margin-left:0;width:100%}
        .mis-search-wrap{width:100%}
        .mis-search-wrap input{min-width:0;width:100%}
        /* the full placeholder sentence overflows a phone-width box - shrink it so it reads */
        .mis-search-wrap input::placeholder{font-size:11.5px}
        select.mis-sel{min-width:0;width:100%}
        .mis-rangemenu{width:100%}
        .mis-range-btn{width:100%;justify-content:flex-start}
        .mis-range-caret{margin-left:auto}
        #misTbl{min-width:1500px;font-size:12.5px}
        #misTbl thead th,#misTbl tbody td{padding:9px 8px}
      }
    </style>
    <div class="mis-toolbar${MIS_RANGE==='custom'?' has-custom':''}">
      <div class="mis-actions">
        <button class="btn btn-primary" onclick="misCreate()"><i class="fa-solid fa-plus"></i> Add Case</button>
        <button class="btn" id="misEditBtn" onclick="misEditSel()" disabled><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn" id="misDelBtn" onclick="misDeleteSel()" disabled><i class="fa-solid fa-trash"></i> Delete</button>
        <button class="btn" id="misDocsBtn" onclick="misDocsSel()" disabled><i class="fa-solid fa-folder-open"></i> Documents</button>
        <span class="mis-count" id="misCount">${rows.length} cases</span>
      </div>
      <div class="mis-filters">
        <div class="mis-rangemenu" id="misRangeMenu">
          <button type="button" class="mis-range-btn" onclick="misRangeToggle()">
            <i class="fa-solid ${misRangeDef()[2]}"></i>
            <span class="mis-range-txt">${esc(misRangeDef()[1])}</span>
            <i class="fa-solid fa-chevron-down mis-range-caret"></i>
          </button>
          <div class="mis-range-list">
            ${MIS_RANGES.map(r=>`<button type="button" class="mis-range-opt${MIS_RANGE===r[0]?' on':''}" onclick="misRangePick('${r[0]}')">
              <i class="fa-solid ${r[2]} mis-range-oi"></i><span>${esc(r[1])}</span>
              <i class="fa-solid fa-check mis-range-tick"></i>
            </button>`).join('')}
          </div>
        </div>
        <span class="mis-range" id="misRangeCustom" style="display:${MIS_RANGE==='custom'?'flex':'none'}">
          <input type="date" id="misFrom" value="${esc(MIS_FROM)}" onchange="misDateFromChange()">
          <span class="to">to</span>
          <input type="date" id="misTo" min="${esc(MIS_FROM)}" value="${esc(MIS_TO)}" onchange="misDateToChange()">
        </span>
        <div class="mis-search-wrap">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input id="misSearch" placeholder="Search anything — or put &quot;quotes&quot; around an exact phrase" oninput="misFilter()"
                 title="Plain words: rows containing all of them, in any order or field.
&quot;in quotes&quot;: that exact phrase, word for word.
priority is empty / court is high court: search one column.">
        </div>
        <button class="btn" onclick="misViewCauselist()" title="View the causelist for the selected date range in a new tab"><i class="fa-solid fa-eye"></i> View</button>
        <button class="btn" onclick="misExportCauselist()" title="Export the causelist for the selected date range"><i class="fa-solid fa-file-arrow-down"></i> Causelist</button>
        <span class="mis-count" id="misAiStatus"></span>
      </div>
    </div>
    <div class="card" style="overflow:hidden">
      <div style="overflow-x:auto">
      <table id="misTbl">
        <colgroup><col style="width:60px">${MIS_FIELDS.map(f=>`<col style="width:${MIS_WIDTH[f.k]||140}px">`).join('')}</colgroup>
        <thead><tr>
          <th style="width:60px"><input type="checkbox" class="mis-cb" id="misChkAll" onchange="misToggleAll(this)"></th>
          ${MIS_FIELDS.map(f=>`<th>${esc(f.l)}</th>`).join('')}
          <th style="width:78px;text-align:center">Docs</th>
        </tr></thead>
        <tbody id="misTbody">
          ${misPinned.map(r=>misRowHtml(r,true)).join('')}
          ${misPinned.length&&misRest.length?`<tr class="mis-spacer" style="cursor:default"><td colspan="${MIS_FIELDS.length+2}" style="height:18px;background:var(--bg-subtle,#f8fafc);border-bottom:2px solid var(--line)"></td></tr>`:''}
          ${misRest.map(r=>misRowHtml(r,false)).join('')}
        </tbody>
      </table>
      </div>
    </div>`;
  // apply the hearing-date window straight away, not only when someone types
  if(MIS_RANGE!=='all') setTimeout(misFilter,0);
  misWireSwipe();
}
// Score = how far ahead of the deadline the case was actually handled.
// gap = Next Date − Recorded Date (days).
//   gap > 7   -> +1  handled well ahead
//   gap 1..7  ->  0  cut it close
//   gap <= 0  -> -1  recorded ON the hearing date or after it, i.e. left to the day or missed
// Recording it on the day itself counts as late, not neutral — a case dealt with only when it
// is already due was not managed ahead of time.
// No score yet if the "Handled" checkbox in MIS hasn't been ticked for this Next Date.
/* Scored on the ACTION DATE — the day the team committed to doing the thing written in Action
   Needed — measured against the day that commitment was recorded. More than a week of runway
   earns +1, anything shorter but still ahead scores 0, and a date that is today or already gone
   scores −1. Cases with no action date are simply not scored.
   (This used to measure the hearing date, which rewarded whatever the court happened to list.) */
function misScoreOf(r){
  const target=r.action_date_iso||r.next_date_iso||null;
  const from=r.action_recorded_at||r.next_date_recorded_at||null;
  if(!target||!from)return null;
  const gap=Math.round((new Date(target+'T00:00:00')-new Date(String(from).slice(0,10)+'T00:00:00'))/86400000);
  if(gap>7)return 1;
  if(gap>0)return 0;
  return -1;
}
/* ---------- Actions ------------------------------------------------------------------------
   An action is a thing the team has committed to doing on a case by a date. The case row carries
   whichever one is open; public.mis_actions keeps every one ever raised, which is what this lists.
   Executing an action clears the case's Next Date and Action Needed and moves the action date into
   Previous Date — the hearing has been dealt with, so the case waits for its next listing.        */
async function legalActions(){
  setCrumb(['Legal','Actions']);
  const hAct=$('legalHeadActions'); if(hAct)hAct.innerHTML='';
  const body=$('legalBody'); if(!body)return;
  loader(body);
  let rows=[];
  try{
    const {data}=await sb.from('mis_actions').select('*').order('executed_date_iso',{ascending:true,nullsFirst:true}).order('action_date_iso',{ascending:true});
    rows=data||[];
  }catch(e){}
  let cases=[];
  try{ const {data}=await sb.from('mis_cases').select('id,cause_title,case_no,case_type'); cases=data||[]; }catch(e){}
  const byCase={}; cases.forEach(c=>{byCase[c.id]=c;});
  const nameOfCase=id=>{const c=byCase[id];if(!c)return '—';return (c.cause_title||c.case_no||('Case '+id));};
  window._misActionRows=rows.map(r=>Object.assign({},r,{_case:nameOfCase(r.case_id)}));
  const open=rows.filter(r=>!r.executed_date_iso).length;
  body.innerHTML=`<style>
    .act-bar{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:13px}
    .act-search{position:relative;flex:1;min-width:180px;display:flex;align-items:center}
    .act-search i{position:absolute;left:11px;color:var(--slate);font-size:12.5px;pointer-events:none}
    .act-search input{width:100%;height:38px;padding:0 12px 0 32px;border:1px solid var(--line);border-radius:9px;font-size:13px;font-family:inherit;background:var(--bg-card);color:var(--ink)}
    .act-search input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
    .act-sel{height:38px;padding:0 34px 0 13px;border:1px solid var(--line);border-radius:9px;font-size:13px;
      font-weight:600;font-family:inherit;background:var(--bg-card);color:var(--ink);cursor:pointer;
      appearance:none;-webkit-appearance:none;transition:border-color .12s,box-shadow .12s;
      background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%231e3a8a' stroke-width='2' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      background-repeat:no-repeat;background-position:right 12px center;background-size:11px 8px}
    .act-sel:hover{border-color:var(--slate)}
    .act-sel:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
    @media(max-width:760px){.act-search,.act-sel{flex:1 1 100%}}
    #actTbl{width:100%;border-collapse:collapse;font-size:13px}
    #actTbl th{text-align:left;padding:10px 12px;background:var(--bg-subtle,#f8fafc);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--slate);border-bottom:2px solid var(--line);white-space:nowrap}
    #actTbl td{padding:10px 12px;border-bottom:1px solid var(--line-2);vertical-align:top}
    @media(max-width:760px){#actTbl{min-width:640px}}
  </style>
  <div class="act-bar">
    <div class="act-search"><i class="fa-solid fa-magnifying-glass"></i><input id="actQ" placeholder="Search action, case or date…" oninput="legalActionsFilter()"></div>
    <select class="act-sel" id="actState" onchange="legalActionsFilter()">
      <option value="all">All actions (${rows.length})</option>
      <option value="open">Still open (${open})</option>
      <option value="done">Executed (${rows.length-open})</option>
    </select>
  </div>
  <div class="card" style="overflow:hidden"><div style="overflow-x:auto">
    <table id="actTbl"><thead><tr>
      <th>Action</th><th>Action Date</th><th>Executed Date</th><th>Case</th><th>Remarks</th>
    </tr></thead><tbody id="actBody"></tbody></table>
  </div></div>
  <div class="empty" id="actEmpty" style="padding:34px;display:none"><i class="fa-regular fa-square-check"></i><div>Nothing here.</div>
    <div style="font-size:12.5px;color:var(--slate);margin-top:6px">Actions are raised from the MIS tab — click a case to add one.</div></div>`;
  legalActionsFilter();
}
window.legalActionsFilter=function(){
  const rows=window._misActionRows||[];
  const q=(($('actQ')||{}).value||'').trim().toLowerCase();
  const st=(($('actState')||{}).value)||'all';
  const list=rows.filter(r=>{
    if(st==='open'&&r.executed_date_iso) return false;
    if(st==='done'&&!r.executed_date_iso) return false;
    if(!q) return true;
    return [r.action_needed,r.action_date,r.executed_date,r._case,r.remarks].filter(Boolean).join(' ').toLowerCase().indexOf(q)!==-1;
  });
  const tb=$('actBody'); if(!tb)return;
  tb.innerHTML=list.map(r=>'<tr>'
    +'<td><b class="lg-clamp" title="'+esc(r.action_needed||'')+'">'+esc(r.action_needed||'—')+'</b></td>'
    +'<td style="white-space:nowrap">'+esc(r.action_date||'—')+'</td>'
    +'<td style="white-space:nowrap">'+(r.executed_date
        ?('<span class="mis-ptag mis-ptag--green">'+esc(r.executed_date)+'</span>')
        :'<span class="mis-ptag mis-ptag--amber">Open</span>')+'</td>'
    +'<td><span class="lg-clamp" title="'+esc(r._case||'')+'">'+esc(r._case||'—')+'</span></td>'
    +'<td style="color:var(--slate)"><span class="lg-clamp" title="'+esc(r.remarks||'')+'">'+esc(r.remarks||'')+'</span></td>'
  +'</tr>').join('');
  const em=$('actEmpty'); if(em)em.style.display=list.length?'none':'';
  usageQueueDebounced('legal.actions.view_search_filter_case_actions', q);
};

/* ---------- Causelist Reviews -----------------------------------------------------------------
   Where the causelist action-review popup's decisions actually live once made - not just today's
   snapshot on mis_cases (pending/answered/who), but the full history from
   mis_causelist_review_log: every export claim, every answer, every time someone closed the popup
   without answering. Also the on-demand way back into it: the toolbar nudge in legalMIS() covers
   "I have some to answer"; this covers "let me see all of them, and who else does too". Sourced
   from the log table itself (a case appears here iff it has at least one log row) rather than a
   field-presence filter on mis_cases, so this and the log agree by construction. */
function clrevDT(iso){ if(!iso) return '—'; const d=new Date(iso); if(isNaN(d)) return String(iso);
  return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear()
    +', '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
async function legalCauselistReviews(){
  setCrumb(['Legal','Causelist Reviews']);
  const hAct=$('legalHeadActions'); if(hAct)hAct.innerHTML='';
  const body=$('legalBody'); if(!body)return;
  loader(body);
  try{ await getPeople(); }catch(e){}
  try{ await clrevLoadLegal(); }catch(e){}   // populates window._clrevLegal for the inline person picker below
  let logs=[], cases=[];
  try{ const {data}=await sb.from('mis_causelist_review_log').select('*').order('created_at',{ascending:true}); logs=data||[]; }catch(e){}
  const ids=Array.from(new Set(logs.map(function(l){return l.case_id;})));
  if(ids.length){
    try{
      // The date fields are needed for misHearingIso() when an inline answer creates a task -
      // the narrower column set used before was fine for display but left the task description's
      // hearing date blank.
      const {data}=await sb.from('mis_cases').select('id,case_no,case_type,cause_title,court,'
        +'causelist_pending_by,causelist_reviewed_at,causelist_action_needed,causelist_reviewed_by,'
        +'case_next_date_iso,case_next_date,next_date_iso,next_date').in('id',ids);
      cases=data||[];
    }catch(e){}
  }
  const byCase={};
  logs.forEach(function(l){ (byCase[l.case_id]=byCase[l.case_id]||[]).push(l); });
  const rows=cases.map(function(c){
    const hist=byCase[c.id]||[];
    // The most recent DECISION (first answer or any later edit of it) - this is what the Due /
    // Responsible cells show, and where an edit reads the previous task id from.
    const decisions=hist.filter(function(l){return l.event==='answered'||l.event==='edited';});
    const closes=hist.filter(function(l){return l.event==='closed_without_answering';}).length;
    return Object.assign({}, c, {_hist:hist, _lastAnswered:decisions[decisions.length-1]||null,
      _closes:closes, _pending:!!c.causelist_pending_by && !c.causelist_reviewed_at});
  }).sort(function(a,b){
    // Pending first (soonest claimed first among those), then most recently answered.
    if(a._pending!==b._pending) return a._pending?-1:1;
    return String((b.causelist_reviewed_at||b._hist[0]&&b._hist[0].created_at)||'').localeCompare(String((a.causelist_reviewed_at||a._hist[0]&&a._hist[0].created_at)||''));
  });
  window._clrevReviewRows=rows;
  const pendingCount=rows.filter(function(r){return r._pending;}).length;
  body.innerHTML=`<style>
    .crv-bar{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:13px}
    .crv-search{position:relative;flex:1;min-width:180px;display:flex;align-items:center}
    .crv-search i{position:absolute;left:11px;color:var(--slate);font-size:12.5px;pointer-events:none}
    .crv-search input{width:100%;height:38px;padding:0 12px 0 32px;border:1px solid var(--line);border-radius:9px;font-size:13px;font-family:inherit;background:var(--bg-card);color:var(--ink)}
    .crv-search input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
    .crv-sel{height:38px;padding:0 34px 0 13px;border:1px solid var(--line);border-radius:9px;font-size:13px;
      font-weight:600;font-family:inherit;background:var(--bg-card);color:var(--ink);cursor:pointer;
      appearance:none;-webkit-appearance:none;
      background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%231e3a8a' stroke-width='2' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      background-repeat:no-repeat;background-position:right 12px center;background-size:11px 8px}
    @media(max-width:760px){.crv-search,.crv-sel{flex:1 1 100%}}
    #crvTbl{width:100%;border-collapse:collapse;font-size:13px}
    #crvTbl th{text-align:left;padding:10px 12px;background:var(--bg-subtle,#f8fafc);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--slate);border-bottom:2px solid var(--line);white-space:nowrap}
    #crvTbl td{padding:10px 12px;border-bottom:1px solid var(--line-2);vertical-align:top}
    /* Pending rows answer inline, right on the line item - no click-through, no popup. */
    .crv-seg{display:inline-flex;gap:4px;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:2px;margin-left:6px;vertical-align:middle}
    .crv-seg-btn{border:none;background:transparent;color:var(--slate);font-size:11.5px;font-weight:600;padding:4px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}
    .crv-seg-btn:hover{color:var(--ink)}
    .crv-seg-btn.on{background:var(--card);color:var(--brand);box-shadow:var(--shadow)}
    .crv-inline-fields{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
    .crv-inline-fields input,.crv-inline-fields select{padding:5px 7px;border:1px solid var(--line);border-radius:6px;font-size:12.5px;color:var(--ink);background:var(--card)}
    @media(max-width:760px){#crvTbl{min-width:820px}}
  </style>
  <div class="crv-bar">
    <div class="crv-search"><i class="fa-solid fa-magnifying-glass"></i><input id="crvQ" placeholder="Search case, exporter or reviewer…" oninput="legalCauselistFilter()"></div>
    <select class="crv-sel" id="crvState" onchange="legalCauselistFilter()">
      <option value="all">All (${rows.length})</option>
      <option value="pending">Pending review (${pendingCount})</option>
      <option value="needed">Action needed (${rows.filter(function(r){return r.causelist_action_needed===true;}).length})</option>
      <option value="noaction">No action needed (${rows.filter(function(r){return r.causelist_action_needed===false;}).length})</option>
    </select>
  </div>
  <div class="card" style="overflow:hidden"><div style="overflow-x:auto">
    <table id="crvTbl"><thead><tr>
      <th>Case</th><th>Status</th><th>Pending with</th><th>Answered by</th><th>Due</th><th>Responsible</th>
    </tr></thead><tbody id="crvBody"></tbody></table>
  </div></div>
  <div class="empty" id="crvEmpty" style="padding:34px;display:none"><i class="fa-regular fa-square-check"></i><div>Nothing here yet.</div>
    <div style="font-size:12.5px;color:var(--slate);margin-top:6px">This fills in as causelists get exported from the MIS tab.</div></div>`;
  legalCauselistFilter();
}
// Answering a pending row - or EDITING an already-answered one - happens right on the line item: a
// segmented control in the Status cell, and (once "Action needed" is picked) a date input +
// Legal-person select in the Due cell, both live in window._crvEdit until Save. No popup, no
// click-through: every control needed is always visible on its own row.
//
// A row is "editable" either because it's genuinely still pending, or because Edit was explicitly
// clicked on an already-answered one (window._crvEditingIds). The two look the same but behave
// slightly differently: a fresh pending row's "No action" saves in one click since there's nothing
// to lose; an explicit edit always needs a deliberate Save, even for "No action", since that can
// delete an existing task.
window._crvEdit={};
window._crvEditingIds=new Set();
function crvGetEdit(id){ return window._crvEdit[id] || (window._crvEdit[id]={needed:null,due:'',person:''}); }
function crvEditable(r){ return r._pending || window._crvEditingIds.has(r.id); }
function crvIsExplicitEdit(r){ return !r._pending && window._crvEditingIds.has(r.id); }
function legalCauselistStatusPill(r){
  if(!crvEditable(r)){
    if(r.causelist_action_needed===true) return '<span class="mis-ptag mis-ptag--green">Action needed</span> '
      +'<a href="javascript:void(0)" onclick="legalCauselistOpenHistory('+r.id+')" style="font-size:12px;color:var(--slate)">History</a>'
      +' · <a href="javascript:void(0)" onclick="legalCauselistEditStart('+r.id+')" style="font-size:12px">Edit</a>';
    if(r.causelist_action_needed===false) return '<span class="mis-ptag">No action needed</span> '
      +'<a href="javascript:void(0)" onclick="legalCauselistOpenHistory('+r.id+')" style="font-size:12px;color:var(--slate)">History</a>'
      +' · <a href="javascript:void(0)" onclick="legalCauselistEditStart('+r.id+')" style="font-size:12px">Edit</a>';
    return '—';
  }
  const e=crvGetEdit(r.id);
  return '<span class="mis-ptag mis-ptag--amber">'+(r._pending?'Pending':'Editing')+'</span>'
    +'<span class="crv-seg">'
      +'<button type="button" class="crv-seg-btn'+(e.needed===true?' on':'')+'" onclick="crvSetNeeded('+r.id+',true)"><i class="fa-solid fa-flag"></i> Action needed</button>'
      +'<button type="button" class="crv-seg-btn'+(e.needed===false?' on':'')+'" onclick="crvSetNeeded('+r.id+',false)"><i class="fa-solid fa-check"></i> No action</button>'
    +'</span>'
    +((r._hist||[]).length?' <a href="javascript:void(0)" onclick="legalCauselistOpenHistory('+r.id+')" style="font-size:12px;color:var(--slate)">History</a>':'')
    +(crvIsExplicitEdit(r)?' <a href="javascript:void(0)" onclick="legalCauselistEditCancel('+r.id+')" style="font-size:12px;color:var(--slate)">Cancel</a>':'');
}
function crvDueCellHtml(r){
  if(!crvEditable(r)){
    // Assigned person lives in its own Responsible column now (crvResponsibleName) - just the date here.
    const detail=(r._lastAnswered&&r._lastAnswered.detail)||{};
    return (r.causelist_action_needed===true) ? esc(detail.due?clrevDmy(detail.due):'—') : '—';
  }
  const e=crvGetEdit(r.id);
  if(e.needed===null) return '—';
  if(e.needed!==true){
    // Explicit edit landing on "No action" still needs a deliberate Save - a fresh pending row
    // never reaches this branch, since crvSetNeeded already saved it and left edit mode.
    return crvIsExplicitEdit(r)
      ? '<div class="crv-inline-fields">—&nbsp;<button type="button" class="btn btn-primary" id="crvSaveBtn_'+r.id+'" style="padding:5px 10px;font-size:12px" onclick="crvSaveInline('+r.id+')">Save</button></div>'
      : '—';
  }
  const legal=window._clrevLegal||[];
  const opts='<option value="">— choose —</option>'+legal.map(function(p){
    return '<option value="'+esc(p.email)+'"'+(e.person===p.email?' selected':'')+'>'+esc(p.name)+'</option>'; }).join('');
  const hearing=misHearingIso(r);
  return '<div class="crv-inline-fields">'
    +'<input type="date" id="crvDue_'+r.id+'" value="'+esc(e.due||'')+'"'+(hearing?' max="'+esc(hearing)+'"':'')+' title="'+(hearing?'On or before the '+esc(clrevDmy(hearing))+' hearing':'')+'" onchange="crvFieldChange('+r.id+')">'
    +'<select id="crvPerson_'+r.id+'" onchange="crvFieldChange('+r.id+')">'+opts+'</select>'
    +'<button type="button" class="btn btn-primary" id="crvSaveBtn_'+r.id+'" style="padding:5px 10px;font-size:12px" onclick="crvSaveInline('+r.id+')" title="Save"><i class="fa-solid fa-check"></i></button>'
  +'</div>';
}
// Who's actually doing it, once a matter has been marked action-needed and saved. Blank for
// anything still pending (nobody's assigned yet) or answered as no-action (nobody needs to be).
function crvResponsibleName(r){
  const detail=(r._lastAnswered&&r._lastAnswered.detail)||{};
  return (r.causelist_action_needed===true && detail.person) ? esc(nameOf(detail.person)) : '—';
}
function crvRepaintRow(id){
  const r=(window._clrevReviewRows||[]).find(function(x){return x.id===id;}); if(!r) return;
  const st=$('crvStat_'+id); if(st) st.innerHTML=legalCauselistStatusPill(r);
  const da=$('crvDA_'+id); if(da) da.innerHTML=crvDueCellHtml(r);
}
window.legalCauselistEditStart=function(id){
  const r=(window._clrevReviewRows||[]).find(function(x){return x.id===id;}); if(!r) return;
  window._crvEditingIds.add(id);
  const detail=(r._lastAnswered&&r._lastAnswered.detail)||{};
  window._crvEdit[id]={needed:r.causelist_action_needed, due:detail.due||'', person:detail.person||''};
  crvRepaintRow(id);
};
window.legalCauselistEditCancel=function(id){
  window._crvEditingIds.delete(id);
  delete window._crvEdit[id];
  crvRepaintRow(id);
};
window.crvSetNeeded=function(id,val){
  const r=(window._clrevReviewRows||[]).find(function(x){return x.id===id;}); if(!r) return;
  const e=crvGetEdit(id);
  e.needed=val;
  // Fresh (not-yet-answered) "No action" still saves in one click - nothing at stake to lose.
  if(val===false && r._pending && !crvIsExplicitEdit(r)){ crvSaveInline(id); return; }
  crvRepaintRow(id);
};
window.crvFieldChange=function(id){
  const e=crvGetEdit(id), d=$('crvDue_'+id), p=$('crvPerson_'+id);
  const r=(window._clrevReviewRows||[]).find(function(x){return x.id===id;});
  const hearing=r?misHearingIso(r):null;
  if(d && clrevDueTooLate(d.value,hearing)){
    toast('Due date can\'t be after the '+clrevDmy(hearing)+' hearing — reset to that date','warn');
    d.value=hearing;
  }
  if(d) e.due=d.value||''; if(p) e.person=p.value||'';
};
window.crvSaveInline=async function(id){
  const r=(window._clrevReviewRows||[]).find(function(x){return x.id===id;});
  if(!r) return;
  const e=crvGetEdit(id);
  if(e.needed===null) return;
  if(e.needed===true){
    crvFieldChange(id);
    if(!e.due||!e.person){ toast('Pick a due date and a responsible person first','warn'); return; }
    if(clrevDueTooLate(e.due,misHearingIso(r))){ toast('Due date can\'t be after the '+clrevDmy(misHearingIso(r))+' hearing','warn'); return; }
  }
  const isEdit=!r._pending;
  const prevTaskId=(r._lastAnswered&&r._lastAnswered.detail&&r._lastAnswered.detail.task_id)||null;
  const btn=$('crvSaveBtn_'+id);
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>'; }
  try{
    await clrevSaveOneRow({id:r.id, case_no:r.case_no, cause_title:r.cause_title, court:r.court,
      hearing:misHearingIso(r), needed:e.needed, due:e.due, person:e.person}, {prevTaskId:prevTaskId, isEdit:isEdit});
  }catch(err){
    toast('Could not save: '+((err&&err.message)||err),'err');
    if(btn){ btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-check"></i>'; }
    return;
  }
  window._crvEditingIds.delete(id);
  delete window._crvEdit[id];
  toast(isEdit?'Updated':'Saved','ok');
  legalCauselistReviews();
};
window.legalCauselistFilter=function(){
  const rows=window._clrevReviewRows||[];
  const q=(($('crvQ')||{}).value||'').trim().toLowerCase();
  const st=(($('crvState')||{}).value)||'all';
  const list=rows.filter(function(r){
    if(st==='pending'&&!r._pending) return false;
    if(st==='needed'&&r.causelist_action_needed!==true) return false;
    if(st==='noaction'&&r.causelist_action_needed!==false) return false;
    if(!q) return true;
    return [r.case_no,r.cause_title,r.causelist_pending_by,r.causelist_reviewed_by].filter(Boolean).join(' ').toLowerCase().indexOf(q)!==-1;
  });
  const tb=$('crvBody'); if(!tb)return;
  tb.innerHTML=list.map(function(r){
    return '<tr>'
      +'<td><b class="lg-clamp" title="'+esc(r.cause_title||'')+'">'+esc(r.case_no||('#'+r.id))+'</b>'
        +'<div style="color:var(--slate);font-size:12px" class="lg-clamp">'+esc(r.cause_title||'')+'</div></td>'
      +'<td id="crvStat_'+r.id+'">'+legalCauselistStatusPill(r)+'</td>'
      +'<td style="white-space:nowrap">'+(r.causelist_pending_by?esc(nameOf(r.causelist_pending_by)):'—')+'</td>'
      +'<td style="white-space:nowrap">'+(r.causelist_reviewed_by?(esc(nameOf(r.causelist_reviewed_by))+' · '+esc(clrevDmy(String(r.causelist_reviewed_at||'').slice(0,10)))):'—')+'</td>'
      +'<td id="crvDA_'+r.id+'">'+crvDueCellHtml(r)+'</td>'
      +'<td>'+crvResponsibleName(r)+'</td>'
    +'</tr>';
  }).join('');
  const em=$('crvEmpty'); if(em)em.style.display=list.length?'none':'';
};
window.legalCauselistOpenHistory=function(id){
  const r=(window._clrevReviewRows||[]).find(function(x){return x.id===id;});
  if(!r) return;
  const hist=r._hist||[];
  const rowsHtml=hist.length ? hist.map(function(l){
    let what='';
    if(l.event==='exported') what='Exported / claimed by '+esc(nameOf(l.actor));
    else if(l.event==='closed_without_answering') what='Closed the popup without answering — '+esc(nameOf(l.actor));
    else if(l.event==='answered'||l.event==='edited'){
      const d=l.detail||{}, verb=(l.event==='edited')?'Edited to':'Marked';
      what=d.needed
        ? verb+' <b>action needed</b> by '+esc(nameOf(l.actor))+' — due '+esc(d.due?clrevDmy(d.due):'—')+', assigned to '+esc(d.person?nameOf(d.person):'—')
        : verb+' <b>no action needed</b> by '+esc(nameOf(l.actor));
    }
    return '<div style="padding:9px 0;border-bottom:1px solid var(--line-2)"><div style="font-size:12px;color:var(--slate)">'+esc(clrevDT(l.created_at))+'</div><div>'+what+'</div></div>';
  }).join('') : '<div style="color:var(--slate);padding:14px 0">No history recorded.</div>';
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-clock-rotate-left"></i> '+esc(r.case_no||('Case '+r.id))+' — review history</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="width:min(94vw,560px);max-height:70vh;overflow:auto">'+rowsHtml+'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>','md');
};

/* ---------- Advocates ----------------------------------------------------------------------- */
async function legalAdvocates(){
  setCrumb(['Legal','Advocates']);
  const hAct=$('legalHeadActions');
  if(hAct)hAct.innerHTML='<button class="btn btn-primary" onclick="advModal()"><i class="fa-solid fa-plus"></i> Add Advocate</button>';
  const body=$('legalBody'); if(!body)return;
  loader(body);
  let rows=[];
  try{ const {data}=await sb.from('legal_advocates').select('*').order('case_type',{ascending:true,nullsFirst:false}).order('advocate_name',{ascending:true}); rows=data||[]; }catch(e){}
  window._advRows=rows;
  body.innerHTML=`<style>
    .adv-search{position:relative;display:flex;align-items:center;margin-bottom:13px}
    .adv-search i{position:absolute;left:12px;color:var(--slate);font-size:13px;pointer-events:none}
    .adv-search input{width:100%;height:40px;padding:0 13px 0 34px;border:1px solid var(--line);border-radius:10px;font-size:13.5px;font-family:inherit;background:var(--bg-card);color:var(--ink)}
    .adv-search input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10)}
    #advTbl{width:100%;border-collapse:collapse;font-size:13px;min-width:940px}
    #advTbl th{text-align:left;padding:10px 12px;background:var(--bg-subtle,#f8fafc);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--slate);border-bottom:2px solid var(--line);white-space:nowrap}
    #advTbl td{padding:10px 12px;border-bottom:1px solid var(--line-2);vertical-align:top}
    #advTbl tbody tr{cursor:pointer}
    #advTbl tbody tr:hover{background:var(--bg-subtle,#f8fafc)}
    /* long chambers and contacts are trimmed to two lines rather than stretching the row */
    .adv-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
    .adv-ph{white-space:nowrap;font-variant-numeric:tabular-nums}
  </style>
  <div class="adv-search"><i class="fa-solid fa-magnifying-glass"></i>
    <input id="advQ" placeholder="Search by advocate, court, case type or place…" oninput="advFilter()"></div>
  <div class="card" style="overflow:hidden"><div style="overflow-x:auto">
    <table id="advTbl"><thead><tr>
      <th>Case Type</th><th>Court</th><th>State / District</th><th>Advocate</th><th>Phone</th>
      <th>Chamber</th><th>Additional contact</th><th style="width:52px"></th>
    </tr></thead><tbody id="advBody"></tbody></table>
  </div></div>
  <div class="empty" id="advEmpty" style="padding:34px;display:none"><i class="fa-regular fa-address-book"></i><div>No advocates match.</div></div>`;
  advFilter();
}
window.advFilter=function(){
  const q=(($('advQ')||{}).value||'').trim().toLowerCase();
  const list=(window._advRows||[]).filter(r=>!q||[r.case_type,r.court,r.state_dist,r.advocate_name,r.phone,r.chamber,r.extra_contact]
    .filter(Boolean).join(' ').toLowerCase().indexOf(q)!==-1);
  const tb=$('advBody'); if(!tb)return;
  /* The number carries the advocate's name so the report can say who was called, and stops the
     click there: the whole row opens the edit form, so tapping a number used to open it too. */
  const tel=(p,nm)=>String(p||'').split('/').map(x=>x.trim()).filter(Boolean)
    .map(x=>'<a href="tel:'+esc(x.replace(/\s+/g,''))+'" onclick="event.stopPropagation();advCall('
      +JSON.stringify(esc(nm||'')).replace(/"/g,'&quot;')+','+JSON.stringify(x).replace(/"/g,'&quot;')+')">'+esc(x)+'</a>')
    .join('<br>');
  // The whole row opens the edit form - no separate Edit button. Only Remove stays, because it
  // must not be reachable by a stray click.
  const cl=(v,w)=>'<td'+(w?(' style="max-width:'+w+'px"'):'')+'><div class="adv-clamp" title="'+esc(v||'')+'">'+esc(v||'—')+'</div></td>';
  tb.innerHTML=list.map(r=>'<tr onclick="advModal('+r.id+')" title="Click to edit">'
    +cl(r.case_type,150)
    +cl(r.court,200)
    +cl(r.state_dist,150)
    +'<td><b>'+esc(r.advocate_name||'')+'</b></td>'
    +'<td class="adv-ph">'+(r.phone?tel(r.phone,r.advocate_name):'—')+'</td>'
    +cl(r.chamber,240)
    +cl(r.extra_contact,170)
    +'<td onclick="event.stopPropagation()" style="white-space:nowrap">'
      +'<button class="btn btn-sm btn-danger" onclick="advDelete('+r.id+')" title="Remove"><i class="fa-solid fa-trash"></i></button>'
    +'</td>'
  +'</tr>').join('');
  const em=$('advEmpty'); if(em)em.style.display=list.length?'none':'';
  usageQueueDebounced('legal.advocates.search_advocates', q);
};
window.advModal=function(id){
  const r=(window._advRows||[]).filter(x=>String(x.id)===String(id))[0]||{};
  const f=(k,label,ph)=>'<label>'+label+'<input id="advF_'+k+'" value="'+esc(r[k]||'')+'" placeholder="'+esc(ph||'')+'"></label>';
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-user-tie"></i> '+(id?'Edit advocate':'Add advocate')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm">'
      +f('advocate_name','Advocate name','e.g. Sanjay Bhattacharya')
      +'<div class="two">'+f('case_type','Case type','e.g. Consumer Cases')+f('court','Court','e.g. Kolkata District Commission')+'</div>'
      +'<div class="two">'+f('state_dist','State / District','e.g. West Bengal, Kolkata')+f('phone','Phone','9830000000 / 9007000000')+'</div>'
      +f('chamber','Chamber details','Where their chamber is')
      +f('extra_contact','Additional contact','e.g. clerk - 9830957371')
    +'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>'
    +'<button class="btn btn-primary" onclick="advSave('+(id||'null')+')"><i class="fa-solid fa-check"></i> '+(id?'Update':'Add')+'</button></div>','md');
};
window.advCall=function(nm,num){ try{ usageQueue('legal.advocates.click_to_call_advocate','view',{title:nm||num, phone:num}); }catch(_e){} };
window.advSave=async function(id){
  const g=k=>{const el=$('advF_'+k);return el?(el.value||'').trim()||null:null;};
  const name=g('advocate_name');
  if(!name){toast('Enter the advocate\'s name','err');return;}
  const row={advocate_name:name,case_type:g('case_type'),court:g('court'),state_dist:g('state_dist'),
    phone:g('phone'),chamber:g('chamber'),extra_contact:g('extra_contact'),updated_at:new Date().toISOString()};
  const {error}=id?await sb.from('legal_advocates').update(row).eq('id',id)
                  :await sb.from('legal_advocates').insert(row);
  if(error){toast(error.message,'err');return;}
  /* Logged here, not through USAGE_MAP: one Save button both adds and edits, and the fixed key
     there counted every edit as an advocate added. id is what tells them apart. */
  try{ usageQueue(id?'legal.advocates.edit_advocate':'legal.advocates.add_advocate', id?'update':'create',
    {title:name, court:row.court||undefined}); }catch(_e){}
  closeModal();toast(id?'Advocate updated':'Advocate added','ok');
  legalAdvocates();
};
window.advDelete=async function(id){
  const r=(window._advRows||[]).filter(x=>String(x.id)===String(id))[0]||{};
  const ok=await confirmDialog('Remove <b>'+esc(r.advocate_name||'this advocate')+'</b> from the panel? This cannot be undone.',{okLabel:'Remove'});
  if(!ok)return;
  const {error}=await sb.from('legal_advocates').delete().eq('id',id);
  if(error){toast(error.message,'err');return;}
  toast('Removed','ok'); legalAdvocates();
};

function misScoreTag(s){
  if(s===null)return '<span class="mis-ptag mis-ptag--gray">Pending</span>';
  if(s===1)return '<span class="mis-ptag mis-ptag--green">+1</span>';
  if(s===0)return '<span class="mis-ptag mis-ptag--amber">0</span>';
  return '<span class="mis-ptag mis-ptag--red">−1</span>';
}
// Each ACTION is scored on how far ahead of its Action Date it was actually executed:
//   executed 8+ days early -> +1,  1..7 days early -> 0,  on the day / late / not yet executed -> -1/none.
// A case's score is the SUM of its actions' scores, so a case can carry several. Completing a case
// (slide-left in MIS) drops it from the Scoreboard entirely.
function misActionScore(a){
  if(!a||!a.action_date_iso||!a.executed_date_iso)return null;
  const gap=Math.round((new Date(String(a.action_date_iso).slice(0,10)+'T00:00:00')-new Date(String(a.executed_date_iso).slice(0,10)+'T00:00:00'))/86400000);
  if(gap>7)return 1;
  if(gap>0)return 0;
  return -1;
}
/* The Scoreboard is paused while the action cycle beds in: it scored off action dates, and those
   have just been cleared for a fresh start, so any figure it showed now would be meaningless.
   The workings below are left intact - flip SCOREBOARD_LIVE back to true to bring it back. */
const SCOREBOARD_LIVE=false;
/* THE SCOREBOARD HAS TWO OF ITS OWN TABS.
   MIS scores a CASE on how much notice an action was given before its date. Notice scores a
   NOTICE on how many days before its deadline the task was finished. Different things measured
   differently, so they are two tables rather than one with a type column. This wrapper owns the
   tab strip; each renderer writes into #legalSbHost beneath it. */
async function legalScoreboard(which){
  const sbTab=(which==='notice')?'notice':'mis';
  setCrumb(['Legal','Scoreboard',sbTab==='notice'?'Notice':'MIS']);
  const hAct=$('legalHeadActions');if(hAct)hAct.innerHTML='';
  const host=$('legalBody');if(!host)return;
  host.innerHTML=`<div class="tabs" style="margin:0 0 14px">
      <div class="tab ${sbTab==='mis'?'active':''}" onclick="navTo('legal/scoreboard')"><i class="fa-solid fa-gavel"></i> MIS</div>
      <div class="tab ${sbTab==='notice'?'active':''}" onclick="navTo('legal/scoreboard/notice')"><i class="fa-solid fa-envelope-open-text"></i> Notice</div>
    </div><div id="legalSbHost"><div class="loader"><div class="spin"></div></div></div>`;
  if(sbTab==='notice') legalScoreboardNotice(); else legalScoreboardMIS();
}

async function legalScoreboardMIS(){
  const body=$('legalSbHost');if(!body)return;
  if(!SCOREBOARD_LIVE){
    body.innerHTML='<div class="card card-pad" style="max-width:620px;margin:26px auto;text-align:center">'
      +'<div style="font-size:34px;color:#1e3a8a;margin-bottom:12px"><i class="fa-solid fa-ranking-star"></i></div>'
      +'<div style="font-weight:700;font-size:17px;margin-bottom:8px">Scoreboard — coming soon</div>'
      +'<p style="color:var(--slate);font-size:13.5px;line-height:1.6;margin:0">'
      +'It scores each case on how much notice an action was given before its date. The action log has '
      +'just been cleared for a fresh start, so there is nothing meaningful to score yet — it will come '
      +'back once actions have been running for a while.</p>'
      +'<div style="margin-top:16px"><button class="btn" onclick="navTo(\'legal/mis\')"><i class="fa-solid fa-gavel"></i> Go to MIS</button></div>'
    +'</div>';
    return;
  }
  loader(body);
  let cases=[], actions=[];
  try{
    const {data:cd,error:ce}=await sb.from('mis_cases').select('id,case_type,cause_title,case_no,priority,completed_at'); if(ce)throw ce; cases=cd||[];
    const {data:ad}=await sb.from('mis_actions').select('case_id,action_date_iso,executed_date_iso'); actions=ad||[];
  }catch(e){toast((e&&e.message)||'Could not load Scoreboard','err');}
  // Every case with actions is scored (completed cases stay on the Scoreboard, keeping their score);
  // each case aggregates the scores of its executed actions.
  const byCase={};
  cases.forEach(c=>{ byCase[c.id]={c:c,total:0,scored:0,count:0}; });
  actions.forEach(a=>{ const g=byCase[a.case_id]; if(!g)return; g.count++; const s=misActionScore(a); if(s!==null){ g.total+=s; g.scored++; } });
  const list=Object.values(byCase).filter(g=>g.count>0).sort((a,b)=>(b.total-a.total)||(b.scored-a.scored));
  const grand=list.reduce((a,g)=>a+g.total,0);
  const totalScored=list.reduce((a,g)=>a+g.scored,0);
  const scoreCell=n=>{const col=n>0?'#16a34a':(n<0?'#dc2626':'#64748b');return `<span style="font-weight:800;color:${col}">${n>0?'+':''}${n}</span>`;};
  body.innerHTML=`<div class="card" style="overflow:hidden"><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="background:var(--bg-subtle,#f8fafc)">
      ${['Case Type','Cause Title / Parties','Case No.','Priority','Actions','Score'].map(l=>`<th style="padding:10px 12px;text-align:left;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--slate);border-bottom:2px solid var(--line)">${esc(l)}</th>`).join('')}
    </tr></thead>
    <tbody>
      ${list.length?list.map(g=>{
        const r=g.c;
        return `<tr style="border-bottom:1px solid var(--line-2)">
          <td style="padding:11px 12px;font-weight:600">${esc(r.case_type||'—')}</td>
          <td style="padding:11px 12px">${esc(r.cause_title||'—')}${r.completed_at?' <span style="font-size:10px;font-weight:700;color:#16a34a;background:#dcfce7;padding:2px 7px;border-radius:99px;white-space:nowrap">✓ Completed</span>':''}</td>
          <td style="padding:11px 12px;color:var(--slate)">${esc(r.case_no||'—')}</td>
          <td style="padding:11px 12px">${misPriorityTag(r.priority)}</td>
          <td style="padding:11px 12px;color:var(--slate)">${g.scored} of ${g.count} scored</td>
          <td style="padding:11px 12px">${scoreCell(g.total)}</td>
        </tr>`;
      }).join(''):`<tr><td colspan="6"><div class="empty" style="padding:30px"><i class="fa-regular fa-calendar-check"></i><div>No scored cases yet — score comes from executed actions (Action Date vs Execution Date).</div></div></td></tr>`}
    </tbody>
    ${list.length?`<tfoot><tr style="background:var(--bg-subtle,#f8fafc)">
      <td colspan="5" style="padding:11px 12px;text-align:right;font-weight:700;border-top:2px solid var(--line)">Total (${totalScored} action${totalScored===1?'':'s'} scored across ${list.length} case${list.length===1?'':'s'})</td>
      <td style="padding:11px 12px;font-weight:800;border-top:2px solid var(--line)">${scoreCell(grand)}</td>
    </tr></tfoot>`:''}
  </table></div></div>`;
}
/* ============================ LEGAL NOTICES ============================
   A notice uploaded to Legal > Legal Notice is read by the Gemini pass in legal-ocr-batch, which
   pulls four fields off the page and raises one task for the Legal team. These two screens are
   the other end of that: the tracker shows every notice and whether it has been dealt with, the
   scoreboard scores the ones that have.

   Both read a SECURITY DEFINER function rather than the table, so the visibility rule is applied
   once per query instead of once per row - and so that staff who can reach Legal but hold no
   `doc` role can still see their own work. */
function lnPill(state){
  const m={Done:['#16a34a','#dcfce7'],Overdue:['#dc2626','#fee2e2'],Outstanding:['#b45309','#fef3c7']};
  const c=m[state]||['#64748b','#f1f5f9'];
  return `<span style="font-size:10.5px;font-weight:700;color:${c[0]};background:${c[1]};padding:2px 8px;border-radius:999px;white-space:nowrap">${esc(state||'—')}</span>`;
}
function lnTypeTag(t){
  if(!t) return '<span style="color:var(--slate)">—</span>';
  const c=t==='Government'?'#1d4ed8':(t==='Customer'?'#7c3aed':'#64748b');
  return `<span style="font-size:10.5px;font-weight:700;color:${c}">${esc(t)}</span>`;
}

async function legalNotices(){
  setCrumb(['Legal','Notices']);
  const hAct=$('legalHeadActions');if(hAct)hAct.innerHTML='';
  const body=$('legalBody');if(!body)return;
  loader(body);
  let rows=[];
  try{
    const {data,error}=await sb.schema('acc').rpc('legal_notice_tracker');
    if(error)throw error;
    rows=data||[];
  }catch(e){
    body.innerHTML='<div class="empty" style="padding:40px"><i class="fa-regular fa-circle-xmark"></i><div>Could not load notices</div><div style="font-size:12px;color:var(--slate);margin-top:6px">'+esc((e&&e.message)||'')+'</div></div>';
    return;
  }
  window._lnRows=rows;   // the edit dialog reads the row it is correcting from here

  const open=rows.filter(r=>r.state!=='Done').length;
  const late=rows.filter(r=>r.state==='Overdue').length;
  const head=['Sent by Whom','Clients / Applicants','Subject','Type','Uploaded','Due','Completion Date','Status'];
  const kpis=[['Total notices',rows.length,'#1e3a8a'],['Outstanding',open,'#b45309'],['Overdue',late,'#dc2626']];

  const BTN='display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 13px;'
    +'border-radius:8px;font-size:12.5px;font-weight:600;line-height:1;cursor:pointer;'
    +'background:var(--bg-card,#fff);transition:opacity .12s,background .12s';

  let h='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">';
  kpis.forEach(function(k){
    h+='<div class="card" style="min-width:146px;padding:11px 15px">'
      +'<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--slate)">'+k[0]+'</div>'
      +'<div style="font-size:23px;font-weight:800;line-height:1.15;color:'+k[2]+';margin-top:3px">'+k[1]+'</div></div>';
  });

  /* margin-left:auto pins the actions to the right edge of the same row. On a narrow window the
     row wraps and they drop below the cards rather than squeezing them - which is why the count
     line sits inside the group and not between the cards and the buttons. */
  h+='<div id="lnBar" style="margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    /* Search narrows the list to notices whose sender or client/applicant contains what is typed.
       It filters the rows already on the page, so it is instant and keeps working offline. */
    +'<div style="position:relative"><i class="fa-solid fa-magnifying-glass" style="position:absolute;left:11px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--slate)"></i>'
      +'<input id="lnSearch" type="search" placeholder="Search sender or client…" value="'+esc(window._lnQ||'')+'" oninput="lnFilter(this.value)" '
      +'style="height:34px;width:240px;padding:0 12px 0 31px;border:1px solid var(--line,#e2e8f0);border-radius:8px;font:inherit;font-size:12.5px;background:var(--bg-card,#fff);color:var(--ink,#0f172a)"></div>'
    +'<span id="lnCount" style="font-size:12px;color:var(--slate);margin-right:2px"></span>'
    +'<button id="lnEditBtn" onclick="lnEditSelected()" style="'+BTN+';border:1px solid var(--line,#e2e8f0);color:var(--ink,#0f172a)">'
      +'<i class="fa-solid fa-pen" style="font-size:11px"></i> Edit</button>'
    +'<button id="lnDelBtn" onclick="lnDeleteSelected()" style="'+BTN+';border:1px solid #fecaca;color:#dc2626">'
      +'<i class="fa-solid fa-trash" style="font-size:11px"></i> Delete</button>'
    +'<button id="lnClrBtn" onclick="lnClearSel()" style="'+BTN+';border:1px solid transparent;color:var(--slate)">Clear</button>'
  +'</div>';
  h+='</div>';

  h+='<style>.ln-row:hover{background:var(--bg-subtle,#f8fafc)}'
    +'#lnBar button:not(:disabled):hover{background:var(--bg-subtle,#f1f5f9)}'
    +'.lnChk{width:15px;height:15px;cursor:pointer;accent-color:#1e3a8a;vertical-align:middle}'
    /* after the plain hover rule, so an overdue row keeps its wash when hovered */
    +'.ln-late{background:rgba(220,38,38,.07)}'
    +'.ln-late:hover{background:rgba(220,38,38,.13)}</style>';
  h+='<div class="card" style="overflow:hidden"><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
    +'<thead><tr style="background:var(--bg-subtle,#f8fafc)">'
      +'<th style="padding:10px 12px;width:34px"><input type="checkbox" id="lnAll" onclick="lnToggleAll(this)" title="Select all"></th>';
  head.forEach(function(l){
    h+='<th style="padding:10px 12px;text-align:left;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--slate);white-space:nowrap">'+l+'</th>';
  });
  h+='</tr></thead><tbody>';

  if(rows.length){
    rows.forEach(function(r){
      const parties=(r.parties&&r.parties.length)?r.parties.join('; '):'—';
      const subj=r.subject||'—';
      /* The task is the thing people act on, so the row opens it. The checkbox cell stops the
         click, otherwise selecting a row would navigate away from the list. */
      const go=r.task_id?(' onclick="navTo(\'tasks/task/'+r.task_id+'\')" style="cursor:pointer"'):'';
      const q=((r.sent_by||'')+' '+((r.parties||[]).join(' '))).toLowerCase();
      h+='<tr'+go+' class="ln-row'+(r.state==='Overdue'?' ln-late':'')+'" data-q="'+esc(q)+'" style="border-bottom:1px solid var(--line-2)">'
        +'<td style="padding:11px 12px" onclick="event.stopPropagation()"><input type="checkbox" class="lnChk" value="'+r.id+'" onclick="event.stopPropagation();lnSelSync()"></td>'
        +'<td style="padding:11px 12px;font-weight:600">'+esc(r.sent_by||'—')+'</td>'
        +'<td style="padding:11px 12px">'+esc(parties)+'</td>'
        /* Subjects on a legal notice run to a paragraph - the whole property description. One
           line with an ellipsis keeps the table readable; the full text is the hover title. */
        +'<td style="padding:11px 12px;color:var(--slate);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(subj)+'">'+esc(subj)+'</td>'
        +'<td style="padding:11px 12px">'+lnTypeTag(r.notice_type)+'</td>'
        +'<td style="padding:11px 12px;color:var(--slate);white-space:nowrap">'+(r.uploaded_on?fmtDate(r.uploaded_on):'—')+'</td>'
        +'<td style="padding:11px 12px;color:var(--slate);white-space:nowrap">'+(r.due_date?fmtDate(r.due_date):'—')+'</td>'
        +'<td style="padding:11px 12px;white-space:nowrap">'+(r.completed_on?fmtDate(r.completed_on):'<span style="color:var(--slate)">—</span>')+'</td>'
        +'<td style="padding:11px 12px">'+lnPill(r.state)+'</td>'
      +'</tr>';
    });
  } else {
    h+='<tr><td colspan="'+(head.length+1)+'"><div class="empty" style="padding:34px"><i class="fa-regular fa-envelope"></i>'
      +'<div>No legal notices yet</div><div style="font-size:12px;color:var(--slate);margin-top:6px">'
      +'Upload one to Documents &rsaquo; Legal Notice. It is read automatically and a task is raised for the Legal team.</div></div></td></tr>';
  }
  h+='<tr id="lnNoMatch" style="display:none"><td colspan="'+(head.length+1)+'"><div class="empty" style="padding:28px"><i class="fa-solid fa-magnifying-glass"></i>'
    +'<div>No notice matches that sender or client</div></div></td></tr>';
  h+='</tbody></table></div></div>';

  body.innerHTML=h;
  lnFilter(window._lnQ||'');
}

/* ---- search: sender and clients/applicants ----------------------------------------------- */
window.lnFilter=function(v){
  window._lnQ=v||'';
  const words=window._lnQ.toLowerCase().split(/\s+/).filter(Boolean);
  let shown=0;
  document.querySelectorAll('tr.ln-row').forEach(function(tr){
    // every word typed must appear, in any order ("sharma notice" finds "Notice from R. Sharma")
    const ok=!words.length||words.every(w=>(tr.dataset.q||'').indexOf(w)>-1);
    tr.style.display=ok?'':'none';
    // a hidden row cannot stay ticked, or Delete would act on notices nobody can see
    if(!ok){ const c=tr.querySelector('.lnChk'); if(c) c.checked=false; }
    if(ok) shown++;
  });
  const nm=$('lnNoMatch'); if(nm) nm.style.display=(words.length&&!shown&&document.querySelector('tr.ln-row'))?'':'none';
  lnSelSync();
};
// the rows the search leaves on screen
function lnVisibleBoxes(){ return [...document.querySelectorAll('tr.ln-row')].filter(tr=>tr.style.display!=='none').map(tr=>tr.querySelector('.lnChk')).filter(Boolean); }

/* ---- selection -------------------------------------------------------------------------- */
function lnSelected(){ return [...document.querySelectorAll('.lnChk:checked')].map(c=>Number(c.value)); }
window.lnSelSync=function(){
  const n=lnSelected().length;
  const cnt=$('lnCount'), ed=$('lnEditBtn'), del=$('lnDelBtn'), clr=$('lnClrBtn'), all=$('lnAll');
  if(cnt) cnt.textContent = n ? (n + ' selected') : '';
  /* Both actions stay on the page and grey out instead of appearing and disappearing - a button
     that is not there cannot be discovered, and a row of controls that jumps into existence
     moves the table under the pointer. */
  const grey=(b,on,why)=>{ if(!b) return; b.disabled=!on; b.style.opacity=on?'':'0.4';
                           b.style.cursor=on?'':'not-allowed'; b.title=on?'':why; };
  // Editing is correcting ONE document against what is printed on it; there is no sensible bulk
  // version of that, so it is offered only when exactly one row is ticked.
  grey(ed,  n===1, n ? 'Select exactly one notice to edit' : 'Select one notice to edit');
  grey(del, n>0,   'Select at least one notice to delete');
  if(clr) clr.style.display = n>0 ? '' : 'none';
  const boxes=lnVisibleBoxes();
  if(all){ all.checked = boxes.length>0 && n===boxes.length; all.indeterminate = n>0 && n<boxes.length; }
  // while searching, say how many of the notices are showing
  const tot=document.querySelectorAll('tr.ln-row').length;
  if(cnt&&!n&&(window._lnQ||'').trim()) cnt.textContent=boxes.length+' of '+tot+' shown';
};
// select-all ticks only the notices the search is showing
window.lnToggleAll=function(cb){ lnVisibleBoxes().forEach(c=>{c.checked=cb.checked;}); lnSelSync(); };
window.lnClearSel=function(){ document.querySelectorAll('.lnChk').forEach(c=>{c.checked=false;}); lnSelSync(); };

/* ---- correcting what the model read ----------------------------------------------------- */
window.lnEditSelected=function(){
  const s=lnSelected();
  if(s.length!==1){ toast('Select exactly one notice to edit','err'); return; }
  lnEditModal(s[0]);
};
window.lnEditModal=function(id){
  const r=(window._lnRows||[]).filter(x=>String(x.id)===String(id))[0];
  if(!r){ toast('Notice not found','err'); return; }
  const types=['Customer','Government','Other'];
  let opts='';
  types.forEach(function(t){ opts+='<option'+(t===r.notice_type?' selected':'')+'>'+t+'</option>'; });
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Correct notice details</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm">'
      +'<div style="font-size:12px;color:var(--slate);margin-bottom:4px">'+esc(r.file_name||'')+'</div>'
      +'<label>Sent by whom<input id="lnF_header" value="'+esc(r.sent_by||'')+'" placeholder="The name in large type at the top"></label>'
      +'<div class="two">'
        +'<label>Type<select id="lnF_type">'+opts+'</select></label>'
        +'<label>Clients / Applicants<input id="lnF_parties" value="'+esc((r.parties||[]).join('; '))+'" placeholder="Separate with a semicolon"></label>'
      +'</div>'
      +'<label>Subject<textarea id="lnF_subject" rows="4">'+esc(r.subject||'')+'</textarea></label>'
      +'<div style="font-size:11.5px;color:var(--slate)">The task is renamed to match the sender. Its due date and who it is assigned to do not change.</div>'
    +'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>'
    +'<button class="btn btn-primary" onclick="lnEditSave('+id+')"><i class="fa-solid fa-check"></i> Save</button></div>','md');
};
window.lnEditSave=async function(id){
  const g=k=>{const el=$('lnF_'+k);return el?(el.value||'').trim():'';};
  const header=g('header');
  if(!header){ toast('A notice needs a sender','err'); return; }
  // Semicolons separate people, because a client name can itself contain a comma.
  const parties=g('parties').split(';').map(x=>x.trim()).filter(Boolean);
  try{
    const {error}=await sb.schema('acc').rpc('legal_notice_edit',
      {p_id:Number(id),p_header:header,p_type:g('type'),p_parties:parties,p_subject:g('subject')});
    if(error)throw error;
    closeModal(); toast('Notice updated','ok'); legalNotices();
  }catch(e){ toast((e&&e.message)||'Could not save','err'); }
};

/* ---- removing a notice ------------------------------------------------------------------- */
window.lnDeleteSelected=function(){
  const ids=lnSelected();
  if(!ids.length){ toast('Nothing selected','err'); return; }
  const rows=(window._lnRows||[]).filter(r=>ids.indexOf(Number(r.id))>=0);
  let names='';
  rows.slice(0,6).forEach(function(r){ names+='<li>'+esc(r.sent_by||r.file_name||('#'+r.id))+'</li>'; });
  if(rows.length>6) names+='<li>and '+(rows.length-6)+' more</li>';
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-triangle-exclamation" style="color:#dc2626"></i> Delete '+ids.length+' notice'+(ids.length>1?'s':'')+'?</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body">'
      +'<ul style="margin:0 0 12px 18px;font-size:13px">'+names+'</ul>'
      +'<div style="font-size:12.5px;color:var(--slate);line-height:1.6">This removes the notice from this tracker, the task raised for it, and the document record. '
      +'<b>The uploaded file itself stays in storage</b> and can be re-filed if this was a mistake. This cannot be undone from here.</div>'
    +'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>'
    +'<button class="btn" style="background:#dc2626;color:#fff;border-color:#dc2626" onclick="lnDeleteRun()"><i class="fa-solid fa-trash"></i> Delete</button></div>','md');
  window._lnPendingDelete=ids;
};
window.lnDeleteRun=async function(){
  const ids=window._lnPendingDelete||[];
  try{
    const {data,error}=await sb.schema('acc').rpc('legal_notice_delete',{p_ids:ids});
    if(error)throw error;
    closeModal();
    const n=(data||[]).length;
    toast(n+' notice'+(n===1?'':'s')+' deleted','ok');
    window._lnPendingDelete=null; legalNotices();
  }catch(e){ toast((e&&e.message)||'Could not delete','err'); }
};

/* +1 two or more days early, 0 one day early or on the day, -1 late. The gap at one day is
   deliberate and was asked for: a notice answered the day before it was due was not answered
   early, it was answered just in time. The figures come from the database so the page and any
   later report cannot disagree about a score. */
/* +1 two or more days early, 0 one day early or on the day, -1 late. The gap at one day is
   deliberate and was asked for: a notice answered the day before it was due was not answered
   early, it was answered just in time.

   EVERY notice has a row, finished or not. Listing only the scored ones meant a notice uploaded
   this morning was simply absent, so this screen disagreed with the tracker about how many
   notices exist - which reads as broken rather than as "nothing to score yet". An outstanding
   notice shows a dash, not a zero: it has not been scored, which is a different thing from
   having scored nothing, and the total ignores it entirely. */
async function legalScoreboardNotice(){
  const body=$('legalSbHost');if(!body)return;
  loader(body);
  let rows=[];
  try{
    const {data,error}=await sb.schema('acc').rpc('legal_notice_scoreboard');
    if(error)throw error;
    rows=data||[];
  }catch(e){
    body.innerHTML='<div class="empty" style="padding:40px"><i class="fa-regular fa-circle-xmark"></i><div>Could not load the notice scoreboard</div><div style="font-size:12px;color:var(--slate);margin-top:6px">'+esc((e&&e.message)||'')+'</div></div>';
    return;
  }

  const scored=rows.filter(function(r){ return r.points!==null && r.points!==undefined; });
  const grand=scored.reduce(function(a,r){ return a+(Number(r.points)||0); },0);
  const cell=function(n){
    const c=n>0?'#16a34a':(n<0?'#dc2626':'#64748b');
    return '<span style="font-weight:800;color:'+c+'">'+(n>0?'+':'')+n+'</span>';
  };
  const when=function(r){
    if(r.points===null||r.points===undefined) return '<span style="color:var(--slate)">not scored yet</span>';
    const d=Number(r.days_early);
    if(!isFinite(d)) return '—';
    if(d>0) return d+' day'+(d===1?'':'s')+' early';
    if(d===0) return 'on the due date';
    return (-d)+' day'+(d===-1?'':'s')+' late';
  };

  let h='<div class="card card-pad" style="margin-bottom:12px;font-size:12.5px;color:var(--slate)">'
    +'<b style="color:var(--ink)">How it is scored.</b> '
    +'<span style="color:#16a34a;font-weight:700">+1</span> finished two or more days before the due date &nbsp;·&nbsp; '
    +'<span style="color:#64748b;font-weight:700">0</span> one day early, or on the day &nbsp;·&nbsp; '
    +'<span style="color:#dc2626;font-weight:700">-1</span> finished late. '
    +'Every notice is due seven days after it was uploaded. A notice still outstanding is listed but not yet scored.'
  +'</div>';

  h+='<style>.lns-row:hover{background:var(--bg-subtle,#f8fafc)}'
    +'.ln-late{background:rgba(220,38,38,.07)}'
    +'.ln-late:hover{background:rgba(220,38,38,.13)}</style>';
  h+='<div class="card" style="overflow:hidden"><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
    +'<thead><tr style="background:var(--bg-subtle,#f8fafc)">';
  ['Notice','Assignee','Status','Completed','Due','Timing','Points'].forEach(function(l){
    h+='<th style="padding:10px 12px;text-align:left;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--slate);white-space:nowrap">'+l+'</th>';
  });
  h+='</tr></thead><tbody>';

  if(rows.length){
    rows.forEach(function(r){
      const unscored=(r.points===null||r.points===undefined);
      h+='<tr class="lns-row'+(r.state==='Overdue'?' ln-late':'')+'" style="border-bottom:1px solid var(--line-2)">'
        +'<td style="padding:11px 12px;font-weight:600">'+esc(r.notice||'—')+'</td>'
        +'<td style="padding:11px 12px">'+(r.assignee?esc(r.assignee):'<span style="color:var(--slate)">—</span>')+'</td>'
        +'<td style="padding:11px 12px">'+lnPill(r.state)+'</td>'
        +'<td style="padding:11px 12px;color:var(--slate);white-space:nowrap">'+(r.completed_on?fmtDate(r.completed_on):'<span style="color:var(--slate)">—</span>')+'</td>'
        +'<td style="padding:11px 12px;color:var(--slate);white-space:nowrap">'+(r.due_date?fmtDate(r.due_date):'—')+'</td>'
        +'<td style="padding:11px 12px;color:var(--slate);white-space:nowrap">'+when(r)+'</td>'
        +'<td style="padding:11px 12px">'+(unscored?'<span style="color:var(--slate)">—</span>':cell(Number(r.points)||0))+'</td>'
      +'</tr>';
    });
  } else {
    h+='<tr><td colspan="7"><div class="empty" style="padding:34px"><i class="fa-regular fa-star"></i>'
      +'<div>No notices yet</div><div style="font-size:12px;color:var(--slate);margin-top:6px">'
      +'A notice appears here as soon as it is uploaded, and is scored once its task is marked done.</div></div></td></tr>';
  }
  h+='</tbody>';

  if(scored.length){
    h+='<tfoot><tr style="background:var(--bg-subtle,#f8fafc)">'
      +'<td colspan="6" style="padding:11px 12px;text-align:right;font-weight:700;border-top:2px solid var(--line)">'
      +'Total across '+scored.length+' scored notice'+(scored.length===1?'':'s')
      +(rows.length>scored.length?(' · '+(rows.length-scored.length)+' still outstanding'):'')
      +'</td>'
      +'<td style="padding:11px 12px;font-weight:800;border-top:2px solid var(--line)">'+cell(grand)+'</td>'
    +'</tr></tfoot>';
  }
  h+='</table></div></div>';

  body.innerHTML=h;
}

/* ---- Causelist export ------------------------------------------------------------------
   Mirrors CAUSTLIST - AUGUST26.pdf: title, generated stamp, then
   SL NO. | CASE TYPE | CASE DETAILS | CASE NO. | DATE | Advocate incharge | Court Name |
   STATUS | ACTION NEEDED.
   A causelist covers a period, so it refuses to run until a date range is chosen. */
// Shared by View and Export - both need the identical sheet, one just renders it in a new
// tab instead of triggering a download. Returns null (having already shown its own warning
// toast) on every validation failure, so a caller never has to duplicate those checks, and
// a usage event only ever gets logged where a real sheet actually came out the other end.
function misBuildCauselist(){
  let win=misRangeDates();
  if(!win && MIS_RANGE==='custom'){
    toast('Pick both a From and a To date before exporting the causelist','warn');
    const sel=document.querySelector('#misRangeMenu .mis-range-btn');
    if(sel){ sel.focus(); sel.style.borderColor='var(--err)';
      setTimeout(function(){ sel.style.borderColor=''; },1800); }
    return null;
  }
  const rows=(window._misRows||[]).filter(misInRangeDated)
    .sort(function(a,b){ return String(misHearingIso(a)||'').localeCompare(String(misHearingIso(b)||'')); });
  if(!rows.length){ toast('No hearings fall in '+misRangeLabel(),'warn'); return null; }

  // Reproduces CAUSTLIST - AUGUST26.pdf exactly, down to the spelling and casing that came
  // out of that file: doc name "CAUSTLIST" top-left, sheet tab name top-right, page number,
  // an M/D/YYYY H:MM:SS stamp, the "<MONTH> CAUSTLIST" heading, and these nine column labels
  // with precisely this capitalisation.
  const now=new Date();
  const MONTHS=['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  // the month the listed hearings fall in, taken from the range start
  // On "All dates" the causelist still needs a month to head itself with - take it from the
  // earliest hearing actually listed.
  if(!win){
    const ds=rows.map(misHearingIso).filter(Boolean).sort();
    win={from:ds[0]||todayStr(), to:ds[ds.length-1]||todayStr()};
  }
  const first=new Date(win.from+'T00:00:00');
  const monthName=MONTHS[first.getMonth()];
  const tabName=monthName+String(first.getFullYear()).slice(2);   // e.g. AUGUST26, as in the PDF
  const h24=now.getHours();
  const stamp=(now.getMonth()+1)+'/'+now.getDate()+'/'+now.getFullYear()+' '
    +String(h24).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
  const dmy=function(iso){ if(!iso)return ''; const d=new Date(iso+'T00:00:00');
    return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear(); };
  const cell=function(v){ return esc(String(v==null?'':v).trim()).replace(/\n/g,'<br>'); };

  const html='<!doctype html><html><head><meta charset="utf-8"><title>CAUSTLIST</title>'
   // Portrait A4 with a comfortable margin. Nine columns on a portrait page only work if the
   // narrow ones are pinned tight and the wide text columns are allowed to wrap, so the widths
   // below are deliberate rather than even.
   +'<style>'
   +'@page{size:A4 portrait;margin:14mm 12mm}'
   +'*{box-sizing:border-box}'
   +'body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:0;font-size:8px;line-height:1.3}'
   +'.sheet{max-width:186mm;margin:0 auto;padding:8mm 0}'
   +'.pghead{display:flex;justify-content:space-between;font-size:8.5px;color:#000;'
     +'padding-bottom:3px;border-bottom:.5px solid #000;margin-bottom:5px}'
   +'.pgmeta{font-size:8px;color:#000}'
   +'.pgmeta.stamp{margin-bottom:12px}'
   +'h1{font-size:13px;font-weight:700;margin:0 0 10px;text-align:center;letter-spacing:.06em}'
   +'table{width:100%;border-collapse:collapse;table-layout:fixed}'
   +'th,td{border:.5px solid #000;padding:4px 4px;vertical-align:top;word-wrap:break-word;overflow-wrap:anywhere;line-height:1.3}'
   +'th{font-weight:700;text-align:center;font-size:8px;background:#ececec;letter-spacing:.02em}'
   +'tbody tr:nth-child(even){background:#f7f7f7}'
   +'tr{page-break-inside:avoid}'
   +'thead{display:table-header-group}'
   +'td.sl{text-align:center}'
   +'td.dt{white-space:nowrap;text-align:center}'
   +'@media print{.sheet{max-width:none;padding:0}}'
   +'@media screen{body{background:#525659;padding:18px 0}'
     +'.sheet{background:#fff;width:210mm;max-width:96vw;padding:14mm 12mm;box-shadow:0 4px 22px rgba(0,0,0,.4)}}'
   +'</style></head><body>'
   +'<div class="sheet">'
   +'<div class="pghead"><span>CAUSTLIST</span><span>'+esc(tabName)+'</span></div>'
   +'<div class="pgmeta">1</div>'
   +'<div class="pgmeta stamp">'+esc(stamp)+'</div>'
   +'<h1>'+esc(monthName)+' CAUSTLIST</h1>'
   +'<table><colgroup>'
   +'<col style="width:5%"><col style="width:9%"><col style="width:21%"><col style="width:11%">'
   +'<col style="width:8%"><col style="width:11%"><col style="width:11%"><col style="width:12%"><col style="width:12%">'
   +'</colgroup><thead><tr>'
   +'<th>SL NO.</th><th>CASE TYPE</th><th>CASE DETAILS</th><th>CASE NO.</th><th>DATE</th>'
   +'<th>Advocate incharge</th><th>Court Name</th><th>STATUS</th><th>ACTION NEEDED</th>'
   +'</tr></thead><tbody>'
   +rows.map(function(r,i){
      return '<tr><td class="sl">'+(i+1)+'</td>'
        +'<td>'+cell(r.case_type)+'</td>'
        +'<td>'+cell(r.cause_title)+'</td>'
        +'<td>'+cell(r.case_no)+'</td>'
        +'<td class="dt">'+esc(dmy(misHearingIso(r)))+'</td>'
        +'<td>'+cell(r.advocate_incharge)+'</td>'
        +'<td>'+cell(r.court)+'</td>'
        +'<td>'+cell(r.status)+'</td>'
        +'<td>'+cell(r.action_needed)+'</td></tr>';
    }).join('')
   +'</tbody></table>'
   +'</div></body></html>';

  return {html:html, tabName:tabName, rows:rows};
}
// Downloads as a file rather than opening a tab. Opening the saved file shows the causelist
// laid out exactly as it renders here — print it from the browser's own File > Print when needed.
/* What a causelist row is actually about: the window it covers and how many matters came out of
   it. Six exports and six views sat in the report looking identical, saying only that somebody had
   pressed a button. Both facts are already in hand at the log site - misBuildCauselist hands back
   the rows it listed, and misRangeLabel formats the window - so this reads them rather than
   plumbing anything new. On "All dates" there is no window to name, and the heading says so. */
function usbCauselistMeta(built){
  try{
    const n=(built&&built.rows&&built.rows.length)||0;
    return {range:misRangeLabel()||'All dates', cases:n+' case'+(n===1?'':'s')};
  }catch(e){ return null; }
}
window.misExportCauselist=async function(){
  const built=misBuildCauselist();
  if(!built) return;   // misBuildCauselist already toasted why
  const rows=built.rows;
  try{
    const url=URL.createObjectURL(new Blob([built.html],{type:'text/html;charset=utf-8'}));
    const a=document.createElement('a');
    a.href=url; a.download='CAUSTLIST - '+built.tabName+'.html'; a.style.display='none';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); },1500);
  }catch(e){ toast('Could not export the causelist: '+((e&&e.message)||e),'err'); return; }
  toast('Causelist exported — '+rows.length+' matter'+(rows.length===1?'':'s'),'ok');
  // Logged here, after the download has actually fired, rather than left to the generic
  // USAGE_MAP wrapper - that would have counted a click that was warned off by
  // misBuildCauselist (no date range, or nothing in range) as a use just the same as a real
  // export, which is exactly the bug that made "1 use" unverifiable as a real success.
  try{ usageQueue('legal.mis.export_causelist','export', usbCauselistMeta(built)); }catch(_e){}
  // Every matter an export just produced now has to be marked action-needed or not before the
  // export counts as done - clrevMaybeOpen no-ops if every one of them was already answered by
  // an earlier, overlapping export.
  await clrevMaybeOpen(rows);
};

/* ---- Causelist export review: action-needed popup -----------------------------------------
   Whoever exported a causelist, or is just starting a new session with matters still unanswered,
   gets asked to say, for each one, whether it needs action and — if it does — by when and who in
   Legal is doing it. That answer becomes a task delegated from businessanalyst@thejaingroup.com,
   due the date picked here, assigned to the person picked here. A case already answered
   (causelist_reviewed_at set), or already carrying an open or executed action from the ordinary
   per-case action tracker, is never asked about again.

   The popup itself can be closed with the X — but closing it decides nothing: nothing is written
   to the database until Submit runs, so whatever was still unanswered stays unanswered, and
   clrevCheckPending() (called once from boot(), i.e. once per page load — this app is multi-page,
   so that is effectively "every new session") puts the same popup straight back up the next time
   JainE is opened. Submit is still the only way to actually clear a matter off this list. */
window._clrevRows=[]; window._clrevLegal=[];
// Set by a caller that needs to know when a clrev popup actually finished (answered or closed) -
// the Causelist Reviews tab uses this to repaint itself with the fresh status instead of going
// stale the moment its own "Answer now" popup closes. Cleared right after it fires, once.
window._clrevOnDone=null;
// A case where action has already been taken - an open action already logged (action_needed) or
// one already carried out (action_executed_date) - has nothing left for this popup to ask about,
// on top of one this popup itself already reviewed (causelist_reviewed_at). None of this touches
// what the export file itself lists - that stays every matter in the range, unfiltered.
function clrevAlreadyActioned(r){
  return !!r.causelist_reviewed_at || !!String(r.action_needed||'').trim() || !!String(r.action_executed_date||'').trim();
}
function clrevPrepRows(rows){
  return (rows||[]).map(function(r){ return {id:r.id, case_no:r.case_no, case_type:r.case_type,
    cause_title:r.cause_title, court:r.court, hearing:misHearingIso(r), needed:null, due:'', person:''}; });
}
async function clrevLoadLegal(){
  const people=await getPeople();
  window._clrevLegal=people.filter(function(p){ return Array.isArray(p.depts)&&p.depts.indexOf('Legal')!==-1; })
    .sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });
}
async function clrevMaybeOpen(rows){
  const pending=(rows||[]).filter(function(r){ return !clrevAlreadyActioned(r); });
  if(!pending.length) return;
  // Claim these cases as this exporter's to review, written immediately (not left until Submit) so
  // it survives a closed tab or a later session — clrevCheckPending() only ever shows a case to
  // whoever holds this claim. Re-exporting an overlapping range later just re-claims it for
  // whoever ran that export, which is the point: it should nag the person who most recently
  // downloaded it, not whoever exported it first.
  const ids=pending.map(function(r){return r.id;});
  try{
    await sb.from('mis_cases').update({causelist_pending_by:state.email}).in('id',ids);
    pending.forEach(function(r){ r.causelist_pending_by=state.email; });
    await sb.from('mis_causelist_review_log').insert(ids.map(function(id){
      return {case_id:id, event:'exported', actor:state.email};
    }));
  }catch(e){}
  await clrevLoadLegal();
  window._clrevRows=clrevPrepRows(pending);
  clrevRender();
}
// Called once from boot(), after auth resolves - only for the person who actually exported a
// causelist and left it unanswered (causelist_pending_by = them), never for anyone else with Legal
// MIS access. Only cases with a real hearing date are in scope (the same universe a causelist ever
// draws from), so this never turns into "review every case in the system".
async function clrevCheckPending(){
  if(!(typeof pageAllowed==='function') || !pageAllowed('legal')) return;
  if(!state.email) return;
  let rows=[];
  try{
    const {data,error}=await sb.from('mis_cases').select('*').eq('causelist_pending_by',state.email);
    if(error) throw error;
    rows=(data||[]).filter(function(r){ return misHearingIso(r) && !clrevAlreadyActioned(r); });
  }catch(e){ return; }
  if(!rows.length) return;
  await clrevLoadLegal();
  window._clrevRows=clrevPrepRows(rows);
  clrevRender();
}
// Typed-in due-date/person values live only in the DOM between renders; a Yes/No toggle rebuilds
// the whole modal (to show or hide that row's fields), so whatever is currently in every input
// has to be pulled back into state first or it would be lost for every OTHER row on that rebuild.
function clrevSync(){
  (window._clrevRows||[]).forEach(function(r){
    const d=$('clrevDue_'+r.id), p=$('clrevPerson_'+r.id);
    if(d) r.due=d.value||'';
    if(p) r.person=p.value||'';
  });
}
window.clrevSetNeeded=function(id,val){
  clrevSync();
  const r=(window._clrevRows||[]).find(function(x){return x.id===id;});
  if(r) r.needed=val;
  clrevRender();
};
function clrevDmy(iso){ if(!iso)return '—'; const d=new Date(iso+'T00:00:00');
  return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear(); }
// A task to prepare for a hearing due AFTER the hearing is pointless - the MIS "Action Date" for a
// case has always mirrored its hearing date (the old per-case editor sets action_date=next_date
// the moment an action is raised), so this is the same rule the old system already enforced,
// applied here to the date this popup's task carries. Shared by both the popup and the Causelist
// Reviews tab's inline editor.
function clrevDueTooLate(due, hearing){ return !!(due && hearing && due > hearing); }
window.clrevDueChange=function(id){
  const r=(window._clrevRows||[]).find(function(x){return x.id===id;});
  const d=$('clrevDue_'+id);
  if(r && d && clrevDueTooLate(d.value, r.hearing)){
    toast('Due date can\'t be after the '+clrevDmy(r.hearing)+' hearing — reset to that date','warn');
    d.value=r.hearing;
  }
};
function clrevRender(){
  const rows=window._clrevRows||[], legal=window._clrevLegal||[];
  const isDone=function(r){ return r.needed===false || (r.needed===true && r.due && r.person); };
  const answered=rows.filter(isDone).length;
  const pct=rows.length?Math.round(100*answered/rows.length):0;
  const opts=legal.map(function(p){ return {v:esc(p.email), t:esc(p.name)}; });
  const body=rows.map(function(r,i){
    const yesOn=r.needed===true, noOn=r.needed===false;
    const personOpts='<option value="">— choose —</option>'+opts.map(function(o){
      return '<option value="'+o.v+'"'+(r.person===o.v?' selected':'')+'>'+o.t+'</option>'; }).join('');
    return '<div class="clrev-card'+(isDone(r)?' clrev-done':'')+'">'
      +'<div class="clrev-card-top">'
        +'<div class="clrev-meta">'
          +'<span class="clrev-badge">'+esc(r.case_no||('#'+(i+1)))+'</span>'
          +'<span class="clrev-sub">'+esc(r.case_type||'—')+' · '+esc(r.court||'—')+' · Hearing '+esc(clrevDmy(r.hearing))+'</span>'
          +'<div class="clrev-title">'+esc(r.cause_title||'—')+'</div>'
        +'</div>'
        +'<div class="clrev-toggle">'
          +'<button type="button" class="clrev-seg'+(yesOn?' on':'')+'" onclick="clrevSetNeeded('+r.id+',true)"><i class="fa-solid fa-flag"></i> Action needed</button>'
          +'<button type="button" class="clrev-seg'+(noOn?' on':'')+'" onclick="clrevSetNeeded('+r.id+',false)"><i class="fa-solid fa-check"></i> No action</button>'
        +'</div>'
      +'</div>'
      +(yesOn
        ? '<div class="clrev-fields">'
            +'<label>Due date'+(r.hearing?' <span style="font-weight:400;color:var(--slate)">(on or before the '+esc(clrevDmy(r.hearing))+' hearing)</span>':'')
              +'<input type="date" id="clrevDue_'+r.id+'" value="'+esc(r.due||'')+'"'+(r.hearing?' max="'+esc(r.hearing)+'"':'')+' onchange="clrevDueChange('+r.id+')"></label>'
            +'<label>Responsible (Legal)<select id="clrevPerson_'+r.id+'">'+personOpts+'</select></label>'
          +'</div>'
        : '')
      +'</div>';
  }).join('');
  openModal('<style>'
    +'.clrev-body{width:min(94vw,760px);max-height:74vh;overflow:auto;padding:20px 22px}'
    +'.clrev-progress-wrap{margin-bottom:16px}'
    +'.clrev-progress-txt{display:flex;justify-content:space-between;font-size:13px;color:var(--slate);margin-bottom:6px}'
    +'.clrev-progress-bar{height:6px;border-radius:99px;background:var(--line);overflow:hidden}'
    +'.clrev-progress-fill{height:100%;background:var(--brand);border-radius:99px;transition:width .2s}'
    +'.clrev-card{border:1px solid var(--line);border-left:3px solid var(--warn);border-radius:10px;padding:14px 16px;margin-bottom:12px;background:var(--card);transition:border-color .15s}'
    +'.clrev-card.clrev-done{border-left-color:var(--ok)}'
    +'.clrev-card-top{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:flex-start}'
    +'.clrev-meta{min-width:0}'
    +'.clrev-badge{display:inline-block;background:var(--brand-50);color:var(--brand);font-weight:700;font-size:12px;padding:2px 9px;border-radius:6px;margin-bottom:5px}'
    +'.clrev-sub{display:block;color:var(--slate);font-size:12.5px;margin-bottom:3px}'
    +'.clrev-title{font-weight:600;font-size:14px;line-height:1.35}'
    +'.clrev-toggle{display:flex;gap:6px;flex:none;background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:3px}'
    +'.clrev-seg{border:none;background:transparent;color:var(--slate);font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:7px;cursor:pointer;white-space:nowrap}'
    +'.clrev-seg:hover{color:var(--ink)}'
    +'.clrev-seg.on{background:var(--card);color:var(--brand);box-shadow:var(--shadow)}'
    +'.clrev-fields{display:flex;gap:12px;margin-top:12px;padding:12px;background:var(--bg);border-radius:8px;flex-wrap:wrap}'
    +'.clrev-fields label{flex:1;min-width:170px;font-size:12.5px;color:var(--slate);font-weight:600}'
    +'.clrev-fields input,.clrev-fields select{display:block;width:100%;margin-top:5px;padding:8px 10px;border:1px solid var(--line);border-radius:7px;font-size:13.5px;color:var(--ink);background:var(--card)}'
    +'</style>'
    +'<div class="modal-head"><h3><i class="fa-solid fa-scale-balanced" style="color:var(--brand)"></i> Causelist — action review</h3>'
      +'<span class="x" onclick="clrevClose()">&times;</span></div>'
    +'<div class="modal-body clrev-body">'
      +'<div class="clrev-progress-wrap"><div class="clrev-progress-txt"><span>Mark whether each matter needs action</span><span>'+answered+' of '+rows.length+'</span></div>'
        +'<div class="clrev-progress-bar"><div class="clrev-progress-fill" style="width:'+pct+'%"></div></div></div>'
      +(body||'<div style="color:var(--slate)">Nothing left to answer.</div>')
    +'</div>'
    +'<div class="modal-foot"><button class="btn btn-primary" onclick="clrevSubmit()">Submit</button></div>','lg');
}
// The X closes the popup without deciding anything (causelist_pending_by is untouched, so
// clrevCheckPending() puts the same rows back up next session) - logged here so the review log
// shows it was seen and skipped, not just silently missing between the export and whenever it's
// finally answered.
window.clrevClose=function(){
  clrevSync();
  const unanswered=(window._clrevRows||[]).filter(function(r){
    return !(r.needed===false || (r.needed===true && r.due && r.person));
  });
  if(unanswered.length){
    sb.from('mis_causelist_review_log').insert(unanswered.map(function(r){
      return {case_id:r.id, event:'closed_without_answering', actor:state.email};
    })).then(function(){},function(){});
  }
  closeModal();
  if(typeof window._clrevOnDone==='function'){ const fn=window._clrevOnDone; window._clrevOnDone=null; try{ fn(); }catch(e){} }
};
// The actual save for one row - task (create/update/delete as needed), mis_cases update, log
// entry, in-memory sync. Shared by clrevSubmit's loop (the modal - always a fresh answer, never an
// edit), the Causelist Reviews table's inline answer (also fresh), and its inline EDIT of an
// already-answered row.
//
// opts.prevTaskId is the task an earlier answer on this same case created, if any (read from that
// answer's own log entry - nothing on mis_cases points at it directly). Editing needed=true with a
// prevTaskId updates that task in place rather than creating a second one; editing needed=true
// without one creates a fresh task, same as a first answer; editing down to needed=false with a
// prevTaskId deletes that task outright, since a case marked no-action-needed shouldn't still carry
// one. opts.isEdit only controls which event name gets logged (edited vs answered) - it does not
// change what happens to the task, which is decided by whether prevTaskId is actually set.
async function clrevSaveOneRow(r, opts){
  opts=opts||{};
  const prevTaskId=opts.prevTaskId||null;
  let taskId=null;
  if(r.needed===true){
    if(prevTaskId){
      const {error:ue2}=await sb.schema('acc').from('ptasks').update({due_date:r.due}).eq('id',prevTaskId);
      if(ue2) throw ue2;
      const {data:cur}=await sb.schema('acc').from('ptask_assignees').select('email').eq('task_id',prevTaskId);
      const already=(cur||[]).some(function(x){return String(x.email||'').toLowerCase()===String(r.person||'').toLowerCase();});
      if(!already){
        const {error:de}=await sb.schema('acc').from('ptask_assignees').delete().eq('task_id',prevTaskId);
        if(de) throw de;
        const {error:ae2}=await sb.schema('acc').from('ptask_assignees').insert({task_id:prevTaskId, email:r.person});
        if(ae2) throw ae2;
      }
      taskId=prevTaskId;
    }else{
      const {data:t,error}=await sb.schema('acc').from('ptasks').insert({
        title:'Legal MIS — Case '+(r.case_no||r.id),
        description:(r.cause_title||'')+(r.court?' · '+r.court:'')+' · Hearing '+clrevDmy(r.hearing),
        delegator:'businessanalyst@thejaingroup.com', created_by:'businessanalyst@thejaingroup.com',
        due_date:r.due, order_index:0, source:'causelist'
      }).select().single();
      if(error) throw error;
      const {error:ae}=await sb.schema('acc').from('ptask_assignees').insert({task_id:t.id, email:r.person});
      if(ae) throw ae;
      taskId=t.id;
    }
  }else if(prevTaskId){
    // Edited down to "no action needed" - the task an earlier "action needed" answer created no
    // longer applies.
    try{ await sb.schema('acc').from('ptask_assignees').delete().eq('task_id',prevTaskId); }catch(_de){}
    const {error:de2}=await sb.schema('acc').from('ptasks').delete().eq('id',prevTaskId);
    if(de2) throw de2;
  }
  const {error:ue}=await sb.from('mis_cases').update({
    causelist_reviewed_at:new Date().toISOString(),
    causelist_action_needed:r.needed,
    causelist_reviewed_by:state.email,
    causelist_pending_by:null
  }).eq('id',r.id);
  if(ue) throw ue;
  try{ await sb.from('mis_causelist_review_log').insert({case_id:r.id, event:opts.isEdit?'edited':'answered', actor:state.email,
    detail:{needed:r.needed, due:r.needed?(r.due||null):null, person:r.needed?(r.person||null):null, task_id:taskId}}); }catch(_le){}
  // Keep the in-memory MIS table in sync too, so re-exporting an overlapping range later in this
  // same session doesn't ask about this case again without a full reload.
  const src=(window._misRows||[]).find(function(x){return x.id===r.id;});
  if(src){ src.causelist_reviewed_at=new Date().toISOString(); src.causelist_action_needed=r.needed; src.causelist_reviewed_by=state.email; src.causelist_pending_by=null; }
}
window.clrevSubmit=async function(){
  clrevSync();
  const rows=window._clrevRows||[];
  const bad=rows.find(function(r){ return r.needed===null || (r.needed===true && (!r.due||!r.person)); });
  if(bad){
    toast('Answer every matter first — case '+(bad.case_no||bad.id)+' is still incomplete','warn');
    clrevRender();
    return;
  }
  const late=rows.find(function(r){ return r.needed===true && clrevDueTooLate(r.due,r.hearing); });
  if(late){
    toast('Case '+(late.case_no||late.id)+'\'s due date is after its '+clrevDmy(late.hearing)+' hearing — fix it first','warn');
    clrevRender();
    return;
  }
  const btn=document.querySelector('.modal-foot .btn-primary');
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>'; }
  try{
    for(const r of rows){ await clrevSaveOneRow(r); }
  }catch(e){
    toast('Could not save: '+((e&&e.message)||e),'err');
    if(btn){ btn.disabled=false; btn.innerHTML='Submit'; }
    return;
  }
  window._clrevRows=[]; window._clrevLegal=[];
  closeModal();
  toast('Causelist reviewed — tasks created for every matter marked action-needed','ok');
  if(typeof window._clrevOnDone==='function'){ const fn=window._clrevOnDone; window._clrevOnDone=null; try{ fn(); }catch(e){} }
};
// View is the same sheet, opened for on-screen reading instead of forced onto disk - the
// causelist-format equivalent of every other module's Preview/Download pair.
window.misViewCauselist=function(){
  const built=misBuildCauselist();
  if(!built) return;
  const w=window.open('', '_blank');
  if(!w){ toast('Could not open a new tab — check your browser’s pop-up blocker','warn'); return; }
  w.document.open(); w.document.write(built.html); w.document.close();
  try{ usageQueue('legal.mis.view_causelist','view', usbCauselistMeta(built)); }catch(_e){}
};

window.misRowCheck=function(cb){
  const id=Number(cb.dataset.id);
  if(cb.checked) window._misSel.add(id); else window._misSel.delete(id);
  cb.closest('tr').classList.toggle('mis-selected',cb.checked);
  misUpdateToolbar();
};
window.misToggleAll=function(master){
  document.querySelectorAll('.mis-row-cb').forEach(cb=>{
    const tr=cb.closest('tr');
    if(tr.style.display==='none')return;
    cb.checked=master.checked;
    const id=Number(cb.dataset.id);
    if(master.checked) window._misSel.add(id); else window._misSel.delete(id);
    tr.classList.toggle('mis-selected',master.checked);
  });
  misUpdateToolbar();
};
window.misUpdateToolbar=function(){
  const n=window._misSel.size;
  const editBtn=$('misEditBtn'),delBtn=$('misDelBtn'),docsBtn=$('misDocsBtn');
  // Enabled/disabled is carried by the stylesheet (a dashed outline while waiting), not by fading
  // the button until it looks broken.
  if(editBtn){editBtn.disabled=(n!==1);editBtn.title=(n===1)?'Edit the selected case':'Select one case to edit';}
  if(delBtn){delBtn.disabled=(n===0);delBtn.title=(n>0)?'Delete the selected case(s)':'Select at least one case to delete';}
  /* Documents opens ONE case's folder, so it is off unless exactly one case is picked, and off
     again when that case has no papers filed against it. */
  if(docsBtn){
    let id=null; window._misSel.forEach(function(x){ id=x; });
    const has=(n===1)&&!!(window._misDocFolders||{})[id];
    docsBtn.disabled=!has;
    docsBtn.title=(n===0)?'Select a case to open its documents folder'
      :(n>1?'Documents opens one case at a time — select just one'
      :(has?('Open this case’s folder in Legal Documents ('+((window._misDocCounts||{})[id]||0)+' files)')
           :'No documents have been filed for this case yet'));
  }
};
const MIS_ALIASES={
  case_type:['case type','type of case'],
  cause_title:['cause title','parties','party'],
  case_no:['case no.','case no','case number','caseno'],
  previous_date:['previous date'],
  next_date:['next date'],
  priority:['priority'],
  advocate_incharge:['advocate in-charge','advocate incharge','advocate in charge','advocate'],
  court:['court'],
  status:['status','purpose'],
  remarks:['remarks','remark'],
  project_land_name:['project / land','project/land','project land','project name','land name','project'],
  date_of_filing:['date of filing','filing date'],
  pc_in_charge:['pc in-charge','pc incharge','pc in charge','pc'],
  file_no:['file no.','file no','file number'],
  cnr_no:['cnr no.','cnr no','cnr number']
};
function misKeywords(q){
  const stop=new Set(['give','giv','show','find','all','the','rows','row','cases','case','which','are','is','where','that','having','with','for','of','a','an','me','list','display','get','or','and','this','these']);
  return q.split(/[^a-z0-9]+/).filter(w=>w&&!stop.has(w));
}
/* Anything inside quotes is an exact phrase: "high court" only matches those two words together,
   in that order, inside one field. Quoting also switches off the smart field parser for that bit,
   so "priority is empty" in quotes searches for the literal words instead of being read as a
   condition. Straight and curly quotes both work, since phones insert curly ones. */
function misSplitPhrases(q){
  const phrases=[];
  let s=String(q||'');
  // A quote that hasn't been closed yet is mid-typing. Treating it as a live phrase made the list
  // jump about on every keystroke — the dangling quote is dropped and the words it holds are used
  // as ordinary terms until the closing quote arrives.
  const open=(s.match(/"/g)||[]).length%2===1;
  if(open) s=s.replace(/"([^"]*)$/,' $1');
  const rest=s.replace(/"([^"]*)"|“([^”]*)”/g,function(_m,a,b){
    const p=String(a!=null?a:(b!=null?b:'')).trim();
    if(p) phrases.push(p);
    return ' ';
  });
  return {phrases:phrases, rest:rest.replace(/\s+/g,' ').trim(), openQuote:open};
}
function misParseQuery(raw){
  const whole=(raw||'').toLowerCase().trim();
  const split=misSplitPhrases(whole);
  if(split.phrases.length||split.openQuote){
    // the unquoted remainder (if any) is still parsed normally and both must match
    const inner=split.rest?misParseQuery(split.rest):{type:'none'};
    return Object.assign({}, inner, {phrases:split.phrases, openQuote:split.openQuote});
  }
  const q=whole;
  if(!q)return {type:'none'};
  const candidates=[];
  Object.keys(MIS_ALIASES).forEach(k=>{
    MIS_ALIASES[k].forEach(alias=>{
      if(alias.length<3)return;
      let idx=-1;
      while((idx=q.indexOf(alias, idx+1))!==-1){ candidates.push({k, alias, start:idx, end:idx+alias.length}); }
    });
  });
  if(!candidates.length) return {type:'keywords', words:misKeywords(q)};
  // longest alias first at any given position, then earliest position
  candidates.sort((a,b)=> a.start-b.start || (b.end-b.start)-(a.end-a.start));
  const picked=[];
  let lastEnd=-1;
  candidates.forEach(c=>{ if(c.start>=lastEnd){ picked.push(c); lastEnd=c.end; } });

  const conds=[];
  for(let i=0;i<picked.length;i++){
    const c=picked[i];
    const nextStart=(i+1<picked.length)?picked[i+1].start:q.length;
    let arg=q.slice(c.end, nextStart).trim();
    arg=arg.replace(/^(is|are|:|=|contains|has|with|of|for|,|the)\s*/,'').trim();
    arg=arg.replace(/^(is|are)\s*/,'').trim();
    if(/^(not\s*(empty|blank)|filled|present|not\s*missing)\b/.test(arg)){
      conds.push({type:'filled', field:c.k});
    } else if(/^(empty|blank|missing|null)\b/.test(arg)){
      conds.push({type:'empty', field:c.k});
    } else if(arg){
      conds.push({type:'value', field:c.k, value:arg});
    }
  }
  if(!conds.length) return {type:'keywords', words:misKeywords(q)};
  return {type:'fields', conds};
}
window.misFilter=function(){
  // keep the custom range in sync before filtering
  const fEl=$('misFrom'), tEl=$('misTo');
  if(fEl) MIS_FROM=fEl.value||''; if(tEl) MIS_TO=tEl.value||'';
  const raw=($('misSearch').value||'').trim();
  const q=raw.toLowerCase();
  const wantsCompleteness=q.indexOf('completeness')!==-1;
  if(wantsCompleteness&&!window._misCompletenessOpen){ window._misCompletenessOpen=true; misStats(); }
  else if(!wantsCompleteness){ window._misCompletenessOpen=false; }
  const parsed=misParseQuery(q);
  let vis=0;
  document.querySelectorAll('#misTbody tr').forEach(tr=>{
    if(tr.classList.contains('mis-spacer')) return; // the pinned/rest divider row is never a searchable case
    const id=Number(tr.dataset.id);
    const row=(window._misRows||[]).find(r=>r.id===id);
    let show;
    if(!raw) show=true;
    else if(parsed.type==='none') show=true;          // quotes only, handled by the phrase gate below
    else if(parsed.type==='fields'){
      show=!!row&&parsed.conds.every(cond=>{
        const v=row[cond.field];
        const empty=(v===null||v===undefined||String(v).trim()==='');
        if(cond.type==='empty')return empty;
        if(cond.type==='filled')return !empty;
        return !empty && String(v).toLowerCase().indexOf(cond.value)!==-1;
      });
    }
    else { const blob=row?row._blob:''; show=parsed.words&&parsed.words.length?parsed.words.every(w=>blob.indexOf(w)!==-1):(blob.indexOf(q)!==-1); }
    // every quoted phrase must appear, word for word, in one of the row's fields
    if(show && parsed.phrases && parsed.phrases.length){
      const blob=row?row._blob:'';
      show=parsed.phrases.every(p=>blob.indexOf(p)!==-1);
    }
    if(show && row && !misInRange(row)) show=false;   // hearing-date window
    tr.style.display=show?'':'none';if(show)vis++;
  });
  const c=$('misCount');if(c)c.textContent=vis+' cases';
  document.querySelectorAll('#misTbody tr').forEach(tr=>{
    if(tr.style.display==='none'){
      const cb=tr.querySelector('.mis-row-cb');
      if(cb&&cb.checked){cb.checked=false;window._misSel.delete(Number(cb.dataset.id));tr.classList.remove('mis-selected');}
    }
  });
  misUpdateToolbar();
  // Instant substring search above stays as-is; this ADDS rows ChatGPT judges relevant in meaning
  // (e.g. "eviction" also finding a "tenant removal" row), a few hundred ms later, without touching
  // rows the fast keyword pass already matched.
  clearTimeout(window._misAiT);
  const qEl=$('misAiStatus'); if(qEl)qEl.textContent='';
  // Not while a quote is still open (the query isn't finished), and not for a quoted phrase at all
  // — asking for an exact phrase and then having extra "related" rows appear a moment later is the
  // other half of what made the list flicker.
  const skipAi=parsed.openQuote || (parsed.phrases&&parsed.phrases.length);
  if(raw&&raw.length>=3&&!skipAi) window._misAiT=setTimeout(()=>misAiSearch(raw),500);
  usageQueueDebounced('legal.mis.search_cases_incl_ai_semantic_search', raw);
};
window.misAiSearch=async function(raw){
  const statusEl=$('misAiStatus');
  try{
    if(statusEl)statusEl.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Checking for related cases…';
    const {data:{session}}=await sb.auth.getSession();
    const token=session&&session.access_token;
    const rows=(window._misRows||[]).map(r=>({id:r.id,case_type:r.case_type,cause_title:r.cause_title,case_no:r.case_no,status:r.status,remarks:r.remarks,court:r.court}));
    const res=await fetch(SUPABASE_URL+'/functions/v1/mis-ai-search',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify({query:raw,rows})});
    const jr=await res.json().catch(()=>({}));
    if(($('misSearch')&&$('misSearch').value.trim().toLowerCase())!==raw)return; // query changed while we waited — drop stale results
    if(jr.error){ if(statusEl)statusEl.innerHTML='<i class="fa-solid fa-triangle-exclamation"></i> AI search unavailable ('+esc(String(jr.error).slice(0,60))+')'; return; }
    const ids=jr.ids||[];
    let added=0;
    ids.forEach(id=>{
      const tr=document.querySelector('#misTbody tr[data-id="'+id+'"]');
      if(tr && tr.style.display==='none'){ tr.style.display=''; tr.classList.add('mis-ai-match'); added++;
        if(!tr.querySelector('.mis-ai-badge')){ const td=tr.querySelector('td:last-child'); if(td)td.insertAdjacentHTML('beforeend',' <span class="mis-ai-badge mis-ptag mis-ptag--gray" title="Matched by meaning, not exact text"><i class="fa-solid fa-wand-magic-sparkles"></i> AI</span>'); }
      }
    });
    if(added){ const c=$('misCount'); if(c)c.textContent=(parseInt(c.textContent,10)||0)+added+' cases'; }
    if(statusEl)statusEl.textContent=added?added+' more found by meaning':'';
  }catch(e){ if(statusEl)statusEl.textContent=''; }
};
window.misCreate=function(){
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-gavel"></i> Add Case</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">${misFormHtml({},'add')}</div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="misSaveBtn" onclick="misSave()"><i class="fa-solid fa-check"></i> Save</button></div>`,'lg');
};
/* dd/mm/yyyy in, ISO out — so the date filter and causelist have something sortable.
   Also accepts what people actually type: 3-8-2026, 03.08.2026, 2026-08-03. */
function misToIso(s){
  s=String(s==null?'':s).trim(); if(!s) return null;
  let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(m){ const d=new Date(+m[1],+m[2]-1,+m[3]); return isNaN(d)?null:d; }
  m=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if(m){ const d=new Date(+m[3],+m[2]-1,+m[1]); return isNaN(d)?null:d; }
  return null;
}
function misIsoStr(d){ return d?(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')):null; }
function misDmy(d){ return d?(String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear()):null; }

function misCollect(orig){
  const row={};
  MIS_FIELDS.forEach(f=>{ const el=$('misF_'+f.k); if(el) row[f.k]=((el.value||'').trim())||null; });
  // PC In-Charge: blank means nobody assigned, recorded as NA rather than left empty
  if(!row.pc_in_charge) row.pc_in_charge='NA';
  // Dates normalised to dd/mm/yyyy, with the sortable copy kept in step
  const nd=misToIso(row.next_date);
  if(nd){ row.next_date=misDmy(nd); row.next_date_iso=misIsoStr(nd); }
  else if(row.next_date){ row.next_date_iso=null; }
  const pd=misToIso(row.previous_date);
  if(pd) row.previous_date=misDmy(pd);
  // Next Date (case_next_date) — independent of the Action Date pair above, and never moved by
  // the action panel, so it just gets the same dd/mm/yyyy + sortable-copy treatment on its own.
  const cnd=misToIso(row.case_next_date);
  if(cnd){ row.case_next_date=misDmy(cnd); row.case_next_date_iso=misIsoStr(cnd); }
  else if(row.case_next_date){ row.case_next_date_iso=null; }
  // Remarks are cumulative in every form: what is typed is appended to what is already there,
  // comma separated, so an earlier note is never quietly wiped by a later edit.
  if(row.remarks!=null || orig){
    row.remarks = misRemarksMerge(orig?orig.remarks:null, row.remarks);
  }
  // Action Date drives the scoreboard, so it is kept in the same dd/mm/yyyy + sortable pair.
  const ad=misToIso(row.action_date);
  if(ad){ row.action_date=misDmy(ad); row.action_date_iso=misIsoStr(ad); }
  else { row.action_date_iso=null; }
  // Recording an action date is itself the commitment, so that is when the clock starts.
  if(row.action_date_iso && (!orig || String(orig.action_date||'')!==String(row.action_date||''))){
    row.next_date_recorded_at=misIsoStr(new Date());
  }
  // A changed Action Date pushes the old one into Previous Date — that is the only way it moves.
  if(orig){
    const before=String(orig.next_date||'').trim(), after=String(row.next_date||'').trim();
    if(before && after && before!==after){
      row.previous_date=before;
      row.next_date_recorded_at=misIsoStr(new Date());
    }
  }
  return row;
}
/* Clicking a case opens its ACTION panel — what has to be done, by when, and when it was done —
   plus Remarks. The full case details are edited from the toolbar's Edit button instead, so the
   two jobs stay apart: the everyday one (chasing an action) and the occasional one (correcting the
   case record). */
window.misActionPanel=function(id){
  const r=(window._misRows||[]).find(x=>x.id===id); if(!r){toast('Case not found','err');return;}
  window._misActionCase=r;
  const openAction=String(r.action_needed||'').trim();
  const title=r.cause_title||r.case_no||('Case '+id);
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-list-check"></i> Action — '+esc(String(title).replace(/\s+/g,' ').slice(0,58))+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm">'
      +'<div style="font-size:12px;color:var(--slate);margin-bottom:12px;line-height:1.5">'
        +esc(r.case_type||'')+(r.case_no?(' · '+esc(r.case_no)):'')+(r.court?(' · '+esc(r.court)):'')
        +'<br>Action Date <b>'+esc(r.next_date||'—')+'</b> · Previous Date '+esc(r.previous_date||'—')
      +'</div>'
      +'<label>Action Needed<textarea id="misA_needed" class="sel" rows="2">'+esc(openAction)+'</textarea></label>'
      +'<div class="two">'
        +'<label>Action Date'
          +'<input id="misA_date" value="'+esc(openAction?(r.action_date||r.next_date||''):'')+'" placeholder="dd/mm/yyyy"></label>'
        /* Execution Date belongs to the action that is currently open. With no open action this is
           a NEW action being written, so the box starts empty — it used to be pre-filled with the
           PREVIOUS action's execution date, and since a disabled input still hands back its value,
           saving the new action was read as an execution and wiped it on the spot. */
        +'<label>Action Execution Date'
          +'<input id="misA_exec" value="'+esc(openAction?(r.action_executed_date||''):'')+'" placeholder="dd/mm/yyyy"'+(openAction?'':' disabled title="Add the action first — record its execution date later"')+'></label>'
      +'</div>'
      +'<label>Remarks'
        +'<textarea id="misA_remarks" class="sel" rows="2" placeholder="Anything to add"></textarea></label>'
    +'</div>'
    +'<div class="modal-foot">'
      +'<button class="btn" onclick="closeModal()">Cancel</button>'
      +(openAction?'<button class="btn" onclick="misActionExecute('+id+')" title="Marks it done today"><i class="fa-solid fa-check-double"></i> Mark executed today</button>':'')
      +'<button class="btn btn-primary" id="misSaveBtn" onclick="misActionSave('+id+')"><i class="fa-solid fa-check"></i> Save</button>'
    +'</div>','md');
};
// Adds to remarks rather than replacing them, comma separated.
function misRemarksMerge(existing,added){
  const a=String(existing||'').trim(), b=String(added||'').trim();
  if(!b) return a||null;
  if(!a) return b;
  if(a.toLowerCase().indexOf(b.toLowerCase())!==-1) return a;   // already said
  return a.replace(/[,\s]+$/,'')+', '+b;
}
window.misActionExecute=function(id){
  const el=$('misA_exec');
  if(el&&!el.value.trim()){ const d=new Date();
    el.value=String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear(); }
  misActionSave(id);
};
window.misActionSave=async function(id){
  const r=window._misActionCase||{};
  const g=k=>{const el=$('misA_'+k);return el?(el.value||'').trim():'';};
  const needed=g('needed'), dateRaw=g('date'), execRaw=g('exec'), newRemark=g('remarks');
  if(needed && !dateRaw){ toast('Add an Action Date — an action needs a date to work to','warn'); return; }
  const dIso=dateRaw?misToIso(dateRaw):null;
  // An execution can only close an action that is actually open. Without one, anything in the
  // execution box is a leftover and is ignored - what is being written is the NEXT action.
  const hadOpen=String((r&&r.action_needed)||'').trim();
  const eIso=(execRaw&&hadOpen)?misToIso(execRaw):null;
  if(dateRaw&&!dIso){ toast('Action Date should look like dd/mm/yyyy','warn'); return; }
  if(execRaw&&!eIso){ toast('Action Execution Date should look like dd/mm/yyyy','warn'); return; }
  // The Execution Date is allowed to fall before the Action Date (an action can be carried out
  // ahead of the date it was working towards), so no ordering check here.
  const btn=$('misSaveBtn'); if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}

  const remarks=misRemarksMerge(r.remarks,newRemark);
  const upd={remarks:remarks};
  if(eIso){
    /* Executed. The action's date moves into Previous Date and both the action and the date are
       cleared, so the case is waiting for its next action - it is NOT completed. Completing a case
       is a separate, deliberate act (slide the row left). */
    upd.action_needed=null;
    upd.action_date=null; upd.action_date_iso=null;
    upd.action_executed_date=misDmy(eIso); upd.action_executed_date_iso=misIsoStr(eIso);
    upd.previous_date=dIso?misDmy(dIso):(r.next_date||r.previous_date||null);
    upd.next_date=null; upd.next_date_iso=null;
    upd.next_date_recorded_at=null;      // not handled - it is simply between actions
    upd.action_recorded_at=null;
  } else {
    /* The Action Date IS the case's Next Date - there is only ever one date being worked to. */
    upd.action_needed=needed||null;
    upd.next_date=dIso?misDmy(dIso):null;
    upd.next_date_iso=dIso?misIsoStr(dIso):null;
    upd.action_date=upd.next_date; upd.action_date_iso=upd.next_date_iso;
    upd.action_executed_date=null; upd.action_executed_date_iso=null;
    // Recording the commitment starts the scoreboard clock, on its OWN stamp: writing to
    // next_date_recorded_at would mark the case handled and make it look completed.
    if(dIso && String(r.next_date||'')!==misDmy(dIso)) upd.action_recorded_at=misIsoStr(new Date());
  }
  const {error}=await sb.from('mis_cases').update(upd).eq('id',id);
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Save';}return;}
  /* Only when something was actually typed. On the case form the remarks box is saved as part of
     add/edit case and is not a separate act; here it is the reason the modal was opened. */
  if(newRemark){ try{ usageQueue('legal.mis.add_remarks_to_a_case','update',
    {title:r.cause_title||r.case_no||('Case #'+id), case_no:r.case_no||undefined}); }catch(_e){} }

  // Keep the Actions log in step: close the open one, or record/refresh it.
  try{
    const {data:existing}=await sb.from('mis_actions').select('id,action_needed').eq('case_id',id).is('executed_date_iso',null).order('id',{ascending:false}).limit(1);
    const openRow=(existing&&existing[0])||null;
    const openId=openRow?openRow.id:null;
    if(eIso){
      const row={executed_date:misDmy(eIso),executed_date_iso:misIsoStr(eIso),remarks:remarks,updated_at:new Date().toISOString()};
      if(openId) await sb.from('mis_actions').update(row).eq('id',openId);
      else if(needed||r.action_needed) await sb.from('mis_actions').insert(Object.assign({case_id:id,
        action_needed:needed||r.action_needed,action_date:dIso?misDmy(dIso):null,action_date_iso:dIso?misIsoStr(dIso):null,
        created_by:state.email},row));
    } else if(needed){
      const row={case_id:id,action_needed:needed,action_date:dIso?misDmy(dIso):null,
        action_date_iso:dIso?misIsoStr(dIso):null,remarks:remarks,created_by:state.email,updated_at:new Date().toISOString()};
      // Every action raised is recorded in its own right. The open row is only edited when it is
      // literally the same action being corrected; a different wording is a new action.
      const sameAsOpen = openId && String(openRow&&openRow.action_needed||'').trim()===needed;
      if(sameAsOpen) await sb.from('mis_actions').update(row).eq('id',openId);
      else await sb.from('mis_actions').insert(row);
    }
  }catch(e){ toast('The case saved, but the Actions log could not be updated: '+((e&&e.message)||e),'err'); }

  closeModal();
  toast(eIso?'Action executed — the case stays open for its next action':'Action saved','ok');
  legalMIS();
};

function misActionDateMissing(row){
  // Action Needed without a date is a promise with no deadline - the scoreboard has nothing to
  // measure. One is required whenever the other is filled in.
  if(String(row.action_needed||'').trim() && !row.action_date_iso){
    toast('Add an Action Date — Action Needed has to have a date to work to','warn');
    const el=$('misF_action_date'); if(el){ try{el.focus();}catch(_e){} el.style.borderColor='var(--err)';
      setTimeout(function(){ el.style.borderColor=''; },2000); }
    return true;
  }
  return false;
}
window.misSave=async function(){
  const row=misCollect();
  if(!row.cause_title&&!row.case_no){toast('Enter at least a Cause Title or Case No.','err');return;}
  if(misActionDateMissing(row)) return;
  const btn=$('misSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  row.created_by=state.email;
  const {error}=await sb.from('mis_cases').insert(row);
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Save';}return;}
  closeModal();toast('Case added','ok');legalMIS();
};
window.misEditSel=function(){
  const sel=[...window._misSel];
  if(sel.length===0){toast('Select a case first','err');return;}
  if(sel.length>1){toast('Select only one case to edit','err');return;}
  misEdit(sel[0]);
};
window.misEdit=async function(id){
  const r=(window._misRows||[]).find(x=>x.id===id);if(!r)return;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Edit Case</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body frm">${misFormHtml(r,'edit')}</div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="misSaveBtn" onclick="misUpdate(${id})"><i class="fa-solid fa-check"></i> Update</button></div>`,'lg');
  // Live preview of the shift: typing a new Next Date immediately shows the old one moving
  // into Previous Date, so it is obvious what will be saved.
  window._misEditOrig=r;
  setTimeout(function(){
    const nd=$('misF_next_date'), pd=$('misF_previous_date');
    if(!nd||!pd)return;
    const before=String(r.next_date||'').trim(), wasPrev=String(r.previous_date||'').trim();
    nd.addEventListener('input',function(){
      const now=String(nd.value||'').trim();
      pd.value=(before&&now&&now!==before)?before:wasPrev;
    });
  },30);
};
window.misUpdate=async function(id){
  const row=misCollect(window._misEditOrig);
  if(misActionDateMissing(row)) return;
  const btn=$('misSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  const {error}=await sb.from('mis_cases').update(row).eq('id',id);
  if(error){toast(error.message,'err');if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Update';}return;}
  closeModal();toast('Updated','ok');legalMIS();
};
window.misDeleteSel=async function(){
  const sel=[...window._misSel];
  if(!sel.length)return;
  // Read the cases BEFORE they are deleted - a moment later there is nothing left to read, and
  // this row becomes the only surviving trace of what was removed (mis_cases has no deleted_at;
  // the rows are gone for good).
  const gone=(window._misRows||[]).filter(function(r){ return sel.indexOf(r.id)!==-1; });
  if(!await confirmDialog('Delete '+sel.length+' case'+(sel.length>1?'s':'')+'?'))return;
  const {error}=await sb.from('mis_cases').delete().in('id',sel);
  if(error){toast(error.message,'err');return;}
  toast(sel.length>1?(sel.length+' cases deleted'):'Case deleted','ok');
  /* Logged here rather than through USAGE_MAP for the reason the causelist is: the wrapper fires
     on the click, so a delete refused by the server would have been recorded as one that happened.
     One case names itself and its court; several list their case numbers and let the column carry
     the count, since no single case number is the answer then. */
  try{
    if(gone.length===1){
      const r=gone[0];
      usageQueue('legal.mis.delete_case_s','delete',
        {title:r.cause_title||r.case_no||undefined, case_no:r.case_no||undefined, court:r.court||undefined});
    }else{
      const nos=gone.map(function(r){ return r.case_no||r.cause_title; }).filter(Boolean);
      usageQueue('legal.mis.delete_case_s','delete',
        {title:nos.join(', ')||undefined, cases:sel.length+' cases'});
    }
  }catch(_e){}
  legalMIS();
};
window.misStats=function(){
  const rows=window._misRows||[];
  const total=rows.length;
  const stats=MIS_FIELDS.map(f=>{
    const filled=rows.filter(r=>{const v=r[f.k];return v!==null&&v!==undefined&&String(v).trim()!=='';}).length;
    const blank=total-filled;
    const pct=total?Math.round(blank/total*100):0;
    return {l:f.l,filled,blank,pct};
  }).sort((a,b)=>b.blank-a.blank);
  const rowsHtml=stats.map(s=>`<tr><td style="font-weight:600">${esc(s.l)}</td><td style="color:var(--slate)">${s.filled} / ${total}</td><td style="color:${s.blank?'#b91c1c':'var(--slate)'}">${s.blank} (${s.pct}%)</td></tr>`).join('');
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-chart-simple"></i> Field Completeness — ${total} cases</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body">
    <div style="overflow-x:auto"><table class="tbl" style="width:100%;font-size:13px">
      <thead><tr><th style="text-align:left">Field</th><th style="text-align:left">Filled</th><th style="text-align:left">Blank</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
  </div>
  <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Close</button></div>`,'lg');
};

