/* ============================ SYSTEM FEEDBACKS (Feedback Hub) ============================
   The Systems department posts what it has built or fixed - a New Feature or a Bug Fixed - with a
   name, a description and the people who executed it. Sales and Pre Sales open it, give 1 to 10
   stars and a remark. Not QR-based: open, fill, submit, and it is recorded against the signed-in
   person.

   Every item has the same five parts: Name, Description, Executed By, Rating, Remarks. The first
   three are written by Systems and are mandatory; the rating is mandatory for the person rating it.

   Who sees what is decided by the database (feedback.is_systems / feedback.is_system_rater, see
   20261103200000_feedback_system_feedbacks.sql): every Systems person reads every item and every
   rating, whether or not they executed it; a rater gets back only their own rating. The tabs here
   (fhIsSystems / fhIsRater in 06-nav.js) only mirror that. */
const SF_KINDS=['New Feature','Bug Fixed'];
const SF_KIND_META={'New Feature':{icon:'fa-wand-magic-sparkles',cls:'sf-k-new'},'Bug Fixed':{icon:'fa-bug-slash',cls:'sf-k-bug'}};
let SF_ITEMS=null, SF_FILTER='All', SF_EDIT=null, SF_RATE=null;

const SF_CSS=`<style id="sfCss">
.sf-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.sf-bar h2{font-size:15px;font-weight:700;margin:0}
.sf-bar p{font-size:12.5px;color:var(--slate);margin:2px 0 0}
.sf-filter{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff}
.sf-filter button{border:none;background:none;padding:7px 13px;font:inherit;font-size:12.5px;font-weight:600;color:var(--slate);cursor:pointer;border-right:1px solid var(--line)}
.sf-filter button:last-child{border-right:none}
.sf-filter button.on{background:#f1f5f9;color:var(--ink)}
.sf-list{display:flex;flex-direction:column;gap:10px}
.sf-card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px;display:flex;gap:16px;align-items:flex-start}
.sf-card.click{cursor:pointer}.sf-card.click:hover{border-color:#cbd5e1;background:#fcfdfe}
.sf-main{flex:1;min-width:0}
.sf-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.sf-kind{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:2px 8px;border-radius:5px;border:1px solid}
.sf-k-new{color:#1e40af;background:#eff4ff;border-color:#c7d7fe}
.sf-k-bug{color:#166534;background:#f0fdf4;border-color:#bbf7d0}
.sf-closed{font-size:11px;font-weight:600;color:var(--slate);border:1px solid var(--line);border-radius:5px;padding:2px 8px}
.sf-date{font-size:11.5px;color:var(--slate)}
.sf-title{font-size:14px;font-weight:700;line-height:1.35}
.sf-desc{font-size:12.5px;color:#334155;line-height:1.5;margin-top:4px;white-space:pre-wrap}
.sf-desc.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal}
.sf-by{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;font-size:11.5px;color:var(--slate)}
.sf-lbl{font-size:10.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--slate)}
.sf-person{display:inline-flex;align-items:center;gap:6px;padding:2px 9px 2px 2px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:12px;color:var(--ink);font-weight:500}
.sf-person .avatar-sm{width:22px;height:22px;min-width:22px;font-size:9.5px}
/* Executed By outside the picker: round profile circles only, the name on hover */
.sf-circles{display:inline-flex;flex-wrap:wrap;gap:6px;align-items:center}
.sf-circles .avatar-sm{width:30px;height:30px;min-width:30px;font-size:11px;cursor:default;box-shadow:0 0 0 2px #fff,0 0 0 3px #e5e7eb}
/* the popups keep one width, however many people are picked */
.modal:has(.sf-form){width:560px;max-width:calc(100vw - 32px)}
.sf-form .sf-ppl{min-width:0}.sf-form .sf-person{max-width:100%}
.sf-person .rm{border:none;background:none;color:var(--slate);cursor:pointer;padding:0 0 0 2px;font-size:12px}
.sf-person .rm:hover{color:var(--err)}
.sf-side{flex:none;text-align:right;min-width:110px}
.sf-score{font-size:20px;font-weight:700;line-height:1}.sf-score small{font-size:12px;color:var(--slate);font-weight:500}
.sf-count{font-size:11.5px;color:var(--slate);margin-top:4px}
.sf-mine{font-size:12px;color:var(--slate);margin-top:6px}
.sf-stars{display:inline-flex;gap:2px;color:#f59e0b;font-size:12px}.sf-stars .off{color:#e2e8f0}
/* popup */
.sf-form label.l{display:block;font-size:12.5px;font-weight:600;margin:0 0 6px;color:var(--ink)}
.sf-form label.l .req{color:var(--err)}
.sf-form .row{margin-bottom:16px}
.sf-form input[type=text],.sf-form textarea{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font:inherit;font-size:13.5px;background:#fff}
.sf-form textarea{min-height:96px;resize:vertical}
.sf-form input:focus,.sf-form textarea:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(29,78,216,.12)}
.sf-form .bad input,.sf-form .bad textarea,.sf-form .bad .sf-ppl{border-color:var(--err)}
.sf-form .err{font-size:11.5px;color:var(--err);margin-top:5px;display:none}.sf-form .bad .err{display:block}
.sf-seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.sf-seg button{border:none;background:#fff;padding:8px 14px;font:inherit;font-size:13px;font-weight:600;color:var(--slate);cursor:pointer;display:inline-flex;align-items:center;gap:7px;border-right:1px solid var(--line)}
.sf-seg button:last-child{border-right:none}.sf-seg button.on{background:#f1f5f9;color:var(--ink)}
.sf-ppl{border:1px solid var(--line);border-radius:8px;padding:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;position:relative;background:#fff}
.sf-ppl input{border:none!important;box-shadow:none!important;flex:1;min-width:140px;padding:5px 6px!important}
.sf-dd{margin-top:4px;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 10px 30px rgba(15,23,42,.12);max-height:220px;overflow:auto;z-index:20}
.sf-dd button{display:flex;align-items:center;gap:9px;width:100%;border:none;background:none;padding:8px 10px;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.sf-dd button:hover,.sf-dd button.hi{background:#f1f5f9}
.sf-dd .d{font-size:11px;color:var(--slate);margin-left:auto}
.sf-dd .none{padding:10px;font-size:12.5px;color:var(--slate)}
.sf-view{border:1px solid var(--line);border-radius:10px;padding:14px;background:#fafbfc;margin-bottom:18px}
.sf-rate{display:flex;gap:4px;flex-wrap:wrap}
.sf-rate button{border:none;background:none;padding:2px;cursor:pointer;font-size:24px;color:#e2e8f0;line-height:1}
.sf-rate button.on{color:#f59e0b}
.sf-rate-val{font-size:12.5px;color:var(--slate);margin-top:6px;min-height:18px}
/* item page */
.sf-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:14px 0}
.sf-sum div{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.sf-sum b{display:block;font-size:20px}.sf-sum span{font-size:11.5px;color:var(--slate)}
.sf-tbl{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.sf-tbl th{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--slate);text-align:left;padding:9px 12px;background:#f8fafc;border-bottom:1px solid var(--line)}
.sf-tbl td{padding:10px 12px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top}
.sf-tbl tr:last-child td{border-bottom:none}
/* list rows: top line / title + one-line summary / footer (people left, rating right) */
.sf-item{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px 0;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.sf-item:hover{border-color:#cbd5e1;box-shadow:0 2px 10px rgba(15,23,42,.05)}
.sf-item .sf-top{margin-bottom:10px;gap:10px}
.sf-item .sf-title{font-size:15px}
.sf-item .sf-sumline{font-size:13px;color:var(--slate);line-height:1.5;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sf-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:16px;padding:12px 0 14px;border-top:1px solid #eef1f4}
.sf-foot .sf-by{margin-top:0;gap:8px}
.sf-rt{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--slate);white-space:nowrap}
.sf-rt b{font-size:15px;color:var(--ink)}
.sf-list{gap:12px}
@media(max-width:640px){.sf-card{flex-direction:column;gap:10px}.sf-side{text-align:left}.sf-sum{grid-template-columns:1fr 1fr 1fr}.sf-tbl .hide-m{display:none}}
</style>`;

