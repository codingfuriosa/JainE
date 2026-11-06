/* ============================ SYSTEM FEEDBACKS (Feedback Hub) ============================
   The Systems department posts what it has built or fixed - a New Feature or a Bug Fixed - with a
   module, a name, a description and the people who executed it. Sales and Pre Sales open it, give 1
   to 10 stars and a remark. Not QR-based: open, fill, submit, and it is recorded against the signed-in
   person.

   BY MODULE (5 Nov 2026, Ayush). Every feedback belongs to a Module (feedback.system_modules), picked
   from a dropdown that can also add a new one. Built to cut clicks on both sides:
     - Systems post several at once, like the Reimbursement form: "Add feedback in same module" grows
       the module you are on, "Add another module" starts a new one. One Create saves them all.
       Kind and Executed By are carried over to each new feedback, as they are nearly always the same.
     - Both sides see the feedbacks grouped by module, with a search bar.
     - A rater opens one feedback; if the module has more waiting, "Give the Next Feedback" adds the
       next one below it on the same page. Optional - but once added it must be rated, or removed.
       A feedback already given, or already on the page, is never offered again.
     - Given feedbacks go to the Archive (for Systems: archived items, which take no new ratings).

   Who sees what is decided by the database (feedback.is_systems / feedback.is_system_rater, see
   20261103200000_feedback_system_feedbacks.sql): every Systems person reads every item and every
   rating; a rater gets back only their own rating. The tabs (fhIsSystems / fhIsRater in 06-nav.js)
   only mirror that. */
const SF_KINDS=['New Feature','Bug Fixed'];
const SF_KIND_META={'New Feature':{icon:'fa-wand-magic-sparkles',cls:'sf-k-new'},'Bug Fixed':{icon:'fa-bug-slash',cls:'sf-k-bug'}};
let SF_ITEMS=null, SF_MODS=[], SF_FILTER='All', SF_VIEW='open', SF_Q='', SF_FORM=null, SF_RATE=null, SF_DATA=null;

