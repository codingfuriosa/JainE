/* ============================ FEEDBACK HUB ============================
   QR-code feedback forms. Design builds a form (fixed question types: rating, multiple choice,
   short text, long text) and gets a QR/link; anyone who scans it lands on the public
   feedback-fill.html page (no login) which talks to the single feedback-get-form edge function
   (action:'get'|'submit' -- folded into one function because this project is at its edge-function
   slot cap). Records shows what came back. Module visibility is already gated by NAV + roles.modules
   like every other module, so anyone who can see this page can manage forms and read responses.

   UI follows "Don't Make Me Think": a form is a row of cards, not a cramped table; adding a question
   means picking a self-labelled tile (icon + one-line description of what it does), not guessing from
   a bare button; every action is an icon WITH a word next to it, never an icon alone. */
const FH_QTYPE_INFO={
  rating:{icon:'fa-star',label:'Rating',desc:'A star scale, e.g. 1 to 5',color:'#f59e0b'},
  mcq:{icon:'fa-list-check',label:'Multiple Choice',desc:'Pick one option',color:'#0369a1'},
  short_text:{icon:'fa-i-cursor',label:'Short Text',desc:'A single line of text',color:'#7c3aed'},
  long_text:{icon:'fa-align-left',label:'Long Text',desc:'A paragraph of text',color:'#0f766e'},
  multi:{icon:'fa-square-check',label:'Multi Select',desc:'Pick any number of options',color:'#b45309'},
  nps:{icon:'fa-gauge-high',label:'Score 0–10',desc:'The 0 to 10 "would you recommend us" scale',color:'#9c1420'},
  scale:{icon:'fa-list-ol',label:'Numbered Scale',desc:'Plain numbers, e.g. 1 to 5, with the ends labelled',color:'#1d4ed8'}
};
// A Rating and a Numbered Scale ask the same thing and store the same answer; they differ only in
// whether it is shown as stars or as numbers. Stars look warmer, numbers say outright which end is
// which - three stars tells nobody whether that is fine or poor. Both carry a points count.
const FH_SCALE_TYPES=['rating','scale'];
// Multi Select and Score 0-10 answer the two things a star row and a single-pick list could not:
// a question whose honest answer is "these three", and a scale whose bottom end is 0, not 1.
const FH_OPTION_TYPES=['mcq','multi'];
const FH_CSS=`<style id="fhCss">
.fh-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:18px;flex-wrap:wrap}
.fh-danger{color:var(--err)!important;border-color:var(--err)!important}

/* Row list - Design tab's forms, and Records' form picker. Rows, not cards: each is one line of
   scan-height, so a page of 15 forms reads in one glance instead of scrolling a grid of tiles. */
.fh-rowlist{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff}
.fh-row{display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--line)}
.fh-row:last-child{border-bottom:none}
.fh-row-click{cursor:pointer}
.fh-row-click:hover{background:#f8fafc}
.fh-row-icon{width:34px;height:34px;flex:none;border-radius:9px;background:#f5f3ff;color:#7c3aed;display:flex;align-items:center;justify-content:center;font-size:14px}
.fh-row-main{flex:1;min-width:0}
.fh-row-title{font-weight:700;font-size:13.5px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fh-row-meta{font-size:11.5px;color:var(--slate);margin-top:2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.fh-row-actions{display:flex;gap:6px;flex:none}
.fh-row-actions .btn{white-space:nowrap}
.fh-row-icon-btn{width:32px;height:32px;padding:0;justify-content:center;flex:none}
.fh-row-chevron{color:var(--slate);font-size:13px;flex:none}

/* Dedicated pages (New/Edit Form, Preview, Records, Response Details) - a real page in this app's
   own router (seg-based, same idiom as Accountability's task/case pages), not a modal or a panel
   wedged under a list. One consistent header treatment for all four. */
.fh-page-head{display:flex;align-items:center;gap:12px;margin-bottom:18px}
.fh-page-back{width:36px;height:36px;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--ink);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none;font-size:14px}
.fh-page-back:hover{background:#f8fafc}
.fh-page-titles{flex:1;min-width:0}
.fh-page-title{font-size:17px;font-weight:800;line-height:1.25}
.fh-page-sub{font-size:12.5px;color:var(--slate);margin-top:2px}
.fh-page-actions{display:flex;gap:8px;flex:none}

/* The builder itself, restyled to read like an actual form rather than an admin panel: a plain
   label-over-input rhythm for the form's own details, then one numbered card per question. */
.fh-form-card{width:100%}
.fh-top-grid{display:grid;grid-template-columns:1.6fr 1fr;gap:16px}
@media(max-width:820px){.fh-top-grid{grid-template-columns:1fr}}
.fh-basics-card,.fh-contact-card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px 24px;margin-bottom:16px;height:100%;box-sizing:border-box}
.fh-field{margin-bottom:16px}
.fh-field:last-child{margin-bottom:0}
.fh-field label{display:block;font-size:13px;font-weight:600;color:var(--ink);margin-bottom:6px}
.fh-field .hint{font-weight:400;color:var(--slate);font-size:11.5px}
.fh-section-head{margin:22px 0 10px}
.fh-section-head .t{font-size:14px;font-weight:600}
.fh-section-head .s{font-size:12px;color:var(--slate);margin-top:2px}

/* Respondent-details segmented control - three plain-language states instead of a bare select, so
   what each one means is readable without a click. Neutral ink accent, not the brand purple - this
   is a utility control, not a call to action. */
.fh-contact-grid{display:grid;grid-template-columns:1fr;gap:10px}
.fh-contact-field{border:1px solid var(--line);border-radius:10px;padding:11px 12px}
.fh-contact-field .lbl{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;color:var(--ink);margin-bottom:8px}
.fh-seg{display:flex;border:1px solid var(--line);border-radius:7px;overflow:hidden}
.fh-seg button{flex:1;border:0;background:#fff;color:var(--slate);font-size:11.5px;font-weight:500;padding:6px 4px;cursor:pointer;border-right:1px solid var(--line)}
.fh-seg button:last-child{border-right:0}
.fh-seg button.on{background:var(--ink);color:#fff}
.fh-contact-field .why{font-size:11px;color:var(--slate);margin-top:7px;line-height:1.4}

.fh-q-card{border-radius:10px;background:#fff;border:1px solid var(--line);padding:14px 16px;margin-bottom:10px}
.fh-q-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.fh-q-type{display:flex;align-items:center;gap:7px;font-size:11.5px;font-weight:500;color:var(--slate)}
.fh-q-num{width:19px;height:19px;border-radius:6px;background:#f1f5f9;color:var(--slate);font-size:11px;font-weight:600;display:inline-flex;align-items:center;justify-content:center}
.fh-q-toolbar{display:flex;gap:3px}
.fh-icon-btn{width:28px;height:28px;border-radius:7px;border:0;background:transparent;color:var(--slate);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12.5px}
.fh-icon-btn:hover{background:#f1f5f9}
.fh-q-drag-handle{cursor:grab;color:var(--slate);width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:13px}
.fh-q-drag-over{outline:1.5px dashed var(--slate);outline-offset:-4px}
.fh-q-prompt{font-weight:500;font-size:14px;margin-bottom:10px;width:100%;box-sizing:border-box}
.fh-rating-config{display:flex;align-items:center;gap:12px;margin-bottom:4px}
.fh-rating-config label{font-size:12px;color:var(--slate);margin:0}
.fh-star-preview{color:#c9902e;font-size:14px;letter-spacing:2px}
.fh-opts{margin-bottom:8px}
.fh-opt-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.fh-opt-letter{width:20px;height:20px;flex:none;border-radius:6px;background:#f1f5f9;color:var(--slate);font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center}
.fh-required-toggle{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--slate);margin:0;cursor:pointer}
.fh-required-toggle input{width:16px!important;height:16px;flex:none;border:0!important;border-radius:0!important;padding:0!important;background:none!important;accent-color:var(--ink);cursor:pointer}
.fh-type-picker{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.fh-type-tile{display:flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--line);border-radius:20px;background:#fff;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:500;color:var(--ink)}
.fh-type-tile:hover{background:#f8fafc;border-color:var(--slate)}
.fh-type-tile i{font-size:13px;color:var(--slate)}

/* Records - dense by default (this is a report to scan, not a gallery), one accordion open at a
   time for the raw text-answer lists so scanning ten questions doesn't mean ten walls of text. */
.fh-stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.fh-stat-card{padding:10px 14px;min-width:120px}
.fh-stat-num{font-size:19px;font-weight:800;line-height:1}
.fh-stat-label{font-size:11px;color:var(--slate);margin-top:4px;display:flex;align-items:center;gap:5px}
.fh-mcq-card{padding:12px 14px;margin-bottom:10px}
.fh-mcq-row{margin-bottom:10px}
.fh-mcq-row:last-child{margin-bottom:0}
.fh-mcq-row-top{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;margin-bottom:5px}
.fh-mcq-row-top span:first-child{font-weight:500;color:var(--ink)}
.fh-mcq-row-n{font-size:12px;color:var(--slate);white-space:nowrap;padding-left:12px}
.fh-mcq-bar-track{height:8px;border-radius:5px;background:#f1f5f9;overflow:hidden}
.fh-mcq-bar-fill{height:100%;background:#7c3aed;border-radius:5px}
.fh-warn{display:flex;align-items:flex-start;gap:9px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:10px 14px;font-size:12.5px;margin-bottom:14px}
.fh-disclosure{background:none;border:0;padding:0;display:flex;align-items:center;gap:6px;color:#7c3aed;font-size:12px;font-weight:600;cursor:pointer}
.fh-disclosure i{transition:transform .15s}
.fh-disclosure.open i{transform:rotate(90deg)}
.fh-text-list{display:none;margin-top:8px;max-height:220px;overflow:auto}
.fh-text-item{border-top:1px solid var(--line);padding:7px 0;font-size:12.5px;white-space:pre-wrap}
.fh-tbl-compact th,.fh-tbl-compact td{padding:7px 10px;font-size:12.5px}

/* Shared "looks like the real form" presentation for both the builder's Preview page and a single
   response's Details page - one respondent-facing look, reused rather than invented twice. */
.fh-preview-frame{max-width:720px;margin:0 auto;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#f5f7fb}
.fh-preview-head{background:#0f172a;color:#fff;padding:16px 20px}
.fh-preview-head b{font-size:13px;letter-spacing:.5px}
.fh-preview-head div{color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin-top:2px}
.fh-preview-body{background:#fff;padding:20px}
.fh-preview-q{border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px}
.fh-preview-q .lbl{font-size:10.5px;font-weight:700;text-transform:uppercase;color:var(--slate);margin-bottom:6px}
.fh-preview-q .prompt{font-size:13.5px;margin-bottom:10px;white-space:pre-wrap}
.fh-preview-stars{color:#d8dee8;font-size:20px;letter-spacing:4px}
.fh-preview-stars i.on{color:#f59e0b}
.fh-preview-opt{display:block;padding:7px 9px;border:1px solid var(--line);border-radius:8px;margin-bottom:5px;font-size:13px;color:var(--slate)}
.fh-preview-opt.on{border-color:#7c3aed;background:#faf8ff;color:var(--ink);font-weight:600}
</style>`;
async function loadQRLib(forceRetry){
  if(window.QRCode)return window.QRCode;
  if(forceRetry)window._fhQRLoading=null;
  if(!window._fhQRLoading){
    window._fhQRLoading=new Promise((res)=>{
      const sc=document.createElement('script');
      sc.src='https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      const t=setTimeout(()=>res(null),7000);
      sc.onload=()=>{clearTimeout(t);res(window.QRCode||null);};
      sc.onerror=()=>{clearTimeout(t);res(null);};
      document.head.appendChild(sc);
    });
  }
  const lib=await window._fhQRLoading;
  if(!lib)window._fhQRLoading=null; // let a later call actually retry instead of replaying a dead promise
  return lib;
}
let FH_FORMS=null, FH_EDIT=null, FH_REC_FORM=null, FH_REC_ROWS=null, FH_QR_CUR=null;
function fhOriginBroken(){
  return !/^https?:$/.test(location.protocol) || !location.origin || location.origin==='null';
}
// Used by fhSaveForm: true only for changes that could make EXISTING answers stop lining up with the
// form -- a question removed, its type changed, its rating_max changed, or its mcq options changed.
// Reordering, wording-only edits, or adding a brand-new question don't trip this.
function fhQuestionsStructurallyChanged(orig,cur){
  orig=orig||[];cur=cur||[];
  const origIds=orig.map(q=>q.id).slice().sort().join(',');
  const curIds=cur.map(q=>q.id).slice().sort().join(',');
  if(origIds!==curIds)return true;
  const byId={};orig.forEach(q=>{byId[q.id]=q;});
  for(const q of cur){
    const o=byId[q.id];if(!o)return true;
    if(o.type!==q.type)return true;
    if(FH_SCALE_TYPES.includes(q.type)&&(o.rating_max||5)!==(q.rating_max||5))return true;
    if(FH_OPTION_TYPES.includes(q.type)){
      const oo=(o.options||[]).filter(x=>x&&x.trim());
      const co=(q.options||[]).filter(x=>x&&x.trim());
      if(oo.length!==co.length||oo.some((x,i)=>x!==co[i]))return true;
    }
  }
  return false;
}
function fhFillUrl(token){ return location.origin+'/feedback-fill.html?f='+token; }

