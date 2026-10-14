/* ============================ HELPERS ============================ */
function toast(msg,type){if(type==='err')console.error('[toast]',msg);const t=el('div','toast '+(type||''),'<i class="fa-solid fa-'+(type==='err'?'circle-exclamation':type==='ok'?'circle-check':type==='warn'?'triangle-exclamation':'circle-info')+'"></i>'+esc(msg));$('toasts').appendChild(t);setTimeout(()=>t.remove(),(type==='err'||type==='warn')?9000:3400);}
function fmtBytes(b){if(!b)return '—';const u=['B','KB','MB','GB'];let i=0;b=Number(b);while(b>=1024&&i<3){b/=1024;i++;}return b.toFixed(b<10&&i>0?1:0)+' '+u[i];}
function fmtDate(d){if(!d)return '—';const dt=new Date(d);return dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});}
function fmtDateShort(d){if(!d)return '—';return new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short'});}
function relTime(d){const s=(Date.now()-new Date(d))/1000;if(s<60)return 'just now';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';if(s<604800)return Math.floor(s/86400)+'d ago';return fmtDate(d);}
const PALETTE=['#1e3a8a','#0f766e','#7c3aed','#b45309','#be123c','#0369a1','#15803d','#9333ea','#c2410c','#1d4ed8'];
function colorFor(s){s=s||'?';let h=0;for(let i=0;i<s.length;i++)h=s.charCodeAt(i)+((h<<5)-h);return PALETTE[Math.abs(h)%PALETTE.length];}
function initials(name){if(!name)return '?';const p=name.trim().split(/\s+/);return ((p[0]||'')[0]||'')+((p[1]||'')[0]||'');}
function avatar(name,sm){const c=colorFor(name);return '<span class="avatar-sm" style="background:'+c+'" title="'+esc(name)+'">'+esc(initials(name).toUpperCase())+'</span>';}
/* ---- overlapping avatar stack (up to 3 shown, "+N" beyond that) for task-row sub-labels ---- */
function avatarStackHtml(emails){
  const list=(emails||[]).filter(Boolean);
  if(!list.length)return '';
  const shown=list.slice(0,3);
  const extra=list.length-shown.length;
  return '<span class="avatar-stack">'+shown.map(e=>avatar(nameOf(e))).join('')+(extra>0?'<span class="avatar-sm avatar-extra" title="'+esc(list.slice(3).map(nameOf).join(', '))+'">+'+extra+'</span>':'')+'</span>';
}
/* ---- task row sub-label: "Assigned/Delegated to {avatar stack} by {name}" ---- */
function dgRowLabelHtml(word,toEmails,byEmail){
  const to=(toEmails||[]).filter(Boolean);
  if(!to.length&&!byEmail)return '';
  let html=esc(word)+' to '+(to.length?avatarStackHtml(to):'<span style="color:var(--slate)">—</span>');
  if(byEmail)html+=' by <b>'+(byEmail===state.email?'you':esc(nameOf(byEmail)))+'</b>';
  return html;
}
function fileIcon(ft){ft=(ft||'').toLowerCase();if(ft.includes('pdf'))return '<span class="ftype fp-pdf"><i class="fa-solid fa-file-pdf"></i></span>';if(ft.includes('xls')||ft.includes('csv'))return '<span class="ftype fp-xlsx"><i class="fa-solid fa-file-excel"></i></span>';if(ft.includes('doc'))return '<span class="ftype fp-docx"><i class="fa-solid fa-file-word"></i></span>';if(ft.match(/png|jpg|jpeg|gif|webp|svg/))return '<span class="ftype fp-img"><i class="fa-solid fa-file-image"></i></span>';return '<span class="ftype fp-other"><i class="fa-solid fa-file-lines"></i></span>';}
function statusTag(s){const m={'Active':'t-green','Completed':'t-green','Archived':'t-gray','Draft':'t-amber','In Progress':'t-blue','Not Started':'t-gray','Blocked':'t-red','Upcoming':'t-gray','Current':'t-blue','Due':'t-red','Pending':'t-amber','Awaiting Approval':'t-amber','Done':'t-blue'};return '<span class="tag '+(m[s]||'t-gray')+'">'+esc(s||'—')+'</span>';}
function prioTag(p){const m={'Urgent':'t-red','High':'t-amber','Medium':'t-blue','Low':'t-gray'};return '<span class="tag '+(m[p]||'t-gray')+'">'+esc(p||'—')+'</span>';}
/* THE SCREEN YOU ALREADY HAVE STAYS UP WHILE THE NEXT LOAD RUNS.

   Every screen used to begin by wiping itself to a spinner and then going to fetch. On a fast
   database nobody notices; on a slow one you spend the day watching a circle turn, and worse, you
   lose the thing you were reading in order to be shown it again a moment later. Changing a filter,
   switching a tab, saving a row - each one blanked the screen you were working in.

   So: when a redraw belongs to the SAME module that is already on screen, the content stays put
   and a thin bar runs across the top of the window instead. Nothing is faster. It simply stops
   throwing your work away while it waits.

   WHY ONLY THE SAME MODULE. The HTML on screen is only half of a screen - the other half is the
   arrays in memory its buttons read. Within a module those are still there, so every row and
   button on the kept HTML still works. Across modules they are not: Post Sales' lists are not
   loaded while you are in Accountability, and a click on a stale row would act on nothing. That
   case still blanks, deliberately. */
let LOAD_BAR_TIMER=null;
function loadBarShow(){
  let el=document.getElementById('loadBar');
  if(!el){ el=document.createElement('div'); el.id='loadBar'; document.body.appendChild(el); }
  el.classList.add('on');
  clearTimeout(LOAD_BAR_TIMER);
  /* A backstop, because nothing here can know that a fetch has given up. A view that throws before
     it redraws would otherwise leave the bar running for ever, which reads as "still loading" when
     nothing is. Fifteen seconds is longer than any screen should honestly take. */
  LOAD_BAR_TIMER=setTimeout(loadBarHide,15000);
}
function loadBarHide(){
  clearTimeout(LOAD_BAR_TIMER); LOAD_BAR_TIMER=null;
  const el=document.getElementById('loadBar'); if(el)el.classList.remove('on');
}
/* The bar comes down when the host actually redraws, which is the only honest signal available -
   a view finishing is a view replacing its contents. Attached once per element. */
function loaderWatch(host){
  if(host.__loadObs) return;
  try{
    const obs=new MutationObserver(function(){ loadBarHide(); });
    obs.observe(host,{childList:true});
    host.__loadObs=obs;
  }catch(_e){ /* no observer here - the timer above still brings it down */ }
}
function loader(host){
  if(!host) return;
  const keep = host.dataset.loaderPage===PAGE
            && host.innerHTML
            && host.innerHTML.indexOf('class="loader"')<0;
  host.dataset.loaderPage=PAGE;
  if(keep){ loaderWatch(host); loadBarShow(); return; }
  loadBarHide();
  host.innerHTML='<div class="loader"><div class="spin"></div></div>';
}

/* modal */
function openModal(html,size){const h=$('modalHost');h.innerHTML='<div class="modal '+(size||'')+'">'+html+'</div>';$('overlay').classList.add('show');}
function closeModal(){$('overlay').classList.remove('show');$('modalHost').innerHTML='';if(__confirmResolve){const r=__confirmResolve;__confirmResolve=null;r(false);}}
// Clicking the backdrop never closes a form — only an explicit Cancel/×/Save does. Typing lost
// to an accidental outside click was the recurring complaint this replaced.
/* ---- custom confirm dialog — replaces the native confirm() everywhere so delete/decline
   prompts look and behave the same on every device, instead of relying on the browser's own
   "This page says…" dialog (whose styling/wording is desktop-Chrome-specific and inconsistent
   or absent on mobile browsers). Usage: if(!await confirmDialog('Delete this task?'))return; */
let __confirmResolve=null;
/* Saying no here takes back the usage event the click already queued.
   The generic USAGE_MAP wrapper fires on the CLICK, and for a button that asks "are you sure?"
   that is a full second before anybody has agreed to anything - so a delete somebody thought
   better of counted exactly the same as one they went through with. Twenty-six buttons across the
   portal are built this way (deletes, rejections, closing hiring, restoring calls, the AI rewrite),
   and the Usability report has been counting every abandoned one of them.
   Retracting at the point of refusal fixes all twenty-six at once, and any confirm-gated button
   added later, without moving the logging inside each function by hand - and without the opposite
   mistake of unmapping them, which would have left those features recording nothing at all. It is
   safe because the event is still sitting in the client-side queue unsent: only the event queued in
   the same breath as this dialog opening qualifies (the modal blocks the UI, so no unrelated click
   can land in between), and only while it is genuinely still unsent - a batch already on its way to
   the server is left alone rather than chased. A feature that wants to record the specific thing it
   deleted still logs directly at its own source, exactly as before. */
function confirmDialog(message,opts){
  opts=opts||{};
  const danger=opts.danger!==false;
  const pending=usagePendingClick();
  return new Promise(resolve=>{
    __confirmResolve=function(val){ if(val===false) usageRetract(pending); resolve(val); };
    openModal(`<div class="modal-head"><h3><i class="fa-solid ${opts.icon||(danger?'fa-triangle-exclamation':'fa-circle-question')}" style="color:${danger?'var(--err)':'var(--brand)'}"></i> ${esc(opts.title||'Please confirm')}</h3></div>
      <div class="modal-body">${esc(message)}</div>
      <div class="modal-foot"><button class="btn" onclick="__confirmAnswer(false)">Cancel</button><button class="btn ${danger?'btn-danger':'btn-primary'}" onclick="__confirmAnswer(true)">${esc(opts.okLabel||'Delete')}</button></div>`);
  });
}
window.__confirmAnswer=function(val){
  const r=__confirmResolve;__confirmResolve=null;
  closeModal();
  if(r)r(val);
};

/* SOME DECISIONS ARE NOT YES OR NO.

   Rejecting a candidate is two different acts - turning them down, and telling them - and a
   two-button dialog had to pick one. It asked "Reject & email?" and treated No as "do nothing",
   so rejecting somebody without writing to them was simply not offered. This takes a list of
   choices and returns the one pressed, or null for Cancel. */
let __choiceResolve=null;
function choiceDialog(message,opts){
  opts=opts||{};
  const btns=(opts.choices||[]).map(function(c){
    return '<button class="btn '+(c.style||'')+'" onclick="__choiceAnswer('
      +esc(JSON.stringify(String(c.key)))+')">'
      +(c.icon?'<i class="fa-solid '+esc(c.icon)+'"></i> ':'')+esc(c.label)+'</button>';
  }).join('');
  return new Promise(function(resolve){
    __choiceResolve=resolve;
    openModal('<div class="modal-head"><h3><i class="fa-solid '+esc(opts.icon||'fa-circle-question')
      +'" style="color:'+(opts.danger?'var(--err)':'var(--brand)')+'"></i> '+esc(opts.title||'Please choose')+'</h3></div>'
      +'<div class="modal-body">'+esc(message)+'</div>'
      +'<div class="modal-foot" style="flex-wrap:wrap;gap:8px">'
      +'<button class="btn" onclick="__choiceAnswer(null)">Cancel</button>'+btns+'</div>');
  });
}
window.__choiceAnswer=function(key){
  const r=__choiceResolve;__choiceResolve=null;
  closeModal();
  if(r)r(key===undefined?null:key);
};