const SF_CSS=`<style id="sfCss">
.sf-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.sf-bar h2{font-size:15px;font-weight:700;margin:0}
.sf-bar p{font-size:12.5px;color:var(--slate);margin:2px 0 0}
.sf-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px}
/* tabs on the left, one long search bar taking the rest of the row on the right */
.sf-search{position:relative;flex:1;min-width:240px;margin-left:auto}
.sf-search i{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--slate);font-size:13px}
.sf-search input{width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 30px 8px 32px;font:inherit;font-size:13px;background:#fff}
.sf-search input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(29,78,216,.12)}
.sf-search .clr{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:none;background:none;color:var(--slate);cursor:pointer;padding:4px 6px;display:none}
.sf-search.has .clr{display:block}
.sf-filter{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff}
.sf-filter button{border:none;background:none;padding:7px 13px;font:inherit;font-size:12.5px;font-weight:600;color:var(--slate);cursor:pointer;border-right:1px solid var(--line);display:inline-flex;align-items:center;gap:6px}
.sf-filter button:last-child{border-right:none}
.sf-filter button.on{background:#f1f5f9;color:var(--ink)}
.sf-filter .n{font-size:11px;font-weight:700;background:#e2e8f0;color:#334155;border-radius:999px;padding:0 7px;line-height:17px}
.sf-filter button.on .n{background:var(--brand);color:#fff}
.sf-list{display:flex;flex-direction:column;gap:10px}
/* module sections */
.sf-mod{margin-bottom:22px}
.sf-mod-hd{display:flex;align-items:center;gap:10px;margin:0 0 10px;padding:0 2px}
.sf-mod-hd .ic{width:28px;height:28px;border-radius:8px;background:#eef2ff;color:#3730a3;display:inline-flex;align-items:center;justify-content:center;font-size:13px;flex:none}
.sf-mod-hd b{font-size:14px;font-weight:700}
.sf-mod-hd .meta{font-size:12px;color:var(--slate)}
.sf-mod-hd .rt{margin-left:auto;font-size:12.5px;color:var(--slate);white-space:nowrap}
.sf-mod-hd .rt b{font-size:14px;color:var(--ink)}
.sf-modtag{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:2px 8px;border-radius:5px;background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe}
.sf-card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px;display:flex;gap:16px;align-items:flex-start}
.sf-main{flex:1;min-width:0}
.sf-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.sf-kind{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:2px 8px;border-radius:5px;border:1px solid}
.sf-k-new{color:#1e40af;background:#eff4ff;border-color:#c7d7fe}
.sf-k-bug{color:#166534;background:#f0fdf4;border-color:#bbf7d0}
.sf-closed{font-size:11px;font-weight:600;color:var(--slate);border:1px solid var(--line);border-radius:5px;padding:2px 8px}
.sf-date{font-size:11.5px;color:var(--slate)}
.sf-title{font-size:14px;font-weight:700;line-height:1.35}
.sf-desc{font-size:12.5px;color:#334155;line-height:1.5;margin-top:4px;white-space:pre-wrap}
.sf-by{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;font-size:11.5px;color:var(--slate)}
.sf-lbl{font-size:10.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--slate)}
.sf-person{display:inline-flex;align-items:center;gap:6px;padding:2px 9px 2px 2px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:12px;color:var(--ink);font-weight:500}
.sf-person .avatar-sm{width:22px;height:22px;min-width:22px;font-size:9.5px}
.sf-circles{display:inline-flex;flex-wrap:wrap;gap:6px;align-items:center}
.sf-circles .avatar-sm{width:30px;height:30px;min-width:30px;font-size:11px;cursor:default;box-shadow:0 0 0 2px #fff,0 0 0 3px #e5e7eb}
.sf-person .rm{border:none;background:none;color:var(--slate);cursor:pointer;padding:0 0 0 2px;font-size:12px}
.sf-person .rm:hover{color:var(--err)}
.sf-stars{display:inline-flex;gap:2px;color:#f59e0b;font-size:12px}.sf-stars .off{color:#e2e8f0}
/* the New / Edit popup: one width, however much is in it */
.modal:has(.sf-form){width:680px;max-width:calc(100vw - 32px)}
.sf-form .sf-ppl{min-width:0}.sf-form .sf-person{max-width:100%}
.sf-form label.l{display:block;font-size:12.5px;font-weight:600;margin:0 0 6px;color:var(--ink)}
.sf-form label.l .req{color:var(--err)}
.sf-form .row{margin-bottom:14px}
.sf-form input[type=text],.sf-form textarea,.sf-form select{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font:inherit;font-size:13.5px;background:#fff}
.sf-form textarea{min-height:84px;resize:vertical}
.sf-form input:focus,.sf-form textarea:focus,.sf-form select:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(29,78,216,.12)}
.sf-form .bad input,.sf-form .bad textarea,.sf-form .bad select,.sf-form .bad .sf-ppl{border-color:var(--err)}
.sf-form .err{font-size:11.5px;color:var(--err);margin-top:5px;display:none}.sf-form .bad>.err,.sf-form .bad .err{display:block}
.sf-seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.sf-seg button{border:none;background:#fff;padding:7px 12px;font:inherit;font-size:12.5px;font-weight:600;color:var(--slate);cursor:pointer;display:inline-flex;align-items:center;gap:7px;border-right:1px solid var(--line)}
.sf-seg button:last-child{border-right:none}.sf-seg button.on{background:#f1f5f9;color:var(--ink)}
.sf-ppl{border:1px solid var(--line);border-radius:8px;padding:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;position:relative;background:#fff}
.sf-ppl input{border:none!important;box-shadow:none!important;flex:1;min-width:140px;padding:5px 6px!important}
.sf-dd{margin-top:4px;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 10px 30px rgba(15,23,42,.12);max-height:220px;overflow:auto;z-index:20}
.sf-dd button{display:flex;align-items:center;gap:9px;width:100%;border:none;background:none;padding:8px 10px;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.sf-dd button:hover,.sf-dd button.hi{background:#f1f5f9}
.sf-dd .d{font-size:11px;color:var(--slate);margin-left:auto}
.sf-dd .none{padding:10px;font-size:12.5px;color:var(--slate)}
/* module groups and feedback blocks in the form (the Reimbursement pattern) */
.sf-grp{border:1px solid var(--line);border-radius:12px;background:#f8fafc;padding:14px;margin-bottom:12px}
.sf-grp-hd,.sf-blk-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.sf-grp-hd span{font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#3730a3}
.sf-blk{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-top:10px}
.sf-blk-hd span{font-size:12.5px;font-weight:700;color:var(--ink)}
.sf-x{border:none;background:none;color:var(--slate);cursor:pointer;padding:4px 7px;border-radius:6px;font-size:13px}
.sf-x:hover{color:var(--err);background:#fef2f2}
.sf-ghost{display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 12px;border:1px dashed #cbd5e1;border-radius:10px;color:var(--slate);font-size:13px;font-weight:600;cursor:pointer;margin-top:10px;background:transparent;width:100%;font-family:inherit;transition:.15s}
.sf-ghost:hover{border-color:var(--brand);color:var(--brand);background:#eef2ff}
.sf-ghost.big{padding:12px;background:#fff}
.sf-modrow{display:flex;gap:8px;align-items:center}
.sf-modrow select,.sf-modrow input{flex:1}
.sf-modrow .sf-x{flex:none}
.sf-two{display:grid;grid-template-columns:1fr;gap:0}
/* rating */
.sf-view{border:1px solid var(--line);border-radius:10px;padding:14px;background:#fafbfc;margin-bottom:18px}
.sf-rate{display:flex;gap:4px;flex-wrap:wrap}
.sf-rate button{border:none;background:none;padding:2px;cursor:pointer;font-size:24px;color:#e2e8f0;line-height:1}
.sf-rate button.on{color:#f59e0b}
.sf-rate-val{font-size:12.5px;color:var(--slate);margin-top:6px;min-height:18px}
.sf-rblk{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:12px}
.sf-rblk-hd{display:flex;align-items:flex-start;gap:10px;margin-bottom:10px}
.sf-rblk-hd .n{width:24px;height:24px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex:none;margin-top:1px}
.sf-rblk .sf-title{font-size:15px}
.sf-rblk .info{background:#fafbfc;border:1px solid #eef1f4;border-radius:8px;padding:10px 12px;margin:0 0 14px}
.sf-rblk .sf-form .row:last-child{margin-bottom:0}
/* THE RATING PAGE (6 Nov 2026, Ayush: on first sight it was a wall of text and what to DO did not stand
   out). Every feedback is its own card. Left: what it is, quietly. Right: the action - a tinted
   panel with big stars, amber until rated, green once rated. The remark box sits under the stars. The Submit bar stays in view and counts. */
.sf-lns{display:flex;flex-direction:column;gap:10px;margin-top:14px}
.sf-ln{background:#fff;border:1px solid var(--line);border-radius:12px;transition:border-color .15s}
.sf-ln.done{border-color:#86efac}
.sf-ln-row{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:24px;padding:14px 16px 14px 20px;align-items:center}
.sf-ln-row .meta{font-size:11px;font-weight:600;letter-spacing:.3px;color:#94a3b8;text-transform:uppercase;margin-bottom:3px}
.sf-ln-row .meta .new{color:#3b5bdb}.sf-ln-row .meta .bug{color:#2f9e44}
.sf-ln-row .ttl{font-size:15px;font-weight:700;color:var(--ink);line-height:1.35}
.sf-ln-row .dsc{font-size:13px;color:#64748b;line-height:1.5;margin-top:4px;white-space:pre-wrap}
.sf-ln-row .give{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 14px 11px;display:flex;flex-direction:column;gap:14px}
.sf-ln.done .give{background:#f0fdf4;border-color:#bbf7d0}
.sf-ln-row .stars{display:flex;align-items:center;gap:10px}
.sf-ln-row .sf-rate{gap:1px;flex-wrap:nowrap}
.sf-ln-row .sf-rate button{font-size:21px;padding:1px;color:#e7d9b0}
.sf-ln.done .sf-rate button:not(.on){color:#d1e7d6}
.sf-ln-row .sf-rate button.on{color:#f59e0b}
.sf-ln-row .sf-rate-val{font-size:12px;color:var(--slate);margin:0;min-height:0;white-space:nowrap}
.sf-ln-row .sf-rate-val b{color:var(--ink);font-size:13px}
.sf-ln-row .rm{display:block;width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit;font-size:13px;line-height:1.45;background:#fff;min-height:64px;resize:vertical}
.sf-submitbar{position:sticky;bottom:0;z-index:5;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;padding:10px 14px;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 -6px 18px rgba(15,23,42,.06)}
.sf-submitbar .prog{font-size:13px;color:var(--slate)}.sf-submitbar .prog b{color:var(--ink)}
.sf-submitbar .note{font-size:12px;color:var(--slate);margin-right:auto;margin-left:10px}
.sf-ln-row .rm:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(29,78,216,.12)}
@media(max-width:860px){.sf-ln-row{grid-template-columns:1fr;gap:12px;padding:14px 16px}}
.sf-left{font-size:12px;color:var(--slate);text-align:center;margin-top:6px}
/* item page */
.sf-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:14px 0}
.sf-sum div{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.sf-sum b{display:block;font-size:20px}.sf-sum span{font-size:11.5px;color:var(--slate)}
.sf-tbl{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.sf-tbl th{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--slate);text-align:left;padding:9px 12px;background:#f8fafc;border-bottom:1px solid var(--line)}
.sf-tbl td{padding:10px 12px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top}
.sf-tbl tr:last-child td{border-bottom:none}
/* list rows: top line / title + one-line summary / footer (people left, rating right) */
.sf-item{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 20px 0;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.sf-item:hover{border-color:#cbd5e1;box-shadow:0 2px 10px rgba(15,23,42,.05)}
.sf-item .sf-top{margin-bottom:8px;gap:10px}
.sf-item .sf-title{font-size:15px}
.sf-item .sf-sumline{font-size:13px;color:var(--slate);line-height:1.5;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sf-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:14px;padding:11px 0 13px;border-top:1px solid #eef1f4}
.sf-foot .sf-by{margin-top:0;gap:8px}
.sf-rt{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--slate);white-space:nowrap}
.sf-rt b{font-size:15px;color:var(--ink)}
.sf-mark{background:#fef08a;border-radius:2px;padding:0 1px}
/* a module is one card: name, New Feature / Bug Fixed counts, and (Systems) its feedbacks as rows inside */
.sf-mcard{background:#fff;border:1px solid var(--line);border-radius:12px;margin-bottom:10px;overflow:hidden}
.sf-mcard-hd{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:13px 16px}
.sf-mcard-hd .ic{width:32px;height:32px;border-radius:9px;background:#eef2ff;color:#3730a3;display:inline-flex;align-items:center;justify-content:center;font-size:14px;flex:none}
.sf-mcard-hd .nm b{font-size:15px;font-weight:700}
.sf-counts{display:inline-flex;gap:6px;flex-wrap:wrap}
.sf-mcard-rt{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--slate);white-space:nowrap}
.sf-mcard-rt b{font-size:14px;color:var(--ink)}
.sf-mcard-hd .btn{margin-left:auto}
.sf-mrows{border-top:1px solid #eef1f4}
.sf-mrow{display:flex;align-items:center;gap:12px;padding:10px 16px;border-top:1px solid #f1f4f7}
.sf-mrow:first-child{border-top:none}
.sf-mrow.click{cursor:pointer}.sf-mrow.click:hover{background:#f8fafc}
.sf-mrow .t{flex:1;min-width:0}
.sf-mrow .nm{font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sf-mrow .sub{font-size:12px;color:var(--slate);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.sf-mrow .ppl .avatar-sm{width:24px;height:24px;min-width:24px;font-size:9.5px}
.sf-mrow .rt{font-size:12.5px;color:var(--slate);white-space:nowrap;min-width:78px;text-align:right}
.sf-mrow .rt b{color:var(--ink)}
.sf-mrow .go{color:#cbd5e1;font-size:11px}
.sf-hits-lbl{font-size:10.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--slate);padding:9px 16px 0}
@media(max-width:640px){.sf-mrow .ppl,.sf-mrow .sub{display:none}.sf-mcard-rt{margin-left:0}}
@media(max-width:640px){.sf-card{flex-direction:column;gap:10px}.sf-sum{grid-template-columns:1fr 1fr 1fr}.sf-tbl .hide-m{display:none}.sf-mod-hd .rt{display:none}}
</style>`;