/* ---- router: named sub-routes checked first (dedicated pages), numeric tab as the fallback ---- */
VIEWS.feedback_hub=async function(v,seg){
  loadQRLib(); // fire-and-forget preload, so the QR modal feels instant instead of loading on first click
  // Typed straight into the address bar, these would otherwise open the builder for somebody who
  // may only fill forms in. The database refuses their save either way; this refuses the page.
  if(seg[0]==='new')       return fhCanQrForms()?fhFormPage(v,null):fhDenied(v);
  if(seg[0]==='form'&&seg[1])     return fhCanQrForms()?fhFormPage(v,Number(seg[1])):fhDenied(v);
  if(seg[0]==='preview')   return fhPreviewPage(v);
  if(seg[0]==='records'&&seg[1]) return fhCanQrForms()?fhRecordsPage(v,Number(seg[1])):fhDenied(v);
  if(seg[0]==='response'&&seg[1]) return fhCanQrForms()?fhResponseDetailPage(v,seg[1]):fhDenied(v);
  if(seg[0]==='sys'&&seg[1]&&fhIsSystems()) return /^m\d+$/.test(seg[1])?sfModPage(v,Number(seg[1].slice(1))):sfItemPage(v,Number(seg[1]));
  if(seg[0]==='give'&&seg[1]&&fhIsRater()) return sfRatePage(v,seg[1]);   // m<module> or <item>
  setCrumb(['Feedback','Feedback Hub']);
  // Each person gets only the tabs that are theirs (see canFeedbackHub in 06-nav.js).
  /* One list, two readings of it: a designer's tab is "Design" and carries the full set of actions,
     a filler's is "Forms" and carries Open, Records and the QR code. Rather than a second tab that
     would be the same list with three buttons missing. */
  const all=[['design',fhCanQrForms()?'Design':'Forms',fhCanSeeForms],['records','Records',fhCanQrForms],['system','System Feedbacks',fhIsSystems],['give','Give Feedback',fhIsRater]];
  const mine=all.filter(function(t){ return t[2](); });
  if(!mine.length){ v.innerHTML='<div class="card"><div class="empty">You do not have access to Feedback Hub.</div></div>'; return; }
  const ti=mTab(seg,mine.length);
  v.innerHTML=FH_CSS+SF_CSS+mHead('fa-qrcode','#7c3aed','Feedback Hub')+(mine.length>1?mTabs('feedback_hub',mine.map(function(t){ return t[1]; }),ti):'')+'<div id="fhBody" style="margin-top:16px"><div class="loader"><div class="spin"></div></div></div>';
  const key=mine[ti][0];
  if(key==='design'){await fhDesign();return;}
  if(key==='records'){await fhRecords();return;}
  if(key==='system'){await sfManage();return;}
  await sfGive();
};
/* Shown instead of the builder when somebody who may only fill forms in types its address. The
   database would refuse the save regardless; this means they are told so rather than finding out
   when Save does nothing. */
function fhDenied(v){
  setCrumb(['Feedback','Feedback Hub']);
  v.innerHTML=FH_CSS+'<div class="card card-pad empty" style="padding:40px"><i class="fa-solid fa-lock"></i>'
    +'<div>That part of Feedback Hub is not yours. You can open any form to fill it in, and share its QR code.</div>'
    +'<div style="margin-top:14px"><button class="btn" onclick="navTo(\'feedback_hub\')">Back to Feedback Hub</button></div></div>';
}
async function fhLoadForms(force){
  if(FH_FORMS&&!force)return FH_FORMS;
  const{data,error}=await sb.schema('feedback').from('forms').select('*').order('created_at',{ascending:false});
  if(error){FH_FORMS=[];return FH_FORMS;}
  FH_FORMS=data||[];
  return FH_FORMS;
}