function sfKindTag(k){ const m=SF_KIND_META[k]||SF_KIND_META['New Feature']; return '<span class="sf-kind '+m.cls+'"><i class="fa-solid '+m.icon+'"></i>'+esc(k)+'</span>'; }
function sfPerson(email,removable){ const n=nameOf(email); return '<span class="sf-person">'+avatar(n)+esc(n)+(removable?'<button type="button" class="rm" title="Remove" onclick="sfPplRemove(\''+esc(email)+'\')"><i class="fa-solid fa-xmark"></i></button>':'')+'</span>'; }
function sfPeople(list){ return '<span class="sf-circles">'+(list||[]).map(function(e){ return avatar(nameOf(e)); }).join('')+'</span>'; }
function sfStars(n){ let h='<span class="sf-stars" title="'+n+' / 10">'; for(let i=1;i<=10;i++) h+='<i class="fa-solid fa-star'+(i<=n?'':' off')+'"></i>'; return h+'</span>'; }
function sfDate(t){ try{ return new Date(t).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}); }catch(e){ return ''; } }
// The list shows only the first line of the description; the whole text is on the item itself.
function sfFirstLine(t){ return String(t||'').split(/\n/).map(function(s){ return s.trim(); }).filter(Boolean)[0]||''; }
function sfAvg(rows){ return rows.length?(rows.reduce(function(s,r){ return s+r.rating; },0)/rows.length):0; }
function sfEmpty(icon,title,sub){ return '<div class="card"><div class="empty"><i class="fa-solid '+icon+'"></i><div>'+esc(title)+'</div>'+(sub?'<div style="font-size:12.5px;margin-top:4px">'+esc(sub)+'</div>':'')+'</div></div>'; }