function sfKindTag(k){ const m=SF_KIND_META[k]||SF_KIND_META['New Feature']; return '<span class="sf-kind '+m.cls+'"><i class="fa-solid '+m.icon+'"></i>'+esc(k)+'</span>'; }
function sfModName(id){ const m=SF_MODS.find(function(x){ return x.id===id; }); return m?m.name:'No module'; }
function sfModTag(id){ return '<span class="sf-modtag"><i class="fa-solid fa-cube"></i>'+esc(sfModName(id))+'</span>'; }
function sfPerson(email,key){ const n=nameOf(email); return '<span class="sf-person">'+avatar(n)+esc(n)+(key!=null?'<button type="button" class="rm" title="Remove" onclick="sfPplRemove(\''+key+'\',\''+esc(email)+'\')"><i class="fa-solid fa-xmark"></i></button>':'')+'</span>'; }
function sfPeople(list){ return '<span class="sf-circles">'+(list||[]).map(function(e){ return avatar(nameOf(e)); }).join('')+'</span>'; }
function sfStars(n){ let h='<span class="sf-stars" title="'+n+' / 10">'; for(let i=1;i<=10;i++) h+='<i class="fa-solid fa-star'+(i<=n?'':' off')+'"></i>'; return h+'</span>'; }
function sfDate(t){ try{ return new Date(t).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}); }catch(e){ return ''; } }
// The list shows only the first line of the description; the whole text is on the item itself.
function sfFirstLine(t){ return String(t||'').split(/\n/).map(function(s){ return s.trim(); }).filter(Boolean)[0]||''; }
function sfAvg(rows){ return rows.length?(rows.reduce(function(s,r){ return s+r.rating; },0)/rows.length):0; }
function sfEmpty(icon,title,sub){ return '<div class="card"><div class="empty"><i class="fa-solid '+icon+'"></i><div>'+esc(title)+'</div>'+(sub?'<div style="font-size:12.5px;margin-top:4px">'+esc(sub)+'</div>':'')+'</div></div>'; }
// highlight what was searched for, in text that has already been escaped
function sfHi(text){ const t=esc(text); if(!SF_Q) return t; const q=esc(SF_Q).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); return t.replace(new RegExp('('+q+')','ig'),'<mark class="sf-mark">$1</mark>'); }
function sfMatches(i){
  if(!SF_Q) return true;
  const q=SF_Q.toLowerCase();
  return [i.title,i.description,sfModName(i.module_id),i.kind].concat((i.executed_by||[]).map(nameOf)).some(function(s){ return String(s||'').toLowerCase().indexOf(q)!==-1; });
}
// Items grouped by module, the module with the newest item first, items newest first inside it.
function sfByModule(items){
  const g={}, order=[];
  items.forEach(function(i){ const k=i.module_id||0; if(!g[k]){ g[k]=[]; order.push(k); } g[k].push(i); });
  return order.map(function(k){ return {id:k, name:sfModName(k), items:g[k]}; });
}
function sfModHead(m,meta,right){ return '<div class="sf-mod-hd"><span class="ic"><i class="fa-solid fa-cube"></i></span><b>'+sfHi(m.name)+'</b><span class="meta">'+meta+'</span>'+(right?'<span class="rt">'+right+'</span>':'')+'</div>'; }
function sfSearchBox(onInput){
  return '<div class="sf-search'+(SF_Q?' has':'')+'"><i class="fa-solid fa-magnifying-glass"></i><input type="text" id="sfQ" placeholder="Search feedbacks, modules or people" value="'+esc(SF_Q)+'" oninput="'+onInput+'(this.value)">'
    +'<button class="clr" title="Clear" onclick="'+onInput+'(\'\');document.getElementById(\'sfQ\').value=\'\'"><i class="fa-solid fa-xmark"></i></button></div>';
}
// Re-rendering on every keystroke would lose the caret; only the results area is redrawn.
function sfSetQ(v,render){ SF_Q=String(v||'').trim(); const s=document.querySelector('.sf-search'); if(s) s.classList.toggle('has',!!SF_Q); render(); }

async function sfLoadMods(){
  const{data,error}=await sb.schema('feedback').from('system_modules').select('id,name').order('name');
  if(error) throw error;
  SF_MODS=data||[]; return SF_MODS;
}
async function sfLoadItems(){
  const{data,error}=await sb.schema('feedback').from('system_items').select('*').order('created_at',{ascending:false});
  if(error) throw error;
  SF_ITEMS=data||[]; return SF_ITEMS;
}