/* ---- Design tab: a plain row list, one line per form ---- */
async function fhDesign(){
  const b=$('fhBody');if(!b)return;
  loader(b);
  await fhLoadForms();
  FH_EDIT=null;
  fhDesignRender();
}
async function fhDesignRender(){
  const b=$('fhBody');if(!b)return;
  const rows=FH_FORMS||[];
  const design=fhCanQrForms();
  b.innerHTML=`<div class="fh-head">
    <div><div class="sec-title" style="margin:0">${design?'Your Forms':'Feedback Forms'}</div><div class="sec-sub" style="margin:0">${design?'Build a form, share its QR code or link, and watch responses come in.':'Open a form to fill it in, or share its QR code.'}</div></div>
    ${design?`<button class="btn btn-primary" onclick="navTo('feedback_hub/new')"><i class="fa-solid fa-plus"></i> New Form</button>`:''}
  </div>
  ${rows.length?`<div class="fh-rowlist">${rows.map(f=>`
    <div class="fh-row">
      <div class="fh-row-icon"><i class="fa-solid fa-clipboard-list"></i></div>
      <div class="fh-row-main"><div class="fh-row-title">${esc(f.title)}</div>
        <div class="fh-row-meta"><span id="fhQCount_${f.id}">…</span>${f.is_active?'<span class="tag t-green">Active</span>':'<span class="tag t-red">Closed</span>'}</div>
      </div>
      <div class="fh-row-actions">
        ${design?`<button class="btn btn-sm" onclick="navTo('feedback_hub/form/${f.id}')"><i class="fa-solid fa-pen"></i> <span>Edit</span></button>`
          : `<a class="btn btn-sm" href="${esc(fhFillUrl(f.qr_token))}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> <span>Open</span></a>`}
        ${design?`<button class="btn btn-sm" onclick="navTo('feedback_hub/records/${f.id}')"><i class="fa-solid fa-chart-simple"></i> <span>Records</span></button>`:''}
        <button class="btn btn-sm fh-row-icon-btn" title="QR Code" onclick="fhShowQR(${f.id})"><i class="fa-solid fa-qrcode"></i></button>
        ${design?`<button class="btn btn-sm fh-row-icon-btn" title="${f.is_active?'Close to new responses':'Reopen for responses'}" onclick="fhToggleActive(${f.id},${!f.is_active})">${f.is_active?'<i class="fa-solid fa-lock"></i>':'<i class="fa-solid fa-lock-open"></i>'}</button>
        <button class="btn btn-sm fh-danger fh-row-icon-btn" title="Delete" onclick="fhDeleteForm(${f.id})"><i class="fa-solid fa-trash"></i></button>`:''}
      </div>
    </div>`).join('')}</div>`
    :`<div class="card"><div class="empty"><i class="fa-solid fa-qrcode"></i>
        <div>No feedback forms yet</div>
        <div style="font-size:12.5px;margin-top:4px">Create one, and anyone who scans its QR code can leave feedback in seconds — no login needed.</div>
        <button class="btn btn-primary" style="margin-top:14px" onclick="navTo('feedback_hub/new')"><i class="fa-solid fa-plus"></i> Create your first form</button>
      </div></div>`}`;
  if(rows.length){
    const{data:qRows}=await sb.schema('feedback').from('form_questions').select('form_id').in('form_id',rows.map(f=>f.id));
    const counts={};
    (qRows||[]).forEach(r=>{counts[r.form_id]=(counts[r.form_id]||0)+1;});
    rows.forEach(f=>{
      const count=counts[f.id]||0;
      const el=$('fhQCount_'+f.id);if(el)el.textContent=count+' question'+(count===1?'':'s')+' · ';
    });
  }
}
window.fhToggleActive=async function(id,newVal){
  const{error}=await sb.schema('feedback').from('forms').update({is_active:newVal}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  const f=(FH_FORMS||[]).find(x=>x.id===id);if(f)f.is_active=newVal;
  toast(newVal?'Form reopened':'Form closed to new responses');
  fhDesignRender();
};
window.fhDeleteForm=async function(id){
  if(!await confirmDialog('Delete this form? All its questions and collected responses will also be deleted permanently. This cannot be undone.'))return;
  const{error}=await sb.schema('feedback').from('forms').delete().eq('id',id);
  if(error){toast(error.message,'err');return;}
  FH_FORMS=(FH_FORMS||[]).filter(f=>f.id!==id);
  toast('Form deleted');fhDesignRender();
};
window.fhShowQR=async function(id){
  const f=(FH_FORMS||[]).find(x=>x.id===id);if(!f)return;
  const url=fhFillUrl(f.qr_token);
  FH_QR_CUR={f,url};
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-qrcode"></i> ${esc(f.title)}</h3><span class="x" onclick="closeModal()">&times;</span></div>
  <div class="modal-body" style="text-align:center">
    ${fhOriginBroken()?'<div class="fh-warn" style="text-align:left"><i class="fa-solid fa-triangle-exclamation" style="margin-top:2px"></i><div>This page is not open at a real web address right now, so this link/QR will not work for anyone else yet. Once Feedback Hub is live on your real site, reopen this to get a working QR.</div></div>':''}
    <div id="fhQrBox" style="display:flex;justify-content:center;align-items:center;min-height:240px"></div>
    <div style="font-size:12px;color:var(--slate);margin:12px 0;word-break:break-all">${esc(url)}</div>
    <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
      <button class="btn btn-sm" id="fhCopyBtn" ${fhOriginBroken()?'disabled title="This link will not work until Feedback Hub is live at a real web address"':''} onclick="fhCopyLink('${url}')"><i class="fa-solid fa-copy"></i> Copy Link</button>
      <button class="btn btn-sm btn-primary" id="fhQrDlBtn" disabled title="${fhOriginBroken()?'This QR code will not work until Feedback Hub is live at a real web address':'Preparing QR code…'}"><i class="fa-solid fa-download"></i> Download PNG</button>
    </div>
  </div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>`);
  await fhRenderQR();
};
window.fhRenderQR=async function(retry){
  const box=$('fhQrBox');if(!box||!FH_QR_CUR)return;
  loader(box);
  const lib=await loadQRLib(retry);
  if(!lib){
    box.innerHTML=`<div style="max-width:260px"><div style="color:var(--err);font-size:13px;margin-bottom:10px"><i class="fa-solid fa-triangle-exclamation"></i> Couldn't load the QR generator. Check your connection.</div><button class="btn btn-sm" onclick="fhRenderQR(true)"><i class="fa-solid fa-rotate"></i> Retry</button></div>`;
    return;
  }
  box.innerHTML='';
  const holder=document.createElement('div');
  box.appendChild(holder);
  new lib(holder,{text:FH_QR_CUR.url,width:220,height:220,correctLevel:lib.CorrectLevel.M});
  const canvas=holder.querySelector('canvas');
  const dlBtn=$('fhQrDlBtn');
  if(dlBtn&&canvas){
    if(fhOriginBroken()){
      dlBtn.disabled=true;
      dlBtn.title='This QR code will not work until Feedback Hub is live at a real web address';
    }else{
      dlBtn.disabled=false;
      dlBtn.title='';
      dlBtn.onclick=function(){
        const a=document.createElement('a');
        a.download=(FH_QR_CUR.f.title||'feedback-form').replace(/[^a-z0-9]+/gi,'-')+'-qr.png';
        a.href=canvas.toDataURL('image/png');
        a.click();
      };
    }
  }
};
window.fhCopyLink=function(url){
  navigator.clipboard.writeText(url).then(()=>toast('Link copied')).catch(()=>toast('Could not copy — select and copy manually','err'));
};