async function sfLoadItems(){
  const{data,error}=await sb.schema('feedback').from('system_items').select('*').order('created_at',{ascending:false});
  if(error) throw error;
  SF_ITEMS=data||[]; return SF_ITEMS;
}

/* ---- Systems: every item, with its ratings summary ---- */
async function sfManage(){
  const b=$('fhBody'); if(!b) return;
  loader(b);
  let items, resp=[];
  try{
    await getPeople();
    items=await sfLoadItems();
    if(items.length){ const r=await sb.schema('feedback').from('system_responses').select('item_id,rating').in('item_id',items.map(function(i){ return i.id; })); if(r.error) throw r.error; resp=r.data||[]; }
  }catch(e){ b.innerHTML=sfEmpty('fa-triangle-exclamation','System Feedbacks could not load',e.message||String(e)); return; }
  const by={}; resp.forEach(function(r){ (by[r.item_id]=by[r.item_id]||[]).push(r); });
  const shown=items.filter(function(i){ return SF_FILTER==='All'||i.kind===SF_FILTER; });
  b.innerHTML='<div class="sf-bar"><div><h2>System Feedbacks</h2><p>New features and bug fixes, rated by Sales and Pre Sales. Only the Systems department sees the ratings.</p></div>'
    +'<button class="btn btn-primary" onclick="sfOpenNew()"><i class="fa-solid fa-plus"></i> New System Feedback</button></div>'
    +'<div style="margin-bottom:12px"><div class="sf-filter">'+['All'].concat(SF_KINDS).map(function(k){ return '<button class="'+(k===SF_FILTER?'on':'')+'" onclick="sfSetFilter(\''+k+'\')">'+(k==='All'?'All':k==='New Feature'?'New Features':'Bugs Fixed')+'</button>'; }).join('')+'</div></div>'
    +(!shown.length?sfEmpty('fa-comment-dots',items.length?'Nothing of this type yet':'No System Feedbacks yet',items.length?'':'Use New System Feedback to post a new feature or a bug fix for Sales and Pre Sales to rate.')
    :'<div class="sf-list">'+shown.map(function(i){ const rs=by[i.id]||[], avg=sfAvg(rs);
      return '<div class="sf-item" onclick="navTo(\'feedback_hub/sys/'+i.id+'\')">'
        +'<div class="sf-top">'+sfKindTag(i.kind)+(i.is_active?'':'<span class="sf-closed">Closed</span>')+'<span class="sf-date">'+esc(sfDate(i.created_at))+' · by '+esc(nameOf(i.created_by))+'</span></div>'
        +'<div class="sf-title">'+esc(i.title)+'</div><div class="sf-sumline">'+esc(sfFirstLine(i.description))+'</div>'
        +'<div class="sf-foot"><div class="sf-by"><span class="sf-lbl">Executed by</span>'+sfPeople(i.executed_by)+'</div>'
        +'<div class="sf-rt">'+(rs.length?sfStars(Math.round(avg))+'<b>'+avg.toFixed(1)+'</b>/ 10 · '+rs.length+' rating'+(rs.length===1?'':'s'):'No ratings yet')+'</div></div></div>'; }).join('')+'</div>');
}
window.sfSetFilter=function(k){ SF_FILTER=k; sfManage(); };