/* ---- Systems: every item, by module, with its ratings ---- */
async function sfManage(){
  const b=$('fhBody'); if(!b) return;
  loader(b);
  let items, resp=[];
  try{
    await getPeople(); await sfLoadMods();
    items=await sfLoadItems();
    if(items.length){ const r=await sb.schema('feedback').from('system_responses').select('item_id,rating').in('item_id',items.map(function(i){ return i.id; })); if(r.error) throw r.error; resp=r.data||[]; }
  }catch(e){ b.innerHTML=sfEmpty('fa-triangle-exclamation','System Feedbacks could not load',e.message||String(e)); return; }
  const by={}; resp.forEach(function(r){ (by[r.item_id]=by[r.item_id]||[]).push(r); });
  SF_DATA={items:items,by:by};
  b.innerHTML='<div class="sf-bar"><div><h2>System Feedbacks</h2><p>New features and bug fixes by module, rated by Sales and Pre Sales. Only the Systems department sees the ratings.</p></div>'
    +'<button class="btn btn-primary" onclick="sfOpenNew()"><i class="fa-solid fa-plus"></i> New System Feedback</button></div>'
    +'<div class="sf-tools">'
    +'<div class="sf-filter" id="sfKindF">'+['All'].concat(SF_KINDS).map(function(k){ return '<button data-k="'+k+'" class="'+(k===SF_FILTER?'on':'')+'" onclick="sfSetFilter(\''+k+'\')">'+(k==='All'?'All':k==='New Feature'?'New Features':'Bugs Fixed')+'</button>'; }).join('')+'</div>'
    +sfSearchBox('sfManageQ')+'</div>'
    +'<div id="sfRes"></div>';
  sfManageList();
}
function sfManageList(){
  const host=$('sfRes'); if(!host||!SF_DATA) return;
  const items=SF_DATA.items, by=SF_DATA.by;
  const shown=items.filter(function(i){ return (SF_FILTER==='All'||i.kind===SF_FILTER)&&sfMatches(i); });   // makers: open and archived in one list (6 Nov 2026)
  if(!shown.length){
    host.innerHTML=SF_Q?sfEmpty('fa-magnifying-glass','Nothing matches "'+SF_Q+'"','Try a module, a name or a person.')
      :sfEmpty('fa-comment-dots',items.length?'Nothing of this type yet':'No System Feedbacks yet',items.length?'':'Use New System Feedback to post new features or bug fixes, module by module.');
    return;
  }
  // One quiet row per module, as raters see it (6 Nov 2026, Ayush: the feedbacks inside every card were
  // too noisy). Its feedbacks are on the module's own page; a search lists the matches inside the row.
  host.innerHTML=sfByModule(shown).map(function(m){
    const rs=[].concat.apply([],m.items.map(function(i){ return by[i.id]||[]; })), avg=sfAvg(rs);
    const hits=SF_Q?m.items.filter(sfMatches):[];
    return '<div class="sf-mcard"><div class="sf-mcard-hd">'+sfModTitle(m)+sfKindCounts(m.items)
        +'<span class="sf-mcard-rt">'+(rs.length?sfStars(Math.round(avg))+'<b>'+avg.toFixed(1)+'</b> / 10 · '+rs.length+' rating'+(rs.length===1?'':'s'):'No ratings yet')+'</span>'
        +'<button class="btn" style="margin-left:0" onclick="navTo(\'feedback_hub/sys/m'+m.id+'\')">View feedbacks <i class="fa-solid fa-arrow-right"></i></button></div>'
      +(hits.length?'<div class="sf-mrows"><div class="sf-hits-lbl">Matching feedbacks</div>'+hits.map(function(i){ return sfSysRow(i,by); }).join('')+'</div>':'')
      +'</div>'; }).join('');
}
function sfSysRow(i,by){
  const rs=by[i.id]||[], avg=sfAvg(rs);
  return '<div class="sf-mrow click" onclick="navTo(\'feedback_hub/sys/'+i.id+'\')">'+sfKindTag(i.kind)
    // an archived one is marked on its row rather than listed apart
    +'<div class="t"><div class="nm">'+sfHi(i.title)+(i.is_active?'':' <span class="sf-closed" style="margin-left:6px"><i class="fa-solid fa-box-archive"></i> Archived</span>')+'</div><div class="sub">'+sfHi(sfFirstLine(i.description))+'</div></div>'
    +'<span class="ppl">'+sfPeople(i.executed_by)+'</span>'
    +'<span class="rt">'+(rs.length?'<b>'+avg.toFixed(1)+'</b> / 10 · '+rs.length:'No ratings')+'</span>'
    +'<i class="fa-solid fa-chevron-right go"></i></div>';
}
/* ---- Systems: one module - its feedbacks, open first, then archived ---- */
async function sfModPage(v,modId){
  v.innerHTML=FH_CSS+SF_CSS+'<div class="loader"><div class="spin"></div></div>';
  let items, resp=[];
  try{
    await getPeople(); await sfLoadMods();
    const a=await sb.schema('feedback').from('system_items').select('*').eq('module_id',modId).order('created_at',{ascending:false}); if(a.error) throw a.error; items=a.data||[];
    if(items.length){ const r=await sb.schema('feedback').from('system_responses').select('item_id,rating').in('item_id',items.map(function(i){ return i.id; })); if(r.error) throw r.error; resp=r.data||[]; }
  }catch(e){ v.innerHTML=FH_CSS+SF_CSS+sfEmpty('fa-triangle-exclamation','Could not load',e.message||String(e)); return; }
  setCrumb(['Feedback','Feedback Hub','System Feedbacks']);
  const by={}; resp.forEach(function(r){ (by[r.item_id]=by[r.item_id]||[]).push(r); });
  const avg=sfAvg(resp), q=SF_Q; SF_Q='';
  const sect=function(label,list){ return list.length?'<div class="sf-mcard"><div class="sf-hits-lbl" style="padding:11px 16px 2px">'+label+' · '+list.length+'</div><div class="sf-mrows" style="border-top:none">'+list.map(function(i){ return sfSysRow(i,by); }).join('')+'</div></div>':''; };
  v.innerHTML=FH_CSS+SF_CSS+'<div class="fh-page-head"><button class="fh-page-back" title="Back" onclick="goBack(\'feedback_hub/'+(fhCanQrForms()?2:0)+'\')"><i class="fa-solid fa-arrow-left"></i></button>'
    +'<div style="flex:1;min-width:0"><div class="sf-top" style="margin:0 0 4px">'+sfKindCounts(items)+'</div><h1 style="font-size:19px;margin:0">'+esc(sfModName(modId))+'</h1></div>'
    +'<div class="sf-mcard-rt" style="margin:0">'+(resp.length?sfStars(Math.round(avg))+'<b>'+avg.toFixed(1)+'</b> / 10 · '+resp.length+' rating'+(resp.length===1?'':'s'):'No ratings yet')+'</div></div>'
    +'<div style="margin-top:14px">'+(items.length?sect('Feedbacks',items):sfEmpty('fa-comment-dots','No feedbacks in this module'))+'</div>';
  SF_Q=q;
}
// Module card title, and how many New Features / Bugs Fixed it holds
function sfModTitle(m){ return '<span class="ic"><i class="fa-solid fa-cube"></i></span><div class="nm"><b>'+sfHi(m.name)+'</b></div>'; }
function sfKindCounts(items){
  const nf=items.filter(function(i){ return i.kind==='New Feature'; }).length, bf=items.length-nf;
  return '<span class="sf-counts">'+(nf?'<span class="sf-kind sf-k-new"><i class="fa-solid fa-wand-magic-sparkles"></i>'+nf+' New Feature'+(nf===1?'':'s')+'</span>':'')
    +(bf?'<span class="sf-kind sf-k-bug"><i class="fa-solid fa-bug-slash"></i>'+bf+' Bug'+(bf===1?'':'s')+' Fixed</span>':'')+'</span>';
}
window.sfManageList=sfManageList;
window.sfManageQ=function(v){ sfSetQ(v,sfManageList); };
window.sfSetFilter=function(k){ SF_FILTER=k; document.querySelectorAll('#sfKindF button').forEach(function(b){ b.classList.toggle('on',b.dataset.k===k); }); sfManageList(); };
window.sfSetView=function(v,render){
  SF_VIEW=v;
  document.querySelectorAll('.sf-tools .sf-filter').forEach(function(f){ const bs=f.querySelectorAll('button'); if(bs.length===2&&/Archive/.test(bs[1].textContent)){ bs[0].classList.toggle('on',v==='open'); bs[1].classList.toggle('on',v==='archive'); } });
  render();
};

/* ---- New System Feedback: module groups, each holding one or more feedbacks ----
   SF_FORM = { editId, groups:[ { mod:<id>|'' , newName:<string>|null, items:[ {kind,title,desc,people} ] } ] }
   newName is null while the dropdown is shown, a string while "Add a new module" is being typed. */