/* ---- New/Edit Form: a dedicated page, not a modal or a panel wedged under the list ---- */
function fhSnapshot(ed){
  return JSON.stringify({title:ed.title,description:ed.description,thank_you_message:ed.thank_you_message,
    collect_name:ed.collect_name,collect_phone:ed.collect_phone,collect_email:ed.collect_email,questions:ed.questions});
}
async function fhFormPage(v,formId){
  v.innerHTML=FH_CSS+'<div class="loader"><div class="spin"></div></div>';
  if(formId){
    await fhLoadForms();
    const f=(FH_FORMS||[]).find(x=>x.id===formId);
    if(!f){ v.innerHTML=FH_CSS+'<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Form not found</div></div>'; return; }
    const{data,error}=await sb.schema('feedback').from('form_questions').select('*').eq('form_id',formId).order('seq');
    if(error){ toast(error.message,'err'); }
    FH_EDIT={id:f.id,title:f.title,description:f.description||'',collect_name:f.collect_name,collect_phone:f.collect_phone,collect_email:f.collect_email,thank_you_message:f.thank_you_message||'',
      questions:(data||[]).map(q=>({id:q.id,type:q.type,prompt:q.prompt,options:(q.options||[]).slice(),rating_max:q.rating_max||5,required:q.required}))};
    // Snapshot of the questions as they exist in the DB right now, so fhSaveForm can tell whether a save
    // would change the STRUCTURE of a form that already has responses.
    FH_EDIT._origQ=JSON.parse(JSON.stringify(FH_EDIT.questions));
  }else{
    FH_EDIT={id:null,title:'',description:'',collect_name:'off',collect_phone:'off',collect_email:'off',thank_you_message:'',questions:[]};
  }
  FH_EDIT._initial=fhSnapshot(FH_EDIT);
  setCrumb(['Feedback','Feedback Hub',FH_EDIT.id?'Edit Form':'New Form']);
  v.innerHTML=FH_CSS+`
  <div class="fh-page-head">
    <button class="fh-page-back" title="Back" onclick="fhFormPageBack()"><i class="fa-solid fa-arrow-left"></i></button>
    <div class="fh-page-titles"><div class="fh-page-title">${FH_EDIT.id?'Edit Form':'New Form'}</div><div class="fh-page-sub">${FH_EDIT.id?esc(FH_EDIT.title):'A short form anyone can fill in from a QR code — no login needed for them.'}</div></div>
    <div class="fh-page-actions">
      <button class="btn" onclick="navTo('feedback_hub/preview')"><i class="fa-solid fa-eye"></i> <span>Preview</span></button>
      <button class="btn btn-primary" id="fhSaveBtn" onclick="fhSaveForm()"><i class="fa-solid fa-check"></i> Save Form</button>
    </div>
  </div>
  <div id="fhFormBody"></div>`;
  fhFormPageRender();
}
window.fhFormPageBack=async function(){
  fhSyncEditFields();
  const changed=FH_EDIT&&FH_EDIT._initial!==fhSnapshot(FH_EDIT);
  if(changed&&!await confirmDialog('Discard this form? Your changes will be lost.',{danger:false,okLabel:'Discard changes'}))return;
  FH_EDIT=null;
  navTo('feedback_hub');
};
function fhFormPageRender(){
  const panel=$('fhFormBody');if(!panel)return;
  const ed=FH_EDIT;if(!ed)return;
  panel.innerHTML=`<div class="fh-form-card">
    <div class="fh-top-grid">
      <div class="fh-basics-card frm">
        <div class="fh-field"><label>Title</label><input id="fhTitle" class="inp" value="${esc(ed.title)}" placeholder="e.g. Site visit feedback" oninput="fhQSyncTitle()"></div>
        <div class="fh-field"><label>Description <span class="hint">(shown to the person filling it in)</span></label><textarea id="fhDesc" class="inp" rows="2" placeholder="A line or two about what this is for">${esc(ed.description)}</textarea></div>
        <div class="fh-field" style="margin-bottom:0"><label>Thank you message</label><input id="fhThanks" class="inp" value="${esc(ed.thank_you_message)}" placeholder="Thank you for your feedback!"></div>
      </div>

      <div class="fh-contact-card">
        <div style="font-size:14px;font-weight:600;margin:0 0 2px">Respondent details</div>
        <div style="font-size:12px;color:var(--slate);margin:0 0 12px">Choose what to ask before someone can submit.</div>
        <div class="fh-contact-grid">
          ${fhContactSelect('name',ed.collect_name,'fa-user','Name')}
          ${fhContactSelect('phone',ed.collect_phone,'fa-phone','Phone')}
          ${fhContactSelect('email',ed.collect_email,'fa-envelope','Email')}
        </div>
      </div>
    </div>

    <div class="fh-section-head"><div class="t">Questions</div><div class="s">Add at least one. Drag the handle or use the arrows to reorder.</div></div>
    <div id="fhQList">${ed.questions.map((q,i)=>fhQRowHtml(q,i)).join('')||'<div style="color:var(--slate);font-size:13px;padding:4px 0 14px">No questions yet — pick a type below to add one.</div>'}</div>
    <div class="fh-type-picker">
      ${Object.keys(FH_QTYPE_INFO).map(t=>{const info=FH_QTYPE_INFO[t];return `
      <button type="button" class="fh-type-tile" onclick="fhQAdd('${t}')">
        <i class="fa-solid ${info.icon}"></i> ${info.label}
      </button>`;}).join('')}
    </div>
  </div>`;
}
window.fhQSyncTitle=function(){ if(FH_EDIT)FH_EDIT.title=($('fhTitle')||{}).value||''; const s=document.querySelector('.fh-page-sub'); if(s&&FH_EDIT.id)s.textContent=FH_EDIT.title; };
function fhQRowHtml(q,i){
  const info=FH_QTYPE_INFO[q.type]||{icon:'fa-question',label:q.type};
  const opts=(q.options||[]);
  return `<div class="fh-q-card frm" data-qidx="${i}" draggable="true" ondragstart="fhQDragStart(event,${i})" ondragover="fhQDragOver(event,${i})" ondragleave="fhQDragLeave(event)" ondrop="fhQDrop(event,${i})" ondragend="fhQDragEnd(event)">
    <div class="fh-q-head">
      <div class="fh-q-type"><span class="fh-q-num">${i+1}</span> <i class="fa-solid ${info.icon}"></i> ${info.label}</div>
      <div class="fh-q-toolbar">
        <span class="fh-q-drag-handle" title="Drag to reorder"><i class="fa-solid fa-grip-vertical"></i></span>
        <button class="fh-icon-btn" title="Move up" onclick="fhQMove(${i},-1)"><i class="fa-solid fa-chevron-up"></i></button>
        <button class="fh-icon-btn" title="Move down" onclick="fhQMove(${i},1)"><i class="fa-solid fa-chevron-down"></i></button>
        <button class="fh-icon-btn fh-danger" title="Remove question" onclick="fhQRemove(${i})"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>
    <input class="inp fh-q-prompt" value="${esc(q.prompt)}" placeholder="Type your question…" oninput="fhQSet(${i},'prompt',this.value)">
    ${FH_SCALE_TYPES.includes(q.type)?`<div class="fh-rating-config">
        <label>${q.type==='scale'?'Highest number':'Number of stars'}</label>
        <input type="number" class="inp" style="width:70px" min="3" max="10" value="${q.rating_max||5}" oninput="fhQSet(${i},'rating_max',parseInt(this.value)||5);fhRatingPreview(${i})">
        <div class="fh-star-preview" id="fhStarPrev_${i}">${q.type==='scale'?Array.from({length:(q.rating_max||5)},(_,n)=>n+1).join('  '):'<i class="fa-solid fa-star"></i>'.repeat(q.rating_max||5)}</div>
      </div>`:''}
    ${FH_OPTION_TYPES.includes(q.type)?`<div class="fh-opts" id="fhOpts_${i}">
        ${opts.map((o,oi)=>`<div class="fh-opt-row"><span class="fh-opt-letter">${String.fromCharCode(65+oi)}</span><input class="inp" value="${esc(o)}" placeholder="Option text" oninput="fhOptSet(${i},${oi},this.value)"><button type="button" class="fh-icon-btn fh-danger" title="Remove option" onclick="fhOptRemove(${i},${oi})"><i class="fa-solid fa-xmark"></i></button></div>`).join('')}
        <button type="button" class="btn btn-sm" onclick="fhOptAdd(${i})"><i class="fa-solid fa-plus"></i> Add Option</button>
      </div>`:''}
    <label class="fh-required-toggle"><input type="checkbox" ${q.required?'checked':''} onchange="fhQSet(${i},'required',this.checked)"> Required to submit</label>
  </div>`;
}
window.fhRatingPreview=function(i){
  const q=FH_EDIT&&FH_EDIT.questions[i];if(!q)return;
  const el=$('fhStarPrev_'+i);if(el)el.innerHTML='<i class="fa-solid fa-star"></i>'.repeat(q.rating_max||5);
};
function fhSyncEditFields(){
  if(!FH_EDIT)return;
  FH_EDIT.title=($('fhTitle')||{}).value||FH_EDIT.title||'';
  FH_EDIT.description=($('fhDesc')||{}).value||'';
  FH_EDIT.thank_you_message=($('fhThanks')||{}).value||'';
}
window.fhQSet=function(i,field,val){ if(FH_EDIT&&FH_EDIT.questions[i])FH_EDIT.questions[i][field]=val; };
window.fhOptSet=function(qi,oi,val){ if(FH_EDIT&&FH_EDIT.questions[qi])FH_EDIT.questions[qi].options[oi]=val; };
window.fhOptAdd=function(qi){
  fhSyncEditFields();
  const q=FH_EDIT.questions[qi];if(!q)return;
  q.options=q.options||[];q.options.push('');
  fhFormPageRender();
};
window.fhOptRemove=function(qi,oi){
  fhSyncEditFields();
  const q=FH_EDIT.questions[qi];if(!q)return;
  q.options.splice(oi,1);
  fhFormPageRender();
};
window.fhQAdd=function(type){
  fhSyncEditFields();
  FH_EDIT.questions.push({id:null,type,prompt:'',options:FH_OPTION_TYPES.includes(type)?['',''] :[],rating_max:5,required:true});
  fhFormPageRender();
  setTimeout(()=>{const l=$('fhQList');if(l)l.lastElementChild&&l.lastElementChild.scrollIntoView({behavior:'smooth',block:'center'});},50);
};
window.fhQRemove=function(i){
  fhSyncEditFields();
  FH_EDIT.questions.splice(i,1);
  fhFormPageRender();
};
window.fhQMove=function(i,dir){
  fhSyncEditFields();
  const j=i+dir;
  if(j<0||j>=FH_EDIT.questions.length)return;
  const tmp=FH_EDIT.questions[i];FH_EDIT.questions[i]=FH_EDIT.questions[j];FH_EDIT.questions[j]=tmp;
  fhFormPageRender();
};
/* ---- drag-to-reorder, additive alongside the up/down buttons above (native HTML5 DnD, no library) ---- */
let FH_DRAG_FROM=null;
window.fhQDragStart=function(ev,i){
  FH_DRAG_FROM=i;
  ev.dataTransfer.effectAllowed='move';
  try{ev.dataTransfer.setData('text/plain',String(i));}catch(e){}
};
window.fhQDragOver=function(ev,i){
  ev.preventDefault();
  ev.dataTransfer.dropEffect='move';
  const card=ev.currentTarget;if(card)card.classList.add('fh-q-drag-over');
};
window.fhQDragLeave=function(ev){
  const card=ev.currentTarget;if(card)card.classList.remove('fh-q-drag-over');
};
window.fhQDrop=function(ev,i){
  ev.preventDefault();
  const card=ev.currentTarget;if(card)card.classList.remove('fh-q-drag-over');
  const from=FH_DRAG_FROM;FH_DRAG_FROM=null;
  if(from==null||from===i||!FH_EDIT)return;
  fhSyncEditFields();
  const arr=FH_EDIT.questions;
  const[moved]=arr.splice(from,1);
  arr.splice(i,0,moved);
  fhFormPageRender();
};
window.fhQDragEnd=function(){
  FH_DRAG_FROM=null;
  document.querySelectorAll('.fh-q-drag-over').forEach(el=>el.classList.remove('fh-q-drag-over'));
};
function fhContactSelect(field,val,icon,label){
  const cur=val||'off';
  const opts=[['off','Off'],['optional','Optional'],['required','Required']];
  const why={off:"Not asked at all.",optional:"Shown, but they can leave it blank.",required:"They cannot submit without filling this in."}[cur];
  return `<div class="fh-contact-field">
    <div class="lbl"><i class="fa-solid ${icon}"></i> ${label}</div>
    <div class="fh-seg" id="fhCF_${field}">
      ${opts.map(o=>`<button type="button" class="${cur===o[0]?'on':''}" onclick="fhContactSet('${field}','${o[0]}')">${o[1]}</button>`).join('')}
    </div>
    <div class="why" id="fhCFWhy_${field}">${why}</div>
  </div>`;
}
window.fhContactSet=function(field,val){
  if(!FH_EDIT)return;
  FH_EDIT['collect_'+field]=val;
  const box=$('fhCF_'+field);
  if(box)[...box.children].forEach(b=>b.classList.toggle('on',b.textContent.toLowerCase()===val||(val==='off'&&b.textContent==='Off')||(val==='optional'&&b.textContent==='Optional')||(val==='required'&&b.textContent==='Required')));
  const why=$('fhCFWhy_'+field);
  if(why)why.textContent={off:"Not asked at all.",optional:"Shown, but they can leave it blank.",required:"They cannot submit without filling this in."}[val];
};
window.fhSaveForm=async function(){
  fhSyncEditFields();
  const ed=FH_EDIT;
  if(!ed.title.trim()){toast('Title is required','err');return;}
  if(!ed.questions.length){toast('Add at least one question','err');return;}
  for(const q of ed.questions){
    if(!q.prompt||!q.prompt.trim()){toast('Every question needs its text filled in','err');return;}
    if(FH_OPTION_TYPES.includes(q.type)&&(q.options||[]).filter(o=>o&&o.trim()).length<2){toast((q.type==='multi'?'Multi select':'Multiple choice')+' questions need at least 2 options','err');return;}
    /* A multi-select answer travels as its picks joined by " | ", so an option carrying a pipe of
       its own would come back as two answers that were never offered - and be rejected on submit,
       by which time the person filling it in has no idea why. Caught here instead, while it is
       still somebody's own form to fix. */
    if(q.type==='multi'&&(q.options||[]).some(o=>String(o||'').indexOf('|')!==-1)){toast('A multi select option cannot contain the | character','err');return;}
  }
  if(ed.id){
    const{count}=await sb.schema('feedback').from('responses').select('id',{count:'exact',head:true}).eq('form_id',ed.id);
    if(count&&fhQuestionsStructurallyChanged(ed._origQ||[],ed.questions)){
      const ok=await confirmDialog(`This form already has ${count} response${count===1?'':'s'}. The question set or rating scale has changed, so existing answers may no longer line up with the new structure. Save anyway?`,{title:'This form already has responses',okLabel:'Save anyway'});
      if(!ok)return;
    }
  }
  const btn=$('fhSaveBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…';}
  try{
    let formId=ed.id;
    const payload={title:ed.title.trim(),description:ed.description.trim()||null,thank_you_message:ed.thank_you_message.trim()||null,
      collect_name:ed.collect_name,collect_phone:ed.collect_phone,collect_email:ed.collect_email};
    if(formId){
      const{error}=await sb.schema('feedback').from('forms').update(payload).eq('id',formId);
      if(error)throw new Error(error.message);
    }else{
      const{data,error}=await sb.schema('feedback').from('forms').insert(Object.assign({created_by:state.email},payload)).select().single();
      if(error)throw new Error(error.message);
      formId=data.id;
    }
    // Diff questions: update rows that carry an id, insert rows that don't, delete DB rows no longer present.
    const keepIds=ed.questions.filter(q=>q.id).map(q=>q.id);
    const{data:existing}=await sb.schema('feedback').from('form_questions').select('id').eq('form_id',formId);
    const toDelete=(existing||[]).map(r=>r.id).filter(id=>!keepIds.includes(id));
    if(toDelete.length){
      const{error}=await sb.schema('feedback').from('form_questions').delete().in('id',toDelete);
      if(error)throw new Error(error.message);
    }
    for(let i=0;i<ed.questions.length;i++){
      const q=ed.questions[i];
      const row={seq:i+1,type:q.type,prompt:q.prompt.trim(),required:!!q.required,
        options:FH_OPTION_TYPES.includes(q.type)?q.options.filter(o=>o&&o.trim()):null,
        rating_max:FH_SCALE_TYPES.includes(q.type)?(q.rating_max||5):null};
      if(q.id){
        const{error}=await sb.schema('feedback').from('form_questions').update(row).eq('id',q.id);
        if(error)throw new Error(error.message);
      }else{
        const{data,error}=await sb.schema('feedback').from('form_questions').insert(Object.assign({form_id:formId},row)).select().single();
        if(error)throw new Error(error.message);
        q.id=data.id;
      }
    }
    toast('Form saved','ok');
    FH_EDIT=null;
    await fhLoadForms(true);
    navTo('feedback_hub');
  }catch(e){
    toast(e.message||'Could not save the form','err');
    if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Save Form';}
  }
};