/* ---- the New / Edit popup ---- */
window.sfOpenNew=function(item){
  SF_EDIT=item?{id:item.id,kind:item.kind,title:item.title,description:item.description,people:(item.executed_by||[]).slice()}
               :{id:null,kind:'New Feature',title:'',description:'',people:[fhMe()]};
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-comment-medical"></i> '+(item?'Edit System Feedback':'New System Feedback')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body sf-form">'
    +'<div class="row"><label class="l">Feedback for</label><div class="sf-seg" id="sfKind">'+SF_KINDS.map(function(k){ return '<button type="button" data-k="'+k+'" class="'+(k===SF_EDIT.kind?'on':'')+'" onclick="sfSetKind(this)"><i class="fa-solid '+SF_KIND_META[k].icon+'"></i>'+k+'</button>'; }).join('')+'</div></div>'
    +'<div class="row" id="sfR-title"><label class="l" for="sfTitle">Name <span class="req">*</span></label><input type="text" id="sfTitle" maxlength="140" placeholder="e.g. Digital Booking Form for Dream Ananta" value="'+esc(SF_EDIT.title)+'"><div class="err">Please give the feedback a name</div></div>'
    +'<div class="row" id="sfR-desc"><label class="l" for="sfDesc">Description <span class="req">*</span></label><textarea id="sfDesc" maxlength="3000" placeholder="What was built or fixed, and where to find it">'+esc(SF_EDIT.description)+'</textarea><div class="err">Please write a description</div></div>'
    +'<div class="row" id="sfR-ppl" style="margin-bottom:4px"><label class="l">Executed by <span class="req">*</span></label><div class="sf-ppl" id="sfPpl"></div><div class="err">Add at least one person</div></div>'
    +'</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="sfSaveBtn" onclick="sfSave()">'+(item?'Save changes':'Create')+'</button></div>');
  sfPplRender();
};
window.sfSetKind=function(btn){ SF_EDIT.kind=btn.dataset.k; document.querySelectorAll('#sfKind button').forEach(function(x){ x.classList.toggle('on',x===btn); }); };
function sfPplRender(q){
  const box=$('sfPpl'); if(!box) return;
  box.innerHTML=SF_EDIT.people.map(function(e){ return sfPerson(e,true); }).join('')
    +'<input type="text" id="sfPplQ" placeholder="'+(SF_EDIT.people.length?'Add another person':'Search a name')+'" autocomplete="off" oninput="sfPplSearch(this.value)" onfocus="sfPplSearch(this.value)" onkeydown="sfPplKey(event)">';
  if(q!=null){ const i=$('sfPplQ'); i.value=q; i.focus(); sfPplSearch(q); }
}
function sfPplMatches(q){
  q=String(q||'').trim().toLowerCase();
  return (PEOPLE||[]).filter(function(p){ return p.email&&SF_EDIT.people.indexOf(p.email.toLowerCase())===-1&&(!q||(p.name||'').toLowerCase().indexOf(q)!==-1||p.email.toLowerCase().indexOf(q)!==-1); })
    .sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); }).slice(0,30);
}
window.sfPplSearch=function(q){
  const box=$('sfR-ppl'); let dd=box.querySelector('.sf-dd'); if(!dd){ dd=document.createElement('div'); dd.className='sf-dd'; box.insertBefore(dd,box.querySelector('.err')); }
  const m=sfPplMatches(q);
  dd.innerHTML=m.length?m.map(function(p,i){ return '<button type="button" class="'+(i===0?'hi':'')+'" onmousedown="event.preventDefault();sfPplAdd(\''+esc(p.email.toLowerCase())+'\')">'+avatar(p.name)+esc(p.name)+'<span class="d">'+esc((p.depts||[]).join(', '))+'</span></button>'; }).join(''):'<div class="none">No one found</div>';
};
window.sfPplKey=function(ev){
  if(ev.key==='Enter'){ ev.preventDefault(); const m=sfPplMatches(ev.target.value); if(m[0]) sfPplAdd(m[0].email.toLowerCase()); }
  else if(ev.key==='Backspace'&&!ev.target.value&&SF_EDIT.people.length){ SF_EDIT.people.pop(); sfPplRender(''); }
  else if(ev.key==='Escape'){ const dd=$('sfR-ppl').querySelector('.sf-dd'); if(dd){ dd.remove(); ev.stopPropagation(); } }
};
window.sfPplAdd=function(email){ if(SF_EDIT.people.indexOf(email)===-1) SF_EDIT.people.push(email); const r=$('sfR-ppl'); r.classList.remove('bad'); const dd=r.querySelector('.sf-dd'); if(dd) dd.remove(); sfPplRender(); $('sfPplQ').focus(); };
window.sfPplRemove=function(email){ SF_EDIT.people=SF_EDIT.people.filter(function(e){ return e!==email; }); sfPplRender(); };
document.addEventListener('click',function(ev){ const box=$('sfR-ppl'); if(box&&!box.contains(ev.target)){ const dd=box.querySelector('.sf-dd'); if(dd) dd.remove(); } });