function sfBlankItem(from){ return {kind:from?from.kind:'New Feature',title:'',desc:'',people:from?from.people.slice():[fhMe()]}; }
window.sfOpenNew=async function(item){
  try{ await getPeople(); await sfLoadMods(); }catch(e){ toast('Could not load: '+(e.message||e),'err'); return; }
  SF_FORM=item?{editId:item.id,groups:[{mod:item.module_id||'',newName:null,items:[{kind:item.kind,title:item.title,desc:item.description,people:(item.executed_by||[]).slice()}]}]}
               :{editId:null,groups:[{mod:'',newName:null,items:[sfBlankItem()]}]};
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-comment-medical"></i> '+(item?'Edit System Feedback':'New System Feedback')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body sf-form" id="sfFormBody"></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="sfSaveBtn" onclick="sfSave()"></button></div>');
  sfFormRender();
  if(!item){ const s=$('sfM-0'); if(s) s.focus(); }
};
// Copies what has been typed back into SF_FORM, so a re-render never loses it.
function sfFormSync(){
  if(!SF_FORM) return;
  SF_FORM.groups.forEach(function(g,gi){
    const s=$('sfM-'+gi), n=$('sfMN-'+gi);
    if(n) g.newName=n.value; else if(s) g.mod=s.value;
    g.items.forEach(function(it,ii){ const k=gi+'-'+ii, t=$('sfT-'+k), d=$('sfD-'+k); if(t) it.title=t.value; if(d) it.desc=d.value; });
  });
}
function sfFormRender(){
  const box=$('sfFormBody'); if(!box) return;
  const edit=!!SF_FORM.editId, many=SF_FORM.groups.length>1;
  // modules typed into other groups are offered here too, so a new module is only typed once
  const pending=[]; SF_FORM.groups.forEach(function(g){ const n=(g.newName||'').trim(); if(n&&!SF_MODS.some(function(m){ return m.name.toLowerCase()===n.toLowerCase(); })&&pending.indexOf(n)===-1) pending.push(n); });
  box.innerHTML=SF_FORM.groups.map(function(g,gi){
    const modRow=g.newName!=null
      ?'<div class="sf-modrow"><input type="text" id="sfMN-'+gi+'" maxlength="60" placeholder="Name of the new module, e.g. Post Sales" value="'+esc(g.newName)+'" oninput="this.closest(\'.row\').classList.remove(\'bad\')">'
        +'<button type="button" class="sf-x" title="Pick from the list instead" onclick="sfModList('+gi+')"><i class="fa-solid fa-list"></i></button></div>'
      :'<select id="sfM-'+gi+'" onchange="sfModPick('+gi+',this.value)"><option value="">Choose a module</option>'
        +SF_MODS.map(function(m){ return '<option value="'+m.id+'"'+(String(g.mod)===String(m.id)?' selected':'')+'>'+esc(m.name)+'</option>'; }).join('')
        +pending.map(function(n){ return '<option value="new:'+esc(n)+'"'+(g.mod==='new:'+n?' selected':'')+'>'+esc(n)+' (new)</option>'; }).join('')
        +'<option value="__new">+ Add a new module</option></select>';
    return '<div class="sf-grp">'
      +(edit?'':'<div class="sf-grp-hd"><span>Module '+(gi+1)+'</span>'+(many?'<button type="button" class="sf-x" title="Remove this module and its feedbacks" onclick="sfGrpRemove('+gi+')"><i class="fa-solid fa-xmark"></i></button>':'')+'</div>')
      +'<div class="row" id="sfR-m-'+gi+'" style="margin-bottom:0"><label class="l">Module <span class="req">*</span></label>'+modRow+'<div class="err">Choose a module, or add a new one</div></div>'
      +g.items.map(function(it,ii){ const k=gi+'-'+ii, rm=g.items.length>1;
        return '<div class="sf-blk">'
          +(edit?'':'<div class="sf-blk-hd"><span>Feedback '+(ii+1)+'</span>'+(rm?'<button type="button" class="sf-x" title="Remove this feedback" onclick="sfItemRemove('+gi+','+ii+')"><i class="fa-solid fa-xmark"></i></button>':'')+'</div>')
          +'<div class="row"><div class="sf-seg">'+SF_KINDS.map(function(kd){ return '<button type="button" class="'+(kd===it.kind?'on':'')+'" onclick="sfSetKind(\''+k+'\',\''+kd+'\',this)"><i class="fa-solid '+SF_KIND_META[kd].icon+'"></i>'+kd+'</button>'; }).join('')+'</div></div>'
          +'<div class="row" id="sfR-t-'+k+'"><label class="l" for="sfT-'+k+'">Name <span class="req">*</span></label><input type="text" id="sfT-'+k+'" maxlength="140" placeholder="e.g. Digital Booking Form for Dream Ananta" value="'+esc(it.title)+'" oninput="this.closest(\'.row\').classList.remove(\'bad\')"><div class="err">Please give the feedback a name</div></div>'
          +'<div class="row" id="sfR-d-'+k+'"><label class="l" for="sfD-'+k+'">Description <span class="req">*</span></label><textarea id="sfD-'+k+'" maxlength="3000" placeholder="What was built or fixed, and where to find it" oninput="this.closest(\'.row\').classList.remove(\'bad\')">'+esc(it.desc)+'</textarea><div class="err">Please write a description</div></div>'
          +'<div class="row" id="sfR-p-'+k+'" style="margin-bottom:0"><label class="l">Executed by <span class="req">*</span></label><div class="sf-ppl" id="sfPpl-'+k+'"></div><div class="err">Add at least one person</div></div>'
        +'</div>'; }).join('')
      +(edit?'':'<button type="button" class="sf-ghost" onclick="sfItemAdd('+gi+')"><i class="fa-solid fa-plus"></i> Add feedback in same module</button>')
    +'</div>';
  }).join('')+(edit?'':'<button type="button" class="sf-ghost big" onclick="sfGrpAdd()"><i class="fa-solid fa-cube"></i> Add another module</button>');
  SF_FORM.groups.forEach(function(g,gi){ g.items.forEach(function(it,ii){ sfPplRender(gi+'-'+ii); }); });
  const n=SF_FORM.groups.reduce(function(s,g){ return s+g.items.length; },0), btn=$('sfSaveBtn');
  if(btn) btn.textContent=edit?'Save changes':(n>1?'Create '+n+' feedbacks':'Create');
}
window.sfModPick=function(gi,v){
  sfFormSync();
  const g=SF_FORM.groups[gi]; $('sfR-m-'+gi).classList.remove('bad');
  if(v==='__new'){ g.mod=''; g.newName=''; sfFormRender(); const n=$('sfMN-'+gi); if(n) n.focus(); return; }
  g.mod=v;   // an existing id, or "new:<name>" typed in another module group
};
window.sfModList=function(gi){ sfFormSync(); const g=SF_FORM.groups[gi]; g.newName=null; g.mod=''; sfFormRender(); };
window.sfSetKind=function(k,kind,btn){ const p=k.split('-'); SF_FORM.groups[+p[0]].items[+p[1]].kind=kind; btn.parentNode.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on',x===btn); }); };
window.sfItemAdd=function(gi){
  sfFormSync();
  const g=SF_FORM.groups[gi]; g.items.push(sfBlankItem(g.items[g.items.length-1]));
  sfFormRender(); const t=$('sfT-'+gi+'-'+(g.items.length-1)); if(t){ t.focus(); t.scrollIntoView({block:'nearest',behavior:'smooth'}); }
};
window.sfItemRemove=function(gi,ii){ sfFormSync(); SF_FORM.groups[gi].items.splice(ii,1); sfFormRender(); };
window.sfGrpAdd=function(){
  sfFormSync();
  const last=SF_FORM.groups[SF_FORM.groups.length-1], li=last.items[last.items.length-1];
  SF_FORM.groups.push({mod:'',newName:null,items:[sfBlankItem(li)]});
  sfFormRender(); const s=$('sfM-'+(SF_FORM.groups.length-1)); if(s){ s.focus(); s.scrollIntoView({block:'nearest',behavior:'smooth'}); }
};
window.sfGrpRemove=function(gi){ sfFormSync(); SF_FORM.groups.splice(gi,1); sfFormRender(); };

/* Executed By: one people picker per feedback, keyed "group-item" */
function sfBlk(key){ const p=key.split('-'); return SF_FORM.groups[+p[0]].items[+p[1]]; }
function sfPplRender(key,q){
  const box=$('sfPpl-'+key); if(!box) return; const it=sfBlk(key);
  box.innerHTML=it.people.map(function(e){ return sfPerson(e,key); }).join('')
    +'<input type="text" id="sfPplQ-'+key+'" placeholder="'+(it.people.length?'Add another person':'Search a name')+'" autocomplete="off" oninput="sfPplSearch(\''+key+'\',this.value)" onfocus="sfPplSearch(\''+key+'\',this.value)" onkeydown="sfPplKey(event,\''+key+'\')">';
  if(q!=null){ const i=$('sfPplQ-'+key); i.value=q; i.focus(); sfPplSearch(key,q); }
}
function sfPplMatches(key,q){
  q=String(q||'').trim().toLowerCase(); const it=sfBlk(key);
  // Executed By is always the Systems team - nobody from another department is offered
  return (PEOPLE||[]).filter(function(p){ return p.email&&(p.depts||[]).indexOf('Systems')!==-1&&it.people.indexOf(p.email.toLowerCase())===-1&&(!q||(p.name||'').toLowerCase().indexOf(q)!==-1||p.email.toLowerCase().indexOf(q)!==-1); })
    .sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); }).slice(0,30);
}
function sfDdClose(){ document.querySelectorAll('.sf-form .sf-dd').forEach(function(d){ d.remove(); }); }
window.sfPplSearch=function(key,q){
  const row=$('sfR-p-'+key); if(!row) return;
  document.querySelectorAll('.sf-form .sf-dd').forEach(function(d){ if(!row.contains(d)) d.remove(); });
  let dd=row.querySelector('.sf-dd'); if(!dd){ dd=document.createElement('div'); dd.className='sf-dd'; row.insertBefore(dd,row.querySelector('.err')); }
  const m=sfPplMatches(key,q);
  dd.innerHTML=m.length?m.map(function(p,i){ return '<button type="button" class="'+(i===0?'hi':'')+'" onmousedown="event.preventDefault();sfPplAdd(\''+key+'\',\''+esc(p.email.toLowerCase())+'\')">'+avatar(p.name)+esc(p.name)+'<span class="d">'+esc((p.depts||[]).join(', '))+'</span></button>'; }).join(''):'<div class="none">No one found</div>';
};
window.sfPplKey=function(ev,key){
  const it=sfBlk(key);
  if(ev.key==='Enter'){ ev.preventDefault(); const m=sfPplMatches(key,ev.target.value); if(m[0]) sfPplAdd(key,m[0].email.toLowerCase()); }
  else if(ev.key==='Backspace'&&!ev.target.value&&it.people.length){ it.people.pop(); sfPplRender(key,''); }
  else if(ev.key==='Escape'){ const dd=$('sfR-p-'+key).querySelector('.sf-dd'); if(dd){ dd.remove(); ev.stopPropagation(); } }
};
window.sfPplAdd=function(key,email){ const it=sfBlk(key); if(it.people.indexOf(email)===-1) it.people.push(email); const r=$('sfR-p-'+key); r.classList.remove('bad'); sfDdClose(); sfPplRender(key); $('sfPplQ-'+key).focus(); };
window.sfPplRemove=function(key,email){ const it=sfBlk(key); it.people=it.people.filter(function(e){ return e!==email; }); sfPplRender(key); };
document.addEventListener('click',function(ev){ if(!ev.target.closest('.sf-form [id^="sfR-p-"]')) sfDdClose(); });