/* ---- Preview: a dedicated page, built from the in-progress FH_EDIT state ---- */
async function fhPreviewPage(v){
  setCrumb(['Feedback','Feedback Hub','Preview']);
  const ed=FH_EDIT;
  if(!ed){
    v.innerHTML=FH_CSS+`<div class="fh-page-head"><button class="fh-page-back" title="Back" onclick="goBack('feedback_hub')"><i class="fa-solid fa-arrow-left"></i></button>
      <div class="fh-page-titles"><div class="fh-page-title">Preview</div></div></div>
      <div class="empty"><i class="fa-solid fa-eye"></i><div>Nothing to preview</div><div style="font-size:12.5px;margin-top:4px">Open a form to build or edit first.</div></div>`;
    return;
  }
  fhSyncEditFields();
  const qHtml=(ed.questions||[]).map(q=>{
    const label=(q.required?'':'(Optional) ')+((FH_QTYPE_INFO[q.type]||{}).label||'Question');
    let body='';
    if(q.type==='rating'){
      body=`<div class="fh-preview-stars">${'<i class="fa-solid fa-star"></i>'.repeat(q.rating_max||5)}</div>`;
    }else if(q.type==='nps'){
      body='<div class="fh-preview-stars" style="letter-spacing:2px;font-size:13px;font-weight:700">0 1 2 3 4 5 6 7 8 9 10</div>';
    }else if(q.type==='scale'){
      body=`<div class="fh-preview-stars" style="letter-spacing:2px;font-size:13px;font-weight:700">${Array.from({length:(q.rating_max||5)},(_,n)=>n+1).join(' ')}</div>`;
    }else if(FH_OPTION_TYPES.includes(q.type)){
      const mark=q.type==='multi'?'fa-regular fa-square':'fa-regular fa-circle';
      body=(q.options||[]).filter(o=>o&&o.trim()).map(o=>`<span class="fh-preview-opt"><i class="${mark}" style="margin-right:7px"></i>${esc(o)}</span>`).join('')||'<span class="fh-preview-opt" style="font-style:italic">No options added yet</span>';
    }else if(q.type==='short_text'){
      body='<span class="fh-preview-opt">Your answer</span>';
    }else{
      body='<span class="fh-preview-opt" style="display:block;min-height:52px">Your answer</span>';
    }
    return `<div class="fh-preview-q"><div class="lbl">${label}</div><div class="prompt">${esc(q.prompt||'(question text goes here)')}</div>${body}</div>`;
  }).join('')||'<div style="color:var(--slate);font-size:13px">No questions yet.</div>';
  v.innerHTML=FH_CSS+`<div class="fh-page-head">
    <button class="fh-page-back" title="Back" onclick="navTo('feedback_hub/${ed.id?('form/'+ed.id):'new'}')"><i class="fa-solid fa-arrow-left"></i></button>
    <div class="fh-page-titles"><div class="fh-page-title">Preview</div><div class="fh-page-sub">How respondents will see this — not live, submits nothing.</div></div>
  </div>
  <div class="fh-preview-frame">
    <div class="fh-preview-head"><b>THE JAIN GROUP</b><div>Feedback</div></div>
    <div class="fh-preview-body">
      <div style="font-size:16px;font-weight:700;margin:0 0 6px">${esc(ed.title||'(form title)')}</div>
      ${ed.description?`<div style="font-size:12.5px;color:var(--slate);margin-bottom:16px">${esc(ed.description)}</div>`:''}
      ${qHtml}
      <button class="btn btn-primary" disabled style="width:100%;justify-content:center;margin-top:6px"><i class="fa-solid fa-paper-plane"></i> Submit</button>
    </div>
  </div>`;
}

