const FH_QTYPE_INFO={
  rating:{icon:'fa-star',label:'Rating',desc:'A star scale, e.g. 1 to 5',color:'#f59e0b'},
  mcq:{icon:'fa-list-check',label:'Multiple Choice',desc:'Pick one option',color:'#0369a1'},
  short_text:{icon:'fa-i-cursor',label:'Short Text',desc:'A single line of text',color:'#7c3aed'},
  long_text:{icon:'fa-align-left',label:'Long Text',desc:'A paragraph of text',color:'#0f766e'}
};
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
    if(q.type==='rating'&&(o.rating_max||5)!==(q.rating_max||5))return true;
    if(q.type==='mcq'){
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
  if(seg[0]==='new')       return fhFormPage(v,null);
  if(seg[0]==='form'&&seg[1])     return fhFormPage(v,Number(seg[1]));
  if(seg[0]==='preview')   return fhPreviewPage(v);
  if(seg[0]==='records'&&seg[1]) return fhRecordsPage(v,Number(seg[1]));
  if(seg[0]==='response'&&seg[1]) return fhResponseDetailPage(v,seg[1]);
  setCrumb(['Feedback','Feedback Hub']);
  const tabs=['Design','Records'];
  const ti=mTab(seg,tabs.length);
  v.innerHTML=FH_CSS+mHead('fa-qrcode','#7c3aed','Feedback Hub')+mTabs('feedback_hub',tabs,ti)+'<div id="fhBody" style="margin-top:16px"><div class="loader"><div class="spin"></div></div></div>';
  if(ti===0){await fhDesign();return;}
  await fhRecords();
};
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
  b.innerHTML=`<div class="fh-head">
    <div><div class="sec-title" style="margin:0">Your Forms</div><div class="sec-sub" style="margin:0">Build a form, share its QR code or link, and watch responses come in.</div></div>
    <button class="btn btn-primary" onclick="navTo('feedback_hub/new')"><i class="fa-solid fa-plus"></i> New Form</button>
  </div>
  ${rows.length?`<div class="fh-rowlist">${rows.map(f=>`
    <div class="fh-row">
      <div class="fh-row-icon"><i class="fa-solid fa-clipboard-list"></i></div>
      <div class="fh-row-main"><div class="fh-row-title">${esc(f.title)}</div>
        <div class="fh-row-meta"><span id="fhQCount_${f.id}">…</span>${f.is_active?'<span class="tag t-green">Active</span>':'<span class="tag t-red">Closed</span>'}</div>
      </div>
      <div class="fh-row-actions">
        <button class="btn btn-sm" onclick="navTo('feedback_hub/form/${f.id}')"><i class="fa-solid fa-pen"></i> <span>Edit</span></button>
        <button class="btn btn-sm" onclick="navTo('feedback_hub/records/${f.id}')"><i class="fa-solid fa-chart-simple"></i> <span>Records</span></button>
        <button class="btn btn-sm fh-row-icon-btn" title="QR Code" onclick="fhShowQR(${f.id})"><i class="fa-solid fa-qrcode"></i></button>
        <button class="btn btn-sm fh-row-icon-btn" title="${f.is_active?'Close to new responses':'Reopen for responses'}" onclick="fhToggleActive(${f.id},${!f.is_active})">${f.is_active?'<i class="fa-solid fa-lock"></i>':'<i class="fa-solid fa-lock-open"></i>'}</button>
        <button class="btn btn-sm fh-danger fh-row-icon-btn" title="Delete" onclick="fhDeleteForm(${f.id})"><i class="fa-solid fa-trash"></i></button>
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
    ${q.type==='rating'?`<div class="fh-rating-config">
        <label>Number of stars</label>
        <input type="number" class="inp" style="width:70px" min="3" max="10" value="${q.rating_max||5}" oninput="fhQSet(${i},'rating_max',parseInt(this.value)||5);fhRatingPreview(${i})">
        <div class="fh-star-preview" id="fhStarPrev_${i}">${'<i class="fa-solid fa-star"></i>'.repeat(q.rating_max||5)}</div>
      </div>`:''}
    ${q.type==='mcq'?`<div class="fh-opts" id="fhOpts_${i}">
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
  FH_EDIT.questions.push({id:null,type,prompt:'',options:type==='mcq'?['',''] :[],rating_max:5,required:true});
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
    if(q.type==='mcq'&&(q.options||[]).filter(o=>o&&o.trim()).length<2){toast('Multiple choice questions need at least 2 options','err');return;}
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
        options:q.type==='mcq'?q.options.filter(o=>o&&o.trim()):null,
        rating_max:q.type==='rating'?(q.rating_max||5):null};
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
    const label=(q.required?'':'(Optional) ')+(q.type==='rating'?'Rating':q.type==='mcq'?'Multiple choice':'Question');
    let body='';
    if(q.type==='rating'){
      body=`<div class="fh-preview-stars">${'<i class="fa-solid fa-star"></i>'.repeat(q.rating_max||5)}</div>`;
    }else if(q.type==='mcq'){
      body=(q.options||[]).filter(o=>o&&o.trim()).map(o=>`<span class="fh-preview-opt"><i class="fa-regular fa-circle" style="margin-right:7px"></i>${esc(o)}</span>`).join('')||'<span class="fh-preview-opt" style="font-style:italic">No options added yet</span>';
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
  b.innerHTML=`<div class="sec-title" style="margin:0 0 4px">Pick a form</div><div class="sec-sub" style="margin:0 0 12px">Select one to see its responses.</div>
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
  const ratingQs=(questions||[]).filter(q=>q.type==='rating');
  const mcqQs=(questions||[]).filter(q=>q.type==='mcq');
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
    if(q.type==='rating')return esc(val)+'<span style="color:var(--slate)">/'+(q.rating_max||5)+'</span>';
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