window.sfSave=async function(){
  sfFormSync();
  let ok=true, firstBad=null;
  const bad=function(id,isBad){ const r=$(id); if(r) r.classList.toggle('bad',isBad); if(isBad){ ok=false; if(!firstBad) firstBad=r; } };
  SF_FORM.groups.forEach(function(g,gi){
    bad('sfR-m-'+gi, g.newName!=null?!String(g.newName).trim():!g.mod);
    g.items.forEach(function(it,ii){ const k=gi+'-'+ii;
      bad('sfR-t-'+k,!it.title.trim()); bad('sfR-d-'+k,!it.desc.trim()); bad('sfR-p-'+k,!it.people.length); });
  });
  if(!ok){ if(firstBad) firstBad.scrollIntoView({block:'center',behavior:'smooth'}); return; }
  const btn=$('sfSaveBtn'); btn.disabled=true;
  try{
    // modules typed in: an existing name is reused, a new one is created once however many groups use it
    const ids={};
    for(const g of SF_FORM.groups){
      let name=g.newName!=null?String(g.newName).trim():(String(g.mod).indexOf('new:')===0?String(g.mod).slice(4):null);
      if(name==null){ g.modId=Number(g.mod); continue; }
      const key=name.toLowerCase(), have=SF_MODS.find(function(m){ return m.name.toLowerCase()===key; });
      if(have){ g.modId=have.id; continue; }
      if(!ids[key]){
        const{data,error}=await sb.schema('feedback').from('system_modules').insert({name:name,created_by:fhMe()}).select('id,name').single();
        if(error) throw error; ids[key]=data.id; SF_MODS.push(data);
      }
      g.modId=ids[key];
    }
    if(SF_FORM.editId){
      const g=SF_FORM.groups[0], it=g.items[0];
      const{error}=await sb.schema('feedback').from('system_items').update({module_id:g.modId,kind:it.kind,title:it.title.trim(),description:it.desc.trim(),executed_by:it.people,updated_at:new Date().toISOString()}).eq('id',SF_FORM.editId);
      if(error) throw error;
      const id=SF_FORM.editId; closeModal(); toast('Saved','ok'); navTo('feedback_hub/sys/'+id); return;
    }
    const rows=[]; SF_FORM.groups.forEach(function(g){ g.items.forEach(function(it){ rows.push({module_id:g.modId,kind:it.kind,title:it.title.trim(),description:it.desc.trim(),executed_by:it.people,created_by:fhMe()}); }); });
    const{error}=await sb.schema('feedback').from('system_items').insert(rows);
    if(error) throw error;
    closeModal(); toast((rows.length>1?rows.length+' System Feedbacks created':'System Feedback created')+' - Sales and Pre Sales can rate '+(rows.length>1?'them':'it')+' now','ok');
    SF_VIEW='open'; sfManage();
  }catch(e){ btn.disabled=false; toast('Could not save: '+(e.message||e),'err'); }
};

/* ---- Systems: one item and every rating it got ---- */
async function sfItemPage(v,id){
  v.innerHTML=FH_CSS+SF_CSS+'<div class="loader"><div class="spin"></div></div>';
  let item, rows;
  try{
    await getPeople(); await sfLoadMods();
    const a=await sb.schema('feedback').from('system_items').select('*').eq('id',id).maybeSingle(); if(a.error) throw a.error; item=a.data;
    if(!item){ v.innerHTML=FH_CSS+SF_CSS+sfEmpty('fa-circle-question','This System Feedback no longer exists'); return; }
    const r=await sb.schema('feedback').from('system_responses').select('*').eq('item_id',id).order('submitted_at',{ascending:false}); if(r.error) throw r.error; rows=r.data||[];
  }catch(e){ v.innerHTML=FH_CSS+SF_CSS+sfEmpty('fa-triangle-exclamation','Could not load',e.message||String(e)); return; }
  setCrumb(['Feedback','Feedback Hub','System Feedbacks']);
  const sysTab=fhCanQrForms()?2:0; // System Feedbacks' place among this person's tabs
  SF_FORM=null; window.__sfItem=item;
  const avg=sfAvg(rows), remarks=rows.filter(function(r){ return (r.remarks||'').trim(); }).length;
  v.innerHTML=FH_CSS+SF_CSS+'<div class="fh-page-head"><button class="fh-page-back" title="Back" onclick="goBack(\'feedback_hub/'+sysTab+'\')"><i class="fa-solid fa-arrow-left"></i></button>'
    +'<div style="flex:1;min-width:0"><div class="sf-top" style="margin:0 0 4px">'+sfModTag(item.module_id)+sfKindTag(item.kind)+(item.is_active?'':'<span class="sf-closed"><i class="fa-solid fa-box-archive"></i> Archived</span>')+'<span class="sf-date">'+esc(sfDate(item.created_at))+' · by '+esc(nameOf(item.created_by))+'</span></div>'
    +'<h1 style="font-size:19px;margin:0">'+esc(item.title)+'</h1></div>'
    +'<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn" onclick="sfOpenNew(window.__sfItem)"><i class="fa-solid fa-pen"></i> Edit</button>'
    +'<button class="btn" onclick="sfToggle('+item.id+','+(!item.is_active)+')"><i class="fa-solid '+(item.is_active?'fa-box-archive':'fa-box-open')+'"></i> '+(item.is_active?'Archive':'Restore')+'</button>'
    +'<button class="btn fh-danger" onclick="sfDelete('+item.id+')"><i class="fa-solid fa-trash"></i> Delete</button></div></div>'
    +'<div class="sf-card" style="margin-top:14px"><div class="sf-main"><div class="sf-lbl" style="margin-bottom:4px">Description</div><div class="sf-desc">'+esc(item.description)+'</div>'
    +'<div class="sf-by"><span class="sf-lbl">Executed by</span>'+sfPeople(item.executed_by)+'</div></div></div>'
    +'<div class="sf-sum"><div><b>'+(rows.length?avg.toFixed(1)+' <small style="font-size:12px;color:var(--slate);font-weight:500">/ 10</small>':'—')+'</b><span>Average rating</span></div><div><b>'+rows.length+'</b><span>Ratings</span></div><div><b>'+remarks+'</b><span>Remarks</span></div></div>'
    +(!rows.length?sfEmpty('fa-inbox','No ratings yet',item.is_active?'Sales and Pre Sales see this under Give Feedback.':'This feedback is archived, so no new ratings can come in.')
    :'<table class="sf-tbl"><thead><tr><th>Person</th><th>Rating</th><th>Remarks</th><th class="hide-m">Date</th></tr></thead><tbody>'
      +rows.map(function(r){ const n=nameOf(r.rater_email), p=(PEOPLE||[]).find(function(x){ return x.email&&x.email.toLowerCase()===r.rater_email; });
        return '<tr><td><span style="display:inline-flex;align-items:center;gap:8px">'+avatar(n)+'<span><b style="font-weight:600">'+esc(n)+'</b><br><span style="font-size:11.5px;color:var(--slate)">'+esc(((p&&p.depts)||[]).filter(function(d){ return d==='Sales'||d==='Pre Sales'; }).join(', '))+'</span></span></span></td>'
          +'<td style="white-space:nowrap">'+sfStars(r.rating)+' <b style="margin-left:4px">'+r.rating+'</b></td><td style="white-space:pre-wrap">'+(esc(r.remarks||'')||'<span style="color:var(--slate-2)">—</span>')+'</td><td class="hide-m" style="white-space:nowrap;color:var(--slate)">'+esc(sfDate(r.updated_at||r.submitted_at))+'</td></tr>'; }).join('')
      +'</tbody></table>');
}
window.sfToggle=async function(id,on){
  const{error}=await sb.schema('feedback').from('system_items').update({is_active:on,updated_at:new Date().toISOString()}).eq('id',id);
  if(error){ toast('Could not update: '+error.message,'err'); return; }
  toast(on?'Restored - it can be rated again':'Archived - no new ratings will come in','ok'); navTo('feedback_hub/sys/'+id);
};
window.sfDelete=async function(id){
  if(!await confirmDialog('Its ratings and remarks are deleted with it. This cannot be undone.',{title:'Delete this System Feedback?',okLabel:'Delete'})) return;
  const{error}=await sb.schema('feedback').from('system_items').delete().eq('id',id);
  if(error){ toast('Could not delete: '+error.message,'err'); return; }
  toast('Deleted','ok'); history.back();
};