/* ---- Records ---- */
async function fhRecords(){
  const b=$('fhBody');if(!b)return;
  loader(b);
  await fhLoadForms();
  const rows=FH_FORMS||[];
  if(!rows.length){
    b.innerHTML='<div class="card"><div class="empty"><i class="fa-solid fa-inbox"></i><div>No forms yet</div><div style="font-size:12.5px;margin-top:4px">Create a form in the Design tab first.</div></div></div>';
    return;
  }
  const{data:counts}=await sb.schema('feedback').from('responses').select('form_id').in('form_id',rows.map(f=>f.id));
  const byForm={};
  (counts||[]).forEach(r=>{byForm[r.form_id]=(byForm[r.form_id]||0)+1;});
  b.innerHTML=`<div class="fh-head">
    <div><div class="sec-title" style="margin:0 0 4px">Pick a form</div><div class="sec-sub" style="margin:0">Select one to see its responses, or take every form's responses at once.</div></div>
    <div class="fh-row-actions">
      <button class="btn btn-sm" id="fhAllPrintBtn" onclick="fhPrintAll()" title="One printout with every response to every form, in full"><i class="fa-solid fa-print"></i> <span>Print all responses</span></button>
      <button class="btn btn-sm" id="fhAllXlsBtn" onclick="fhExportAll()" title="One Excel file: a sheet for each form, a summary, and every answer in one list"><i class="fa-solid fa-file-excel"></i> <span>Download Excel</span></button>
    </div>
  </div>
  <div class="fh-rowlist">${rows.map(f=>`
    <div class="fh-row fh-row-click" onclick="navTo('feedback_hub/records/${f.id}')">
      <div class="fh-row-icon"><i class="fa-solid fa-chart-simple"></i></div>
      <div class="fh-row-main"><div class="fh-row-title">${esc(f.title)}</div>
        <div class="fh-row-meta">${byForm[f.id]||0} response${(byForm[f.id]||0)===1?'':'s'}${f.is_active?'':' · <span class="tag t-red">Closed</span>'}</div>
      </div>
      <i class="fa-solid fa-chevron-right fh-row-chevron"></i>
    </div>`).join('')}</div>`;
}
async function fhRecordsPage(v,formId){
  v.innerHTML=FH_CSS+'<div class="loader"><div class="spin"></div></div>';
  const f=(FH_FORMS&&FH_FORMS.find(x=>x.id===formId))||(await fhLoadForms()).find(x=>x.id===formId);
  if(!f){ v.innerHTML=FH_CSS+'<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Form not found</div></div>'; return; }
  setCrumb(['Feedback','Feedback Hub','Records',f.title]);
  const{data:questions}=await sb.schema('feedback').from('form_questions').select('*').eq('form_id',formId).order('seq');
  const{data:responses,error}=await sb.schema('feedback').from('responses').select('*').eq('form_id',formId).order('submitted_at',{ascending:false});
  const head=`<div class="fh-page-head">
    <button class="fh-page-back" title="Back" onclick="goBack('feedback_hub/1')"><i class="fa-solid fa-arrow-left"></i></button>
    <div class="fh-page-titles"><div class="fh-page-title">${esc(f.title)}</div><div class="fh-page-sub">Records</div></div>
  </div>`;
  if(error){ v.innerHTML=FH_CSS+head+`<div class="err">${esc(error.message)}</div>`; return; }
  FH_REC_FORM=f;FH_REC_ROWS=responses||[];
  const ratingQs=(questions||[]).filter(q=>q.type==='rating'||q.type==='nps'||q.type==='scale');
  const mcqQs=(questions||[]).filter(q=>q.type==='mcq'||q.type==='multi');
  const textQs=(questions||[]).filter(q=>q.type==='short_text'||q.type==='long_text');
  let answers=[];
  if(FH_REC_ROWS.length&&(ratingQs.length||mcqQs.length||textQs.length)){
    const{data}=await sb.schema('feedback').from('response_answers').select('response_id,question_id,answer_text').in('response_id',FH_REC_ROWS.map(r=>r.id));
    answers=data||[];
  }
  // One lookup, keyed by response then question, so the all-in-one table below can pull any
  // response's answer to any question without re-scanning the flat answers array per cell.
  const byResponse={};
  answers.forEach(a=>{ (byResponse[a.response_id]=byResponse[a.response_id]||{})[a.question_id]=a.answer_text; });
  const allQs=(questions||[]);
  function fhCellFor(q,val){
    if(val==null||val==='')return '<span style="color:var(--slate)">—</span>';
    if(q.type==='rating'||q.type==='scale')return esc(val)+'<span style="color:var(--slate)">/'+(q.rating_max||5)+'</span>';
    if(q.type==='nps')return esc(val)+'<span style="color:var(--slate)">/10</span>';
    // Several picks arrive as one piece of text; one per line reads far better in a narrow cell.
    if(q.type==='multi')return String(val).split(' | ').map(x=>esc(x)).join('<br>');
    if(q.type==='mcq')return esc(val);
    const s=String(val);
    return s.length>40?'<span title="'+esc(s)+'">'+esc(s.slice(0,40))+'…</span>':esc(s);
  }
  const showName=f.collect_name!=='off', showPhone=f.collect_phone!=='off', showEmail=f.collect_email!=='off';
  v.innerHTML=FH_CSS+head+`<div class="sec-sub" style="margin:0 0 12px">${FH_REC_ROWS.length} response${FH_REC_ROWS.length===1?'':'s'}</div>
  <div class="card" style="overflow-x:auto;padding:0">
  <table class="tbl fh-tbl-compact" style="width:max-content;min-width:100%">
    <thead><tr>
      ${showName?'<th>Name</th>':''}${showPhone?'<th>Phone</th>':''}${showEmail?'<th>Email</th>':''}
      ${allQs.map(q=>`<th title="${esc(q.prompt)}">${esc(q.prompt.length>28?q.prompt.slice(0,28)+'…':q.prompt)}</th>`).join('')}
      <th>Submitted</th><th style="text-align:center">Preview</th>
    </tr></thead>
    <tbody>${FH_REC_ROWS.length?FH_REC_ROWS.map(r=>`<tr>
      ${showName?`<td style="white-space:nowrap">${esc(r.respondent_name||'—')}</td>`:''}
      ${showPhone?`<td style="font-family:monospace;font-size:11.5px;white-space:nowrap">${esc(r.respondent_phone||'—')}</td>`:''}
      ${showEmail?`<td style="font-size:11.5px;white-space:nowrap">${esc(r.respondent_email||'—')}</td>`:''}
      ${allQs.map(q=>`<td style="white-space:nowrap">${fhCellFor(q,(byResponse[r.id]||{})[q.id])}</td>`).join('')}
      <td style="font-size:11.5px;color:var(--slate);white-space:nowrap">${r.submitted_at?new Date(r.submitted_at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—'}</td>
      <td style="text-align:center"><button class="btn btn-sm" title="Preview" onclick="navTo('feedback_hub/response/${r.id}')"><i class="fa-solid fa-arrow-up-right-from-square"></i></button></td>
    </tr>`).join(''):`<tr><td colspan="${(showName?1:0)+(showPhone?1:0)+(showEmail?1:0)+allQs.length+2}" style="text-align:center;padding:32px;color:var(--slate)">No responses yet — share the QR code to start collecting feedback.</td></tr>`}
    </tbody>
  </table>
  </div>`;
}
/* ---- Records, every form at once: a printout and an Excel file ----
   One loader feeds both, so the paper and the spreadsheet can never disagree. Designers only - the
   same people who can open Records - and the database enforces that on the reads regardless.
   Everything is read in pages of 1000 (the most a single request returns), so a form that has grown
   past that is not silently cut short. Answers are fetched by question, not by a long list of
   response ids, which keeps the request short however many responses there are. */
let FH_ALL_BUSY=false;
async function fhFetchAll(make){
  const out=[], step=1000;
  for(let from=0;;from+=step){
    const{data,error}=await make().range(from,from+step-1);
    if(error)throw new Error(error.message);
    out.push(...(data||[]));
    if(!data||data.length<step)break;
  }
  return out;
}
async function fhAllData(){
  // Not fhLoadForms: that one swallows a failed read and hands back an empty list, which here would
  // mean a blank printout and an empty spreadsheet with no word of what went wrong. Newest form first,
  // as Records lists them.
  const forms=await fhFetchAll(function(){return sb.schema('feedback').from('forms').select('id,title,description,is_active,collect_name,collect_phone,collect_email,created_at').order('created_at',{ascending:false}).order('id',{ascending:false});});
  if(!forms.length)throw new Error('There are no forms yet.');
  return Promise.all(forms.map(async function(f){
    const qs=await fhFetchAll(function(){return sb.schema('feedback').from('form_questions').select('id,seq,prompt,type,rating_max').eq('form_id',f.id).order('seq').order('id');});
    // Oldest first: a printout and a spreadsheet read top to bottom as the feedback came in.
    const rs=await fhFetchAll(function(){return sb.schema('feedback').from('responses').select('id,respondent_name,respondent_phone,respondent_email,submitted_at').eq('form_id',f.id).order('submitted_at',{ascending:true}).order('id');});
    const by={};
    if(rs.length&&qs.length){
      const qids=qs.map(function(q){return q.id;});
      const an=await fhFetchAll(function(){return sb.schema('feedback').from('response_answers').select('response_id,question_id,answer_text').in('question_id',qids).order('id');});
      an.forEach(function(a){(by[a.response_id]=by[a.response_id]||{})[a.question_id]=a.answer_text;});
    }
    return {form:f,questions:qs,responses:rs,answers:by};
  }));
}
// Name, phone and email columns follow the form's own settings (as Records does), but a column is
// also kept when somebody did fill it in before the setting was switched off - never drop real data.
function fhShowCols(d){
  const rs=d.responses, f=d.form;
  return {
    name:f.collect_name!=='off'||rs.some(function(r){return r.respondent_name;}),
    phone:f.collect_phone!=='off'||rs.some(function(r){return r.respondent_phone;}),
    email:f.collect_email!=='off'||rs.some(function(r){return r.respondent_email;})
  };
}
function fhPad2(n){return String(n).padStart(2,'0');}
function fhStamp(ts){
  if(!ts)return '';
  const d=new Date(ts);
  return d.getFullYear()+'-'+fhPad2(d.getMonth()+1)+'-'+fhPad2(d.getDate())+' '+fhPad2(d.getHours())+':'+fhPad2(d.getMinutes());
}
function fhNiceWhen(ts){
  return ts?new Date(ts).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
}
function fhTotalResponses(data){return data.reduce(function(n,d){return n+d.responses.length;},0);}
/* ---- the printout: its own page in a new tab, so none of the app's menus print with it ---- */
const FH_PRINT_CSS=`
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;padding:0 28px 40px;font-family:"Segoe UI",Arial,sans-serif;font-size:12px;line-height:1.45;color:#0f172a;background:#fff}
@page{size:A4;margin:14mm 12mm 16mm;@bottom-right{content:counter(page);font-size:10px;color:#64748b}}
.bar{position:sticky;top:0;background:#0f172a;color:#e2e8f0;margin:0 -28px 22px;padding:10px 28px;display:flex;align-items:center;justify-content:space-between;gap:14px;font-size:12.5px}
.bar button{background:#fff;color:#0f172a;border:0;border-radius:8px;padding:7px 18px;font-weight:700;font-size:13px;cursor:pointer}
.top{border-bottom:2px solid #0f172a;padding-bottom:10px;margin-bottom:16px}
.brand{font-size:11px;font-weight:700;letter-spacing:1.2px;color:#64748b}
h1{font-size:21px;margin:4px 0 2px}
h2{font-size:17px;margin:0 0 3px}
.meta{font-size:11.5px;color:#475569}
.toc{width:100%;border-collapse:collapse;margin:6px 0 4px}
.toc th,.toc td{text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:12px}
.toc th{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:#64748b}
.toc .r{text-align:right;white-space:nowrap}
.toc tfoot td{font-weight:700;border-top:2px solid #0f172a;border-bottom:0}
section.form{break-before:page;page-break-before:always;margin-top:34px;padding-top:18px;border-top:1px solid #cbd5e1}
.desc{margin:6px 0 0;color:#334155;white-space:pre-wrap}
.none{margin:18px 0;color:#64748b;font-style:italic}
.resp{break-inside:avoid;page-break-inside:avoid;border:1px solid #cbd5e1;border-radius:6px;margin:12px 0 0;overflow:hidden}
.rh{display:flex;gap:14px;align-items:baseline;flex-wrap:wrap;background:#f1f5f9;padding:6px 10px;border-bottom:1px solid #cbd5e1}
.rh .who{flex:1;color:#334155}
.rh .when{color:#64748b;font-size:11px;white-space:nowrap}
table.qa{width:100%;border-collapse:collapse}
table.qa td{padding:5px 10px;vertical-align:top;border-top:1px solid #eef2f7}
table.qa tr:first-child td{border-top:0}
td.n{width:26px;color:#94a3b8;font-size:11px;padding-right:0}
td.q{width:46%;color:#475569;white-space:pre-wrap}
td.a{font-weight:600;white-space:pre-wrap;word-break:break-word}
.nil{color:#94a3b8;font-weight:400}
.of{color:#64748b;font-weight:400}
@media print{.noprint{display:none!important}body{padding:0}section.form{margin-top:0;padding-top:0;border-top:0}}
`;
function fhAllPrintHtml(data){
  const total=fhTotalResponses(data);
  const plural=function(n,w){return n+' '+w+(n===1?'':'s');};
  const ans=function(q,val){
    if(val==null||val==='')return '<span class="nil">—</span>';
    if(q.type==='rating'||q.type==='scale')return esc(val)+'<span class="of"> / '+(q.rating_max||5)+'</span>';
    if(q.type==='nps')return esc(val)+'<span class="of"> / 10</span>';
    // Several picks arrive as one piece of text; one per line reads better on paper.
    if(q.type==='multi')return String(val).split(' | ').map(function(x){return esc(x);}).join('<br>');
    return esc(val);
  };
  const toc=data.map(function(d){
    return '<tr><td>'+esc(d.form.title||'(untitled form)')+'</td><td>'+(d.form.is_active?'Active':'Closed')+'</td><td class="r">'+d.questions.length+'</td><td class="r">'+d.responses.length+'</td></tr>';
  }).join('');
  const sections=data.map(function(d){
    const f=d.form, qs=d.questions, sh=fhShowCols(d);
    const blocks=d.responses.map(function(r,i){
      const who=[sh.name&&r.respondent_name,sh.phone&&r.respondent_phone,sh.email&&r.respondent_email].filter(Boolean).map(function(x){return esc(x);}).join(' · ')||'Anonymous';
      return '<div class="resp"><div class="rh"><b>Response '+(i+1)+'</b><span class="who">'+who+'</span><span class="when">'+fhNiceWhen(r.submitted_at)+'</span></div>'
        +'<table class="qa">'+qs.map(function(q,qi){
          return '<tr><td class="n">'+(qi+1)+'</td><td class="q">'+esc(q.prompt||'')+'</td><td class="a">'+ans(q,(d.answers[r.id]||{})[q.id])+'</td></tr>';
        }).join('')+'</table></div>';
    }).join('');
    return '<section class="form"><h2>'+esc(f.title||'(untitled form)')+'</h2>'
      +'<div class="meta">'+(f.is_active?'Active':'Closed')+' · '+plural(qs.length,'question')+' · '+plural(d.responses.length,'response')+'</div>'
      +(f.description?'<p class="desc">'+esc(f.description)+'</p>':'')
      +(blocks||'<p class="none">No responses yet.</p>')+'</section>';
  }).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Feedback Hub - all responses</title><style>'+FH_PRINT_CSS+'</style></head><body>'
    +'<div class="bar noprint"><span>The print window opens by itself. To keep a copy instead, choose “Save as PDF” as the printer.</span><button onclick="window.print()">Print</button></div>'
    +'<header class="top"><div class="brand">THE JAIN GROUP</div><h1>Feedback Hub — all responses</h1>'
    +'<div class="meta">Printed '+fhNiceWhen(new Date())+' · '+plural(data.length,'form')+' · '+plural(total,'response')+'</div></header>'
    +'<table class="toc"><thead><tr><th>Form</th><th>Status</th><th class="r">Questions</th><th class="r">Responses</th></tr></thead><tbody>'+toc+'</tbody>'
    +'<tfoot><tr><td colspan="3">Total</td><td class="r">'+total+'</td></tr></tfoot></table>'
    +sections+'</body></html>';
}
window.fhPrintAll=async function(){
  if(FH_ALL_BUSY||!fhCanQrForms())return;
  // The tab has to be opened here, inside the click: a tab opened after the data arrives is taken for
  // a pop-up and blocked. It is filled in once the responses are in.
  const w=window.open('','_blank');
  if(!w){toast('Your browser blocked the printout window. Allow pop-ups for this site, then press Print again.','warn');return;}
  try{w.document.write('<!doctype html><title>Preparing…</title><body style="font-family:Segoe UI,Arial,sans-serif;padding:40px;color:#334155">Preparing the printout…</body>');}catch(e){}
  FH_ALL_BUSY=true;fhAllBusy('fhAllPrintBtn',true,'Preparing…');
  try{
    const data=await fhAllData();
    if(w.closed)return;
    w.document.open();w.document.write(fhAllPrintHtml(data));w.document.close();
    w.focus();
    setTimeout(function(){try{w.print();}catch(e){}},600);
  }catch(e){
    try{w.close();}catch(_){}
    toast('Could not prepare the printout: '+((e&&e.message)||e),'err');
  }finally{FH_ALL_BUSY=false;fhAllBusy('fhAllPrintBtn',false);}
};
function fhAllBusy(id,on,label){
  ['fhAllPrintBtn','fhAllXlsBtn'].forEach(function(x){const b=$(x);if(b)b.disabled=!!on;});
  const b=$(id);if(!b)return;
  const s=b.querySelector('span'), i=b.querySelector('i');
  if(on){
    b.dataset.lbl=s?s.textContent:'';b.dataset.ic=i?i.className:'';
    if(s)s.textContent=label;
    if(i)i.className='fa-solid fa-spinner fa-spin';
  }else{
    if(s&&b.dataset.lbl)s.textContent=b.dataset.lbl;
    if(i&&b.dataset.ic)i.className=b.dataset.ic;
  }
}
/* ---- the Excel file: Summary, one sheet per form, and every answer in one flat list ---- */
function fhQHead(q,i){
  let h=String(q.prompt||('Question '+(i+1))).replace(/\s+/g,' ').trim();
  if(q.type==='rating'||q.type==='scale')h+=' (out of '+(q.rating_max||5)+')';
  else if(q.type==='nps')h+=' (0-10)';
  return h;
}
// Scores go in as numbers so a column can be averaged; everything else stays text exactly as given.
function fhCellValue(q,val){
  if(val==null||val==='')return '';
  if((q.type==='rating'||q.type==='scale'||q.type==='nps')&&/^\d+(\.\d+)?$/.test(String(val).trim()))return Number(val);
  return String(val);
}
function fhFormTable(d){
  const sh=fhShowCols(d), qs=d.questions, seen={};
  // Two questions can carry the same wording; a duplicate column title would make them look like one.
  const qHeads=qs.map(function(q,i){const h=fhQHead(q,i);seen[h]=(seen[h]||0)+1;return seen[h]>1?h+' ('+seen[h]+')':h;});
  const head=['#','Submitted'].concat(sh.name?['Name']:[],sh.phone?['Phone']:[],sh.email?['Email']:[],qHeads);
  const rows=d.responses.map(function(r,i){
    const c=[i+1,fhStamp(r.submitted_at)];
    if(sh.name)c.push(r.respondent_name||'');
    if(sh.phone)c.push(r.respondent_phone||'');
    if(sh.email)c.push(r.respondent_email||'');
    qs.forEach(function(q){c.push(fhCellValue(q,(d.answers[r.id]||{})[q.id]));});
    return c;
  });
  return [head].concat(rows);
}
function fhFlatTable(data){
  const rows=[['Form','Response #','Submitted','Name','Phone','Email','Q #','Question','Answer']];
  data.forEach(function(d){
    d.responses.forEach(function(r,i){
      d.questions.forEach(function(q,qi){
        const v=(d.answers[r.id]||{})[q.id];
        if(v==null||v==='')return;
        rows.push([d.form.title||'',i+1,fhStamp(r.submitted_at),r.respondent_name||'',r.respondent_phone||'',r.respondent_email||'',qi+1,String(q.prompt||'').replace(/\s+/g,' ').trim(),String(v)]);
      });
    });
  });
  return rows;
}
function fhSummaryTable(data){
  const rows=[['Form','Status','Questions','Responses','Latest response']];
  data.forEach(function(d){
    rows.push([d.form.title||'',d.form.is_active?'Active':'Closed',d.questions.length,d.responses.length,d.responses.length?fhStamp(d.responses[d.responses.length-1].submitted_at):'']);
  });
  rows.push(['Total','','',fhTotalResponses(data),'']);
  return rows;
}
// Excel allows 31 characters and none of  [ ] : * ? / \  in a sheet name, and treats names as the same
// whatever their capitals - so two forms with long, similar titles must not collide.
function fhSheetName(title,used){
  const base=String(title||'Form').replace(/[\[\]:*?\/\\]/g,' ').replace(/\s+/g,' ').trim().slice(0,31)||'Form';
  let n=base,k=2;
  while(used[n.toLowerCase()]){const suf=' ('+(k++)+')';n=base.slice(0,31-suf.length)+suf;}
  used[n.toLowerCase()]=1;
  return n;
}
function fhAllWorkbook(XL,data){
  const wb=XL.utils.book_new(), used={summary:1,'all answers':1};
  const add=function(name,aoa){
    const ws=XL.utils.aoa_to_sheet(aoa);
    const cols=[];
    aoa.slice(0,200).forEach(function(row){row.forEach(function(c,i){
      const len=Math.min(String(c==null?'':c).length,60);
      cols[i]=Math.max(cols[i]||8,len+2);
    });});
    ws['!cols']=cols.map(function(w){return {wch:w};});
    XL.utils.book_append_sheet(wb,ws,name);
  };
  add('Summary',fhSummaryTable(data));
  data.forEach(function(d){add(fhSheetName(d.form.title,used),fhFormTable(d));});
  add('All answers',fhFlatTable(data));
  return wb;
}
// Only if the spreadsheet library cannot be fetched: the flat list as CSV, which Excel opens too. The
// byte-order mark makes Excel read Hindi and other non-English text correctly; a cell starting with
// = + - @ would be run as a formula by Excel, so it is given a leading quote.
function fhCsv(rows){
  return rows.map(function(r){return r.map(function(c){
    let s=c==null?'':String(c);
    if(typeof c!=='number'&&/^[=+\-@\t\r]/.test(s))s="'"+s;
    return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
  }).join(',');}).join('\r\n');
}
function fhDownload(blob,name){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=name;
  document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1500);
}
window.fhExportAll=async function(){
  if(FH_ALL_BUSY||!fhCanQrForms())return;
  FH_ALL_BUSY=true;fhAllBusy('fhAllXlsBtn',true,'Preparing…');
  try{
    const data=await fhAllData();
    const day=new Date().toLocaleDateString('en-CA');
    let XL=null;
    try{XL=await loadXLSX();}catch(e){XL=null;}
    if(XL){
      const out=XL.write(fhAllWorkbook(XL,data),{bookType:'xlsx',type:'array'});
      fhDownload(new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'Feedback-Hub-responses-'+day+'.xlsx');
      toast('Excel file downloaded','ok');
    }else{
      fhDownload(new Blob(['﻿'+fhCsv(fhFlatTable(data))],{type:'text/csv;charset=utf-8'}),'Feedback-Hub-responses-'+day+'.csv');
      toast('The Excel maker could not load, so you got a CSV file instead. Excel opens it the same way.','warn');
    }
  }catch(e){
    toast('Could not prepare the file: '+((e&&e.message)||e),'err');
  }finally{FH_ALL_BUSY=false;fhAllBusy('fhAllXlsBtn',false);}
};
window.fhToggleTextList=function(qid){
  const el=$('fhTextList_'+qid);if(!el)return;
  const btn=$('fhTextBtn_'+qid);
  const show=el.style.display!=='block';
  el.style.display=show?'block':'none';
  if(btn)btn.classList.toggle('open',show);
};

/* ---- Response Details: a dedicated page, styled like the actual form the respondent filled in,
   fetching its own data by id so a direct link/refresh works without depending on Records' cache. ---- */
async function fhResponseDetailPage(v,responseId){
  v.innerHTML=FH_CSS+'<div class="loader"><div class="spin"></div></div>';
  const{data:r,error:rErr}=await sb.schema('feedback').from('responses').select('*,forms(title,collect_name,collect_phone,collect_email)').eq('id',responseId).maybeSingle();
  if(rErr||!r){ v.innerHTML=FH_CSS+'<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Response not found</div></div>'; return; }
  const{data:answers,error:aErr}=await sb.schema('feedback').from('response_answers')
    .select('*,form_questions(seq,prompt,type,rating_max,options)').eq('response_id',responseId).order('question_id');
  const form=r.forms||{};
  setCrumb(['Feedback','Feedback Hub','Records',form.title||'Response']);
  const who=r.respondent_name?esc(r.respondent_name):'Anonymous respondent';
  const when=r.submitted_at?new Date(r.submitted_at).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Unknown time';
  const contactLine=[form.collect_phone!=='off'&&r.respondent_phone?esc(r.respondent_phone):null,
    form.collect_email!=='off'&&r.respondent_email?esc(r.respondent_email):null].filter(Boolean).join(' · ');
  const backHref=FH_REC_FORM&&FH_REC_FORM.id?('feedback_hub/records/'+FH_REC_FORM.id):'feedback_hub/1';
  const qHtml=aErr?`<div class="err">${esc(aErr.message)}</div>`:(answers||[]).map(a=>{
    const q=a.form_questions||{};
    let body='';
    if(q.type==='rating'){
      const n=parseInt(a.answer_text)||0, max=q.rating_max||5;
      body=`<div class="fh-preview-stars">${Array.from({length:max}).map((_,i)=>`<i class="fa-solid fa-star${i<n?' on':''}"></i>`).join('')}</div>`;
    }else if(q.type==='mcq'){
      body=(q.options||[]).map(o=>`<span class="fh-preview-opt${o===a.answer_text?' on':''}"><i class="fa-${o===a.answer_text?'solid fa-circle-dot':'regular fa-circle'}" style="margin-right:7px"></i>${esc(o)}</span>`).join('');
    }else{
      body=`<span class="fh-preview-opt" style="white-space:pre-wrap">${esc(a.answer_text||'(no answer)')}</span>`;
    }
    return `<div class="fh-preview-q"><div class="lbl">Q${q.seq}</div><div class="prompt">${esc(q.prompt||'')}</div>${body}</div>`;
  }).join('');
  v.innerHTML=FH_CSS+`<div class="fh-page-head">
    <button class="fh-page-back" title="Back" onclick="navTo('${backHref}')"><i class="fa-solid fa-arrow-left"></i></button>
    <div class="fh-page-titles"><div class="fh-page-title">${who}</div><div class="fh-page-sub">${when}${contactLine?' · '+contactLine:''}</div></div>
  </div>
  <div class="fh-preview-frame">
    <div class="fh-preview-head"><b>THE JAIN GROUP</b><div>Feedback</div></div>
    <div class="fh-preview-body">
      <div style="font-size:16px;font-weight:700;margin:0 0 12px">${esc(form.title||'')}</div>
      ${qHtml}
    </div>
  </div>`;
}
VIEWS.video=function(v,seg){
  setCrumb(['Knowledge','Video Library']);
  const tabs=['All Videos','Training','Youtube','WalkThrough'];
  let ti=parseInt(seg&&seg[0]); if(isNaN(ti)||ti<0||ti>=tabs.length)ti=0;
  const tname=tabs[ti];
  const list=ti===0?VIDEOS:VIDEOS.filter(x=>x.cat===tname);
  const tabbar='<div class="tabs">'+tabs.map((t,i)=>'<div class="tab '+(i===ti?'active':'')+'" onclick="navTo(\'video/'+i+'\')">'+esc(t)+'</div>').join('')+'</div>';
  function vidCard(x){
    const ytOpen=(x.cat==='Youtube'||x.cat==='WalkThrough'||x.cat==='Training');
    const ytUrl=x.url||('https://www.youtube.com/watch?v='+x.yt);
    const badge=ytOpen?'<span style="position:absolute;top:8px;right:8px;background:#ff0000;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;letter-spacing:.4px;line-height:1.6"><i class=\"fa-brands fa-youtube\"></i> YouTube</span>':'';
    const thumbUrl=x.yt?('https://img.youtube.com/vi/'+x.yt+'/hqdefault.jpg'):'';const thumbStyle=thumbUrl?'background-image:url('+thumbUrl+')':'background:#0a2640';const thumbInner=thumbUrl?'<span class="vid-play"><i class="fa-solid fa-play"></i></span>'+badge:'<span style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px"><i class="fa-brands fa-youtube" style="color:#ff0000;font-size:38px"></i><span style="color:#fff;font-size:11px;font-weight:600;letter-spacing:.5px;opacity:.8">PLAYLIST</span></span>';const thumb='<div class="vid-thumb" style="'+thumbStyle+'">'+thumbInner+'</div>';
    const meta='<div class="vid-meta"><div class="vid-title">'+esc(x.t)+'</div><div class="vid-cat"><i class="fa-brands fa-youtube" style="color:#ff0000"></i> '+esc(x.cat)+'</div></div>';
    // Use <a> tag for YouTube — anchor clicks are never blocked by popup blockers
    if(ytOpen) return '<a class="vid-card" href="'+ytUrl+'" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:block">'+thumb+meta+'</a>';
    return '<div class="vid-card" onclick="vidPlay(\''+x.yt+'\',\''+esc(x.t).replace(/'/g,'\\x27')+'\')">'+thumb+meta+'</div>';
  }
  const grid=list.length?'<div class="vid-grid">'+list.map(vidCard).join('')+'</div>':'<div class="card card-pad empty" style="margin-top:0"><i class="fa-regular fa-circle-play"></i><div style="font-weight:600;color:var(--ink)">No videos in '+esc(tname)+' yet</div><p style="max-width:380px;margin:6px auto 0">Videos added to this section will appear here.</p></div>';
  v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid fa-clapperboard" style="color:#be123c"></i> Video Library</h1><p>Training videos, project walkthroughs & recorded sessions</p></div></div>'+tabbar+grid;
};
window.vidPlay=function(yt,title){ openModal('<div class="modal-head"><h3><i class="fa-brands fa-youtube" style="color:#ff0000"></i> '+esc(title)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" style="padding:0;background:#000"><div style="position:relative;padding-bottom:56.25%;height:0"><iframe src="https://www.youtube.com/embed/'+yt+'?autoplay=1&rel=0" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></div></div>','lg'); };