window.sfSave=async function(){
  const title=$('sfTitle').value.trim(), description=$('sfDesc').value.trim();
  $('sfR-title').classList.toggle('bad',!title); $('sfR-desc').classList.toggle('bad',!description); $('sfR-ppl').classList.toggle('bad',!SF_EDIT.people.length);
  if(!title||!description||!SF_EDIT.people.length) return;
  const btn=$('sfSaveBtn'); btn.disabled=true;
  const row={kind:SF_EDIT.kind,title:title,description:description,executed_by:SF_EDIT.people};
  const q=SF_EDIT.id?sb.schema('feedback').from('system_items').update(Object.assign({updated_at:new Date().toISOString()},row)).eq('id',SF_EDIT.id)
                    :sb.schema('feedback').from('system_items').insert(Object.assign({created_by:fhMe()},row));
  const{error}=await q;
  if(error){ btn.disabled=false; toast('Could not save: '+error.message,'err'); return; }
  const wasEdit=!!SF_EDIT.id, id=SF_EDIT.id; closeModal(); toast(wasEdit?'Saved':'System Feedback created - Sales and Pre Sales can rate it now','ok');
  if(wasEdit) navTo('feedback_hub/sys/'+id); else sfManage();
};

/* ---- Systems: one item and every rating it got ---- */
async function sfItemPage(v,id){
  v.innerHTML=FH_CSS+SF_CSS+'<div class="loader"><div class="spin"></div></div>';
  let item, rows;
  try{
    await getPeople();
    const a=await sb.schema('feedback').from('system_items').select('*').eq('id',id).maybeSingle(); if(a.error) throw a.error; item=a.data;
    if(!item){ v.innerHTML=FH_CSS+SF_CSS+sfEmpty('fa-circle-question','This System Feedback no longer exists'); return; }
    const r=await sb.schema('feedback').from('system_responses').select('*').eq('item_id',id).order('submitted_at',{ascending:false}); if(r.error) throw r.error; rows=r.data||[];
  }catch(e){ v.innerHTML=FH_CSS+SF_CSS+sfEmpty('fa-triangle-exclamation','Could not load',e.message||String(e)); return; }
  setCrumb(['Feedback','Feedback Hub','System Feedbacks']);
  const sysTab=fhCanQrForms()?2:0; // System Feedbacks' place among this person's tabs
  SF_EDIT=null; window.__sfItem=item;
  const avg=sfAvg(rows), remarks=rows.filter(function(r){ return (r.remarks||'').trim(); }).length;
  v.innerHTML=FH_CSS+SF_CSS+'<div class="fh-page-head"><button class="fh-page-back" title="Back" onclick="goBack(\'feedback_hub/'+sysTab+'\')"><i class="fa-solid fa-arrow-left"></i></button>'
    +'<div style="flex:1;min-width:0"><div class="sf-top" style="margin:0 0 4px">'+sfKindTag(item.kind)+(item.is_active?'':'<span class="sf-closed">Closed</span>')+'<span class="sf-date">'+esc(sfDate(item.created_at))+' · by '+esc(nameOf(item.created_by))+'</span></div>'
    +'<h1 style="font-size:19px;margin:0">'+esc(item.title)+'</h1></div>'
    +'<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn" onclick="sfOpenNew(window.__sfItem)"><i class="fa-solid fa-pen"></i> Edit</button>'
    +'<button class="btn" onclick="sfToggle('+item.id+','+(!item.is_active)+')"><i class="fa-solid '+(item.is_active?'fa-lock':'fa-lock-open')+'"></i> '+(item.is_active?'Close':'Reopen')+'</button>'
    +'<button class="btn fh-danger" onclick="sfDelete('+item.id+')"><i class="fa-solid fa-trash"></i> Delete</button></div></div>'
    +'<div class="sf-card" style="margin-top:14px"><div class="sf-main"><div class="sf-lbl" style="margin-bottom:4px">Description</div><div class="sf-desc">'+esc(item.description)+'</div>'
    +'<div class="sf-by"><span class="sf-lbl">Executed by</span>'+sfPeople(item.executed_by)+'</div></div></div>'
    +'<div class="sf-sum"><div><b>'+(rows.length?avg.toFixed(1)+' <small style="font-size:12px;color:var(--slate);font-weight:500">/ 10</small>':'—')+'</b><span>Average rating</span></div><div><b>'+rows.length+'</b><span>Ratings</span></div><div><b>'+remarks+'</b><span>Remarks</span></div></div>'
    +(!rows.length?sfEmpty('fa-inbox','No ratings yet',item.is_active?'Sales and Pre Sales see this under Give Feedback.':'This feedback is closed, so no new ratings can come in.')
    :'<table class="sf-tbl"><thead><tr><th>Person</th><th>Rating</th><th>Remarks</th><th class="hide-m">Date</th></tr></thead><tbody>'
      +rows.map(function(r){ const n=nameOf(r.rater_email), p=(PEOPLE||[]).find(function(x){ return x.email&&x.email.toLowerCase()===r.rater_email; });
        return '<tr><td><span style="display:inline-flex;align-items:center;gap:8px">'+avatar(n)+'<span><b style="font-weight:600">'+esc(n)+'</b><br><span style="font-size:11.5px;color:var(--slate)">'+esc(((p&&p.depts)||[]).filter(function(d){ return d==='Sales'||d==='Pre Sales'; }).join(', '))+'</span></span></span></td>'
          +'<td style="white-space:nowrap">'+sfStars(r.rating)+' <b style="margin-left:4px">'+r.rating+'</b></td><td style="white-space:pre-wrap">'+(esc(r.remarks||'')||'<span style="color:var(--slate-2)">—</span>')+'</td><td class="hide-m" style="white-space:nowrap;color:var(--slate)">'+esc(sfDate(r.updated_at||r.submitted_at))+'</td></tr>'; }).join('')
      +'</tbody></table>');
}
window.sfToggle=async function(id,on){
  const{error}=await sb.schema('feedback').from('system_items').update({is_active:on,updated_at:new Date().toISOString()}).eq('id',id);
  if(error){ toast('Could not update: '+error.message,'err'); return; }
  toast(on?'Reopened - it can be rated again':'Closed - no new ratings will come in','ok'); navTo('feedback_hub/sys/'+id);
};
window.sfDelete=async function(id){
  if(!await confirmDialog('Its ratings and remarks are deleted with it. This cannot be undone.',{title:'Delete this System Feedback?',okLabel:'Delete'})) return;
  const{error}=await sb.schema('feedback').from('system_items').delete().eq('id',id);
  if(error){ toast('Could not delete: '+error.message,'err'); return; }
  toast('Deleted','ok'); history.back();
};