/* ---- Sales / Pre Sales: one row per module, and the Archive of what they gave ----
   (6 Nov 2026, Ayush) A row is a MODULE: its name, how many New Features and Bugs Fixed are waiting,
   and Give Feedback. The row itself opens nothing - only the button does - and feedback is given only
   module by module. Searching shows the matching feedbacks inside their module's row. */
async function sfGive(){
  const b=$('fhBody'); if(!b) return;
  loader(b);
  let items, mine=[];
  try{
    await getPeople(); await sfLoadMods();
    items=await sfLoadItems();
    // Only this person's own rows come back - the database returns nobody else's to a rater.
    const r=await sb.schema('feedback').from('system_responses').select('*').eq('rater_email',fhMe()); if(r.error) throw r.error; mine=r.data||[];
  }catch(e){ b.innerHTML=sfEmpty('fa-triangle-exclamation','Could not load',e.message||String(e)); return; }
  const my={}; mine.forEach(function(r){ my[r.item_id]=r; });
  SF_DATA={items:items,my:my};
  const nTodo=items.filter(function(i){ return i.is_active&&!my[i.id]; }).length, nDone=items.filter(function(i){ return my[i.id]; }).length;
  b.innerHTML='<div class="sf-tools">'   // no heading block: the tab already says Give Feedback (6 Nov 2026)
    +'<div class="sf-filter"><button class="'+(SF_VIEW==='open'?'on':'')+'" onclick="sfSetView(\'open\',sfGiveList)">To give <span class="n">'+nTodo+'</span></button>'
    +'<button class="'+(SF_VIEW==='archive'?'on':'')+'" onclick="sfSetView(\'archive\',sfGiveList)"><i class="fa-solid fa-box-archive"></i> Archive <span class="n">'+nDone+'</span></button></div>'
    +sfSearchBox('sfGiveQ')+'</div>'
    +'<div id="sfRes"></div>';
  sfGiveList();
}
function sfGiveList(){
  const host=$('sfRes'); if(!host||!SF_DATA) return;
  const my=SF_DATA.my, arch=SF_VIEW==='archive';
  const pool=SF_DATA.items.filter(function(i){ return arch?!!my[i.id]:(i.is_active&&!my[i.id]); });
  // a module shows when its name matches, or any of its feedbacks does (those are listed inside it)
  const mods=sfByModule(pool).map(function(m){
    const nameHit=SF_Q&&m.name.toLowerCase().indexOf(SF_Q.toLowerCase())!==-1;
    return {m:m, hits:SF_Q?m.items.filter(sfMatches):[], show:!SF_Q||nameHit||m.items.some(sfMatches)};
  }).filter(function(x){ return x.show; });
  if(!mods.length){
    host.innerHTML=SF_Q?sfEmpty('fa-magnifying-glass','Nothing matches "'+SF_Q+'"','Try a module, a feedback or a person.')
      :arch?sfEmpty('fa-box-archive','Nothing in your Archive yet','Every feedback you give is kept here.')
      :sfEmpty('fa-circle-check','You are all caught up','New features and bug fixes will appear here, module by module.');
    return;
  }
  host.innerHTML=mods.map(function(x){ const m=x.m;
    const head='<div class="sf-mcard-hd">'+sfModTitle(m)+sfKindCounts(m.items)
      +(arch?'<span class="sf-mcard-rt">'+m.items.length+' given</span>'
            :'<span class="sf-mcard-rt">'+m.items.length+' waiting for you</span><button class="btn btn-primary" style="margin-left:0" onclick="navTo(\'feedback_hub/give/m'+m.id+'\')"><i class="fa-solid fa-star"></i> Give Feedback</button>')+'</div>';
    // the Archive lists what was given, with the rating; elsewhere only search results are listed
    const list=arch?m.items:x.hits;
    const rows=list.length?'<div class="sf-mrows">'+(arch?'':'<div class="sf-hits-lbl">Matching feedbacks</div>')
      +list.map(function(i){ const r=my[i.id];
        return '<div class="sf-mrow'+(arch?' click" onclick="navTo(\'feedback_hub/give/'+i.id+'\')':'')+'">'+sfKindTag(i.kind)
          +'<div class="t"><div class="nm">'+sfHi(i.title)+'</div><div class="sub">'+sfHi(sfFirstLine(i.description))+'</div></div>'
          +(r?'<span class="rt">'+sfStars(r.rating)+' <b>'+r.rating+'</b></span><i class="fa-solid fa-chevron-right go"></i>':'')+'</div>'; }).join('')+'</div>':'';
    return '<div class="sf-mcard">'+head+rows+'</div>'; }).join('');
}
window.sfGiveList=sfGiveList;
window.sfGiveQ=function(v){ sfSetQ(v,sfGiveList); };
const SF_RATE_WORDS=['','Very poor','Poor','Below average','Fair','Average','Decent','Good','Very good','Excellent','Outstanding'];
// Give Feedback's place among this person's tabs (Design, Records, System Feedbacks come first when they have them).
function sfGiveTab(){ return (fhCanQrForms()?2:0)+(fhIsSystems()?1:0); }
window.sfOpenRate=function(id){ navTo('feedback_hub/give/'+id); };

/* ---- giving feedback: route give/m<module> lists EVERY feedback of the module still waiting for this
   person, all on one page - nothing to add, nothing to remove. Only the ones rated are recorded on
   Submit; the rest stay waiting for next time. Route give/<item> shows a given one back (Archive). */
async function sfRatePage(v,arg){
  v.innerHTML=FH_CSS+SF_CSS+'<div class="loader"><div class="spin"></div></div>';
  const isMod=/^m\d+$/.test(String(arg)), id=Number(isMod?String(arg).slice(1):arg);
  const back='goBack(\'feedback_hub/'+sfGiveTab()+'\')';
  let i=null, items=[], mine=[];
  try{
    await getPeople(); await sfLoadMods();
    const m=await sb.schema('feedback').from('system_responses').select('*').eq('rater_email',fhMe()); if(m.error) throw m.error; mine=m.data||[];
    if(isMod){ const s=await sb.schema('feedback').from('system_items').select('*').eq('module_id',id).eq('is_active',true).order('created_at',{ascending:true}); if(s.error) throw s.error; items=s.data||[]; }
    else { const a=await sb.schema('feedback').from('system_items').select('*').eq('id',id).maybeSingle(); if(a.error) throw a.error; i=a.data; }
  }catch(e){ v.innerHTML=FH_CSS+SF_CSS+sfEmpty('fa-triangle-exclamation','Could not load',e.message||String(e)); return; }
  const head=function(modId,title){ return '<div class="fh-page-head"><button class="fh-page-back" title="Back" onclick="'+back+'"><i class="fa-solid fa-arrow-left"></i></button>'
    +'<div style="flex:1;min-width:0"><div class="sf-top" style="margin:0 0 4px">'+sfModTag(modId)+'</div><h1 style="font-size:19px;margin:0">'+esc(title)+'</h1></div></div>'; };
  if(!isMod){
    if(!i){ v.innerHTML=FH_CSS+SF_CSS+sfEmpty('fa-circle-question','This feedback no longer exists'); return; }
    const r=mine.find(function(x){ return x.item_id===id; });
    // not given yet: feedback is given module by module, so go to its module
    if(!r){ navTo('feedback_hub/give/m'+i.module_id); return; }
    setCrumb(['Feedback','Feedback Hub','Archive']);
    v.innerHTML=FH_CSS+SF_CSS+'<div class="sf-page">'+head(i.module_id,i.title)+'<div class="sf-form" style="margin-top:14px">'
      +'<div class="sf-view" style="background:#fff">'+sfKindTag(i.kind)+'<div class="sf-desc" style="margin-top:8px">'+esc(i.description)+'</div>'
      +'<div class="sf-lbl" style="margin-top:14px">Executed by</div><div class="sf-by" style="margin-top:6px">'+sfPeople(i.executed_by)+'</div></div>'
      +'<div class="sf-view" style="background:#fff"><div class="sf-lbl">Your rating</div><div style="margin-top:6px;display:flex;align-items:center;gap:8px">'+sfStars(r.rating).replace('font-size:12px','')+'<b style="font-size:15px">'+r.rating+'</b><span style="color:var(--slate);font-size:12.5px">/ 10 · '+esc(SF_RATE_WORDS[r.rating])+'</span></div>'
      +'<div class="sf-lbl" style="margin-top:14px">Remarks</div><div class="sf-desc" style="margin-top:4px">'+(esc(r.remarks||'')||'<span style="color:var(--slate-2)">—</span>')+'</div>'
      +'<div style="margin-top:14px;font-size:12px;color:var(--slate)"><i class="fa-solid fa-lock" style="margin-right:6px"></i>Submitted on '+esc(sfDate(r.submitted_at))+'. Feedback cannot be changed once submitted.</div></div>'
      +'<div style="display:flex;justify-content:flex-end"><button class="btn" onclick="'+back+'"><i class="fa-solid fa-arrow-left"></i> Back</button></div></div></div>';
    return;
  }
  setCrumb(['Feedback','Feedback Hub','Give Feedback']);
  const done={}; mine.forEach(function(x){ done[x.item_id]=1; });
  const todo=items.filter(function(x){ return !done[x.id]; });
  if(!todo.length){ v.innerHTML=FH_CSS+SF_CSS+'<div class="sf-page">'+head(id,sfModName(id))+sfEmpty('fa-circle-check','Nothing waiting in this module','Everything you gave is in your Archive.')+'</div>'; return; }
  const byId={}; todo.forEach(function(x){ byId[x.id]=x; });
  SF_RATE={byId:byId, blocks:todo.map(function(x){ return x.id; }), r:{}};
  v.innerHTML=FH_CSS+SF_CSS+'<div class="sf-page">'+head(id,sfModName(id))
    /* (6 Nov 2026, Ayush) No instructions strip: each feedback has its own "Rate this" panel, and the bar
       at the bottom stays on screen counting how many are rated, so the way to finish is always in sight. */
    +'<div class="sf-lns" id="sfBlocks"></div>'
    +'<div class="sf-submitbar"><span id="sfRateProg" class="prog"></span><span class="note">Once submitted, a rating cannot be changed.</span>'
    +'<button class="btn" onclick="'+back+'">Cancel</button><button class="btn btn-primary" id="sfRateBtn" onclick="sfRateSave()" disabled>Submit feedback</button></div></div>';
  sfRateRender();
}
function sfRateSync(){ if(!SF_RATE) return; SF_RATE.blocks.forEach(function(id){ const t=$('sfRm-'+id); if(t) (SF_RATE.r[id]=SF_RATE.r[id]||{}).remarks=t.value; }); }
function sfRateRender(){
  const box=$('sfBlocks'); if(!box) return;
  box.innerHTML=SF_RATE.blocks.map(function(id,n){ const i=SF_RATE.byId[id], st=SF_RATE.r[id]||{};
    /* (6 Nov 2026, Ayush) What it is on the left - kind and who executed it on one quiet line, the name,
       the full description; the stars and a remark on the right. Nothing hidden, nothing repeated. */
    return '<div class="sf-ln'+(st.rating?' done':'')+'" id="sfB-'+id+'"><div class="sf-ln-row">'
      +'<div class="what"><div class="meta"><span class="'+(i.kind==='Bug Fixed'?'bug':'new')+'">'+esc(i.kind)+'</span> · '+esc((i.executed_by||[]).map(nameOf).join(', '))+'</div>'
        +'<div class="ttl">'+esc(i.title)+'</div><div class="dsc">'+esc(i.description)+'</div></div>'
      +'<div class="give"><div class="stars"><div class="sf-rate" onmouseleave="sfRatePaint('+id+',(SF_RATE.r['+id+']||{}).rating||0)">'
          +[1,2,3,4,5,6,7,8,9,10].map(function(k){ return '<button type="button" title="'+k+' / 10 · '+SF_RATE_WORDS[k]+'" onmouseenter="sfRatePaint('+id+','+k+')" onclick="sfRateSet('+id+','+k+')"><i class="fa-solid fa-star"></i></button>'; }).join('')
        +'</div><span class="sf-rate-val" id="sfRV-'+id+'"></span></div>'
        +'<textarea class="rm" id="sfRm-'+id+'" rows="2" maxlength="2000" placeholder="Add a remark (optional)">'+esc(st.remarks||'')+'</textarea></div>'
    +'</div></div>'; }).join('');   // .sf-ln-row, then .sf-ln - each card closed, so cards never nest
  SF_RATE.blocks.forEach(function(id){ sfRatePaint(id,(SF_RATE.r[id]||{}).rating||0); });
  sfRateCount();
}
// The button says how many will be recorded - the rated ones - and is off until one is rated.
function sfRateCount(){
  const n=SF_RATE.blocks.filter(function(id){ return SF_RATE.r[id]&&SF_RATE.r[id].rating; }).length, btn=$('sfRateBtn');
  if(btn){ btn.disabled=!n; btn.textContent=n>1?'Submit '+n+' feedbacks':'Submit feedback'; }
  const p=$('sfRateProg'), t=SF_RATE.blocks.length;
  if(p) p.innerHTML=n?'<b>'+n+' of '+t+'</b> rated':'Rate at least one to submit · <b>0 of '+t+'</b> rated';
}
window.sfRatePaint=function(id,n){
  document.querySelectorAll('#sfB-'+id+' .sf-rate button').forEach(function(b,i){ b.classList.toggle('on',i<n); });
  const v=$('sfRV-'+id); if(v){ v.innerHTML=n?'<b>'+n+'</b>/10':''; }   // the number only - the words ran out of the panel
};
window.sfRateSet=function(id,n){
  (SF_RATE.r[id]=SF_RATE.r[id]||{}).rating=n; sfRatePaint(id,n); sfRateCount();
  const c=$('sfB-'+id); if(c) c.classList.add('done');
};
window.sfRateSave=async function(){
  sfRateSync();
  const rows=SF_RATE.blocks.filter(function(id){ return SF_RATE.r[id]&&SF_RATE.r[id].rating; })
    .map(function(id){ const s=SF_RATE.r[id]; return {item_id:id,rater_email:fhMe(),rating:s.rating,remarks:(s.remarks||'').trim()||null}; });
  if(!rows.length) return;
  const btn=$('sfRateBtn'); btn.disabled=true;
  const{error}=await sb.schema('feedback').from('system_responses').insert(rows);
  if(error){ btn.disabled=false; toast(error.code==='23505'?'One of these has already been given - open Give Feedback again.':'Could not submit: '+error.message,'err'); return; }
  const left=SF_RATE.blocks.length-rows.length;
  toast('Thank you - '+(rows.length>1?rows.length+' feedbacks':'your feedback')+' recorded'+(left?' · '+left+' still waiting in this module':''),'ok');
  SF_VIEW='open'; navTo('feedback_hub/'+sfGiveTab());
};