/* ---- Sales / Pre Sales: open items to rate, and their own ratings ---- */
async function sfGive(){
  const b=$('fhBody'); if(!b) return;
  loader(b);
  let items, mine=[];
  try{
    await getPeople();
    items=(await sfLoadItems()).filter(function(i){ return i.is_active; });
    // Only this person's own rows come back - the database returns nobody else's to a rater.
    if(items.length){ const r=await sb.schema('feedback').from('system_responses').select('*').eq('rater_email',fhMe()).in('item_id',items.map(function(i){ return i.id; })); if(r.error) throw r.error; mine=r.data||[]; }
  }catch(e){ b.innerHTML=sfEmpty('fa-triangle-exclamation','Could not load',e.message||String(e)); return; }
  const my={}; mine.forEach(function(r){ my[r.item_id]=r; });
  const todo=items.filter(function(i){ return !my[i.id]; }), done=items.filter(function(i){ return my[i.id]; });
  const card=function(i){ const r=my[i.id];
    return '<div class="sf-item" onclick="sfOpenRate('+i.id+')">'
      +'<div class="sf-top">'+sfKindTag(i.kind)+'<span class="sf-date">'+esc(sfDate(i.created_at))+'</span></div>'
      +'<div class="sf-title">'+esc(i.title)+'</div><div class="sf-sumline">'+esc(sfFirstLine(i.description))+'</div>'
      +'<div class="sf-foot"><div class="sf-by"><span class="sf-lbl">Executed by</span>'+sfPeople(i.executed_by)+'</div>'
      +(r?'<div class="sf-rt">Your rating '+sfStars(r.rating)+'<b>'+r.rating+'</b>/ 10</div>'
         :'<button class="btn btn-primary" onclick="event.stopPropagation();sfOpenRate('+i.id+')"><i class="fa-solid fa-star"></i> Give feedback</button>')+'</div></div>'; };
  window.__sfGive={items:items,my:my};
  b.innerHTML='<div class="sf-bar"><div><h2>Give Feedback</h2><p>New features and bug fixes from the Systems team. Rate each one from 1 to 10. Only the Systems team sees what you write.</p></div></div>'
    +(!items.length?sfEmpty('fa-circle-check','Nothing to rate right now','New features and bug fixes will appear here.')
    :(todo.length?'<div class="sf-lbl" style="margin:0 0 8px">Waiting for your feedback · '+todo.length+'</div><div class="sf-list" style="margin-bottom:20px">'+todo.map(card).join('')+'</div>':'')
     +(done.length?'<div class="sf-lbl" style="margin:0 0 8px">Already given · '+done.length+'</div><div class="sf-list">'+done.map(card).join('')+'</div>':''));
}
const SF_RATE_WORDS=['','Very poor','Poor','Below average','Fair','Average','Decent','Good','Very good','Excellent','Outstanding'];
// Give Feedback's place among this person's tabs (Design, Records, System Feedbacks come first when they have them).
function sfGiveTab(){ return (fhCanQrForms()?2:0)+(fhIsSystems()?1:0); }
window.sfOpenRate=function(id){ navTo('feedback_hub/give/'+id); };
/* ---- the rating page: one item, rated on a page of its own (not a popup) ---- */
async function sfRatePage(v,id){
  v.innerHTML=FH_CSS+SF_CSS+'<div class="loader"><div class="spin"></div></div>';
  let i, r;
  try{
    await getPeople();
    const a=await sb.schema('feedback').from('system_items').select('*').eq('id',id).maybeSingle(); if(a.error) throw a.error; i=a.data;
    const m=await sb.schema('feedback').from('system_responses').select('*').eq('item_id',id).eq('rater_email',fhMe()).maybeSingle(); if(m.error) throw m.error; r=m.data;
  }catch(e){ v.innerHTML=FH_CSS+SF_CSS+sfEmpty('fa-triangle-exclamation','Could not load',e.message||String(e)); return; }
  if(!i||!i.is_active){ v.innerHTML=FH_CSS+SF_CSS+sfEmpty('fa-lock','This feedback is no longer open','The Systems team has closed it.'); return; }
  setCrumb(['Feedback','Feedback Hub','Give Feedback']);
  SF_RATE={id:id,rating:r?r.rating:0,had:r||null};
  v.innerHTML=FH_CSS+SF_CSS+'<div class="sf-page">'
    +'<div class="fh-page-head"><button class="fh-page-back" title="Back" onclick="goBack(\'feedback_hub/'+sfGiveTab()+'\')"><i class="fa-solid fa-arrow-left"></i></button>'
    +'<div style="flex:1;min-width:0"><div class="sf-top" style="margin:0 0 4px">'+sfKindTag(i.kind)+'<span class="sf-date">'+esc(sfDate(i.created_at))+'</span></div>'
    +'<h1 style="font-size:19px;margin:0">'+esc(i.title)+'</h1></div></div>'
    +'<div class="sf-form">'
    +'<div class="sf-view" style="margin-top:14px;background:#fff"><div class="sf-lbl">Description</div><div class="sf-desc" style="margin-top:4px">'+esc(i.description)+'</div>'
    +'<div class="sf-lbl" style="margin-top:14px">Executed by</div><div class="sf-by" style="margin-top:6px">'+sfPeople(i.executed_by)+'</div></div>'
    // Feedback is given once: after submitting, the page only shows it back.
    +(r?'<div class="sf-view" style="background:#fff"><div class="sf-lbl">Your rating</div><div style="margin-top:6px;display:flex;align-items:center;gap:8px">'+sfStars(r.rating).replace('font-size:12px','')+'<b style="font-size:15px">'+r.rating+'</b><span style="color:var(--slate);font-size:12.5px">/ 10 · '+esc(SF_RATE_WORDS[r.rating])+'</span></div>'
      +'<div class="sf-lbl" style="margin-top:14px">Remarks</div><div class="sf-desc" style="margin-top:4px">'+(esc(r.remarks||'')||'<span style="color:var(--slate-2)">—</span>')+'</div>'
      +'<div style="margin-top:14px;font-size:12px;color:var(--slate)"><i class="fa-solid fa-lock" style="margin-right:6px"></i>Submitted on '+esc(sfDate(r.submitted_at))+'. Feedback cannot be changed once submitted.</div></div>'
      +'<div style="display:flex;justify-content:flex-end"><button class="btn" onclick="goBack(\'feedback_hub/'+sfGiveTab()+'\')"><i class="fa-solid fa-arrow-left"></i> Back</button></div></div></div>'
    :'<div class="sf-view" style="background:#fff">'
    +'<div class="row" id="sfR-rate"><label class="l">Rating <span class="req">*</span></label><div class="sf-rate" id="sfRate" onmouseleave="sfRatePaint(SF_RATE.rating)">'
      +[1,2,3,4,5,6,7,8,9,10].map(function(n){ return '<button type="button" title="'+n+' / 10" onmouseenter="sfRatePaint('+n+')" onclick="sfRateSet('+n+')"><i class="fa-solid fa-star"></i></button>'; }).join('')
    +'</div><div class="sf-rate-val" id="sfRateVal"></div><div class="err">Please choose a rating from 1 to 10</div></div>'
    +'<div class="row" style="margin-bottom:0"><label class="l" for="sfRemarks">Remarks</label><textarea id="sfRemarks" maxlength="2000" placeholder="What works well, what could be better">'+esc(r?r.remarks||'':'')+'</textarea></div></div>'
    +'<div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:12px;color:var(--slate);margin-right:auto">Once submitted, your feedback cannot be changed.</span><button class="btn" onclick="goBack(\'feedback_hub/'+sfGiveTab()+'\')">Cancel</button><button class="btn btn-primary" id="sfRateBtn" onclick="sfRateSave()">Submit feedback</button></div>'
    +'</div></div>');
  if(!r) sfRatePaint(SF_RATE.rating);
}
window.sfRatePaint=function(n){
  document.querySelectorAll('#sfRate button').forEach(function(b,i){ b.classList.toggle('on',i<n); });
  const v=$('sfRateVal'); if(v) v.textContent=n?n+' / 10 · '+SF_RATE_WORDS[n]:'Tap a star';
};
window.sfRateSet=function(n){ SF_RATE.rating=n; $('sfR-rate').classList.remove('bad'); sfRatePaint(n); };
window.sfRateSave=async function(){
  if(!SF_RATE.rating){ $('sfR-rate').classList.add('bad'); return; }
  const btn=$('sfRateBtn'); btn.disabled=true;
  const remarks=$('sfRemarks').value.trim()||null;
  const{error}=await sb.schema('feedback').from('system_responses').insert({item_id:SF_RATE.id,rater_email:fhMe(),rating:SF_RATE.rating,remarks:remarks});
  if(error){ btn.disabled=false; toast(error.code==='23505'?'You have already given feedback on this.':'Could not submit: '+error.message,'err'); return; }
  toast('Thank you - your feedback was recorded','ok'); navTo('feedback_hub/'+sfGiveTab());
};
