/* =============================================================================================
   WHATSAPP TEMPLATES (module id 'wa_templates', 17 Nov 2026 - Ayush).
   Tab 1 TEMPLATES: the WhatsApp drip flow of each project, from the team's sheet "Lead Nurturing 2026
   (Drip Marketing) - All Projects" (sheets Gurukul, Dream World City, Dream Ananta - After Launch).
   One project at a time, little noise, little scrolling (layout notes at WAT_CSS). A click on a template
   shows the message the way WhatsApp draws it, with its template ID.
   The sheet is read once into assets/wa-templates/flows.json (+ img/) - to change a flow, change the
   sheet and re-read it (scratch genflows.js).
   Tab 2 DELIVERIES: camp.wa_* filled nightly by the edge function wa-deliveries-sync.
   Who sees it: everyone with Campaign Analytics ('campaigns'), plus a direct 'wa_templates' grant.
   ============================================================================================= */
const WAT_TABS=['Templates','Deliveries','Knocking'];   // Knocking: 17 Nov 2026
let WAT_DATA=null, WAT_PROJ=null, WAT_STAGE=0;
const WAT_STAGE_COL={'enquiry':'#2563eb','qualified':'#7c3aed','ov':'#d97706','site visit':'#059669','miss ov':'#dc2626'};
/* LAYOUT (17 Nov 2026, third version - Ayush: "clumsy ... much less noisy, easier to explore ... remove extra text",
   then "the Template Id is important, visible without clicking the row", "rows full width, on click just the Look
   opens along with the Id", "how it will look in WhatsApp, the Look container enlarges - no scroll inside it", and
   "in phone nothing is responsive"). Project = segmented switch; the lead's journey = one row of big stage boxes;
   the stage = full-width rows (day, kind, headline, template id); a click opens the WhatsApp look under the row. */
const WAT_CSS='<style>'
+'.wat-top{display:flex;align-items:center;gap:12px;margin:0 0 16px}'
+'.wat-seg{display:inline-flex;background:#f1f5f9;border-radius:12px;padding:4px;gap:2px;max-width:100%;overflow-x:auto;scrollbar-width:none}'
+'.wat-seg::-webkit-scrollbar{display:none}'
+'.wat-seg button{border:0;background:transparent;border-radius:9px;padding:9px 18px;font-size:14px;font-weight:600;color:#475569;cursor:pointer;font-family:inherit;white-space:nowrap}'
+'.wat-seg button.on{background:#fff;color:#0f172a;box-shadow:0 1px 3px rgba(15,23,42,.12)}'
+'.wat-links{margin-left:auto;display:flex;gap:6px;flex-shrink:0}'
+'.wat-links a{width:36px;height:36px;border-radius:9px;border:1px solid var(--line);display:inline-flex;align-items:center;justify-content:center;color:#475569;background:#fff}'
+'.wat-journey{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 16px}'
+'.wat-step{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px;cursor:pointer;text-align:left;font-family:inherit}'
+'.wat-step:hover{border-color:#94a3b8}'
+'.wat-step .nm{font-size:14px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:8px}'
+'.wat-step .nm i{width:10px;height:10px;border-radius:50%;display:inline-block}'
+'.wat-step .ct{font-size:26px;font-weight:700;color:#0f172a;margin-top:6px;line-height:1}'
+'.wat-step .ct small{font-size:12.5px;font-weight:500;color:var(--slate);margin-left:6px}'
+'.wat-step.on{border-width:2px;padding:13px 15px;box-shadow:0 4px 14px rgba(15,23,42,.08)}'
+'.wat-list{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}'
+'.wat-row{display:grid;grid-template-columns:62px 30px minmax(0,1fr) auto 18px;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid #f1f5f9;cursor:pointer}'
+'.wat-list>.wat-row:first-child{border-top:0}'
+'.wat-row:hover{background:#f8fafc}.wat-row.on{background:#f0fdf4}'
+'.wat-row .d{font-size:12px;color:var(--slate);font-weight:600;white-space:nowrap}.wat-row .d b{font-size:16px;color:#0f172a;margin-left:3px}'
+'.wat-row .k{width:30px;height:30px;border-radius:8px;background:#f1f5f9;color:#475569;display:flex;align-items:center;justify-content:center;font-size:13px}'
+'.wat-row .t{font-size:13.5px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
+'.wat-row .id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:#334155;background:#f1f5f9;border-radius:6px;padding:3px 8px;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}'
+'.wat-row .id.none{background:transparent;color:#94a3b8;font-family:inherit}'
+'.wat-row .cv{color:#94a3b8;font-size:12px;transition:transform .15s}.wat-row.on .cv{transform:rotate(180deg)}'
+'.wat-row.skip .t{color:#94a3b8;text-decoration:line-through}'
+'.wat-open{border-top:1px solid #dcfce7;background:#f6fef9;padding:18px 16px;display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start}'
+'.wat-look{background:#efeae2;border-radius:16px;padding:16px 14px;width:380px;max-width:100%;box-sizing:border-box}'
+'.wat-bub{background:#fff;border-radius:0 10px 10px 10px;box-shadow:0 1px 1px rgba(0,0,0,.1);overflow:hidden}'
+'.wat-bub .mm{padding:4px 4px 0}'
+'.wat-bub img,.wat-bub video{display:block;width:100%;height:auto;border-radius:7px;background:#000}'
+'.wat-pdf{display:flex;align-items:center;gap:10px;padding:12px;margin:4px;border-radius:7px;background:#f5f6f6;color:#0f172a;text-decoration:none;font-size:13px;font-weight:600;word-break:break-all}'
+'.wat-pdf i{font-size:24px;color:#dc2626;flex-shrink:0}'
+'.wat-txt{padding:9px 11px 4px;white-space:pre-wrap;font-size:14px;line-height:1.45;color:#111b21;word-break:break-word}'
+'.wat-tm{text-align:right;font-size:11px;color:#667781;padding:0 10px 6px}'
+'.wat-btn{border-top:1px solid #f0f2f5;padding:10px;text-align:center;color:#027eb5;font-size:14px;font-weight:500}'
+'.wat-btn i{margin-right:6px;font-size:12px}'
+'.wat-det{flex:1;min-width:220px;font-size:13px}'
+'.wat-det .lbl{font-size:11px;font-weight:600;color:var(--slate);text-transform:uppercase;letter-spacing:.04em;margin:0 0 4px}'
+'.wat-det .big{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;font-weight:600;color:#0f172a;display:flex;align-items:center;gap:8px;word-break:break-all;margin-bottom:16px}'
+'.wat-det .big button{border:1px solid var(--line);background:#fff;border-radius:7px;padding:4px 8px;cursor:pointer;color:#475569;flex-shrink:0}'
+'.wat-det .kv{display:grid;grid-template-columns:90px 1fr;gap:7px 10px}.wat-det .kv>div:nth-child(odd){color:var(--slate)}'
+'.wat-todo{padding:12px 16px;border-top:1px dashed var(--line);background:#fafafa;font-size:12.5px;color:var(--slate)}'
+'.wat-todo div{padding:3px 0}'
+'.wat-wel{margin-bottom:12px}'
+'@media(max-width:720px){'
+'.wat-top{flex-wrap:wrap}.wat-links{margin-left:0}'
+'.wat-journey{display:flex;overflow-x:auto;scrollbar-width:none;gap:8px}.wat-journey::-webkit-scrollbar{display:none}'
+'.wat-step{flex:0 0 auto;min-width:118px;padding:10px 12px}.wat-step.on{padding:9px 11px}.wat-step .ct{font-size:21px}'
+'.wat-row{grid-template-columns:50px minmax(0,1fr) 16px;grid-template-areas:"d t cv" "d id cv";gap:3px 10px;padding:11px 12px}'
+'.wat-row .d{grid-area:d}.wat-row .k{display:none}.wat-row .t{grid-area:t;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}'
+'.wat-row .id{grid-area:id;justify-self:start;max-width:100%;font-size:11px}.wat-row .cv{grid-area:cv}'
+'.wat-open{padding:14px 10px}.wat-look{width:100%}'
+'}'
+'</style>';

/* 18 Nov 2026 (Ayush: "Templates does not load", "after Templates or Knocking I can't open Deliveries"): a failed read of the
   sheet used to be remembered as an empty sheet - Templates then showed nothing for the rest of the visit and Deliveries
   broke on the missing project list. Now a failure is not kept (the next visit to the tab tries again, twice), and the
   page says what went wrong. Opened as a file (file:///...) the browser blocks the read - JainE must be opened at
   http://localhost:8080 (or the live site). */
let WAT_ERR=null;
async function watLoad(){
  WAT_ERR=null;
  if(location.protocol==='file:'){ WAT_ERR='file'; return; }
  for(let tries=0;tries<2&&!WAT_DATA;tries++){
    try{ const r=await fetch('assets/wa-templates/flows.json?v=2',{cache:'no-cache'}); if(!r.ok) throw new Error('HTTP '+r.status);
      const d=await r.json(); if(d&&Array.isArray(d.projects)&&d.projects.length) WAT_DATA=d; else throw new Error('empty'); }
    catch(e){ WAT_ERR=String((e&&e.message)||e); }
  }
  if(WAT_DATA){ WAT_ERR=null; if(!WAT_PROJ) WAT_PROJ=WAT_DATA.projects[0].key; }
}
function watErrBox(){ return '<div class="card card-pad" style="color:#b91c1c;font-size:13.5px"><i class="fa-solid fa-triangle-exclamation"></i> '
  +(WAT_ERR==='file'?'This page was opened as a file, so the browser blocks its data. Open JainE at <b>http://localhost:8080/wa_templates.html</b> instead.'
    :'The templates sheet could not be read ('+esc(WAT_ERR||'unknown')+'). <a href="javascript:void(0)" onclick="WAT_DATA=null;renderPage()">Try again</a>')+'</div>'; }
function watKind(t){ t=String(t||'').toLowerCase();
  if(/video/.test(t)) return ['fa-solid fa-video','Video'];
  if(/pdf/.test(t)) return ['fa-regular fa-file-pdf','PDF'];
  if(/image/.test(t)) return ['fa-regular fa-image','Image'];
  if(/text/.test(t)) return ['fa-regular fa-message','Text'];
  return ['fa-regular fa-circle','']; }
// A short title for the card: the message's first real line (not "Dear {{Customer Name}},"), else the template name
function watTitle(s){
  const lines=String(s.text||'').split('\n').map(function(l){ return l.trim().replace(/^[^A-Za-z{]*watch\s+(the\s+)?video[^A-Za-z]*(to\s+see\s+)?/i,'').replace(/^https?:\/\/\S+\s*/,'').trim(); }).filter(function(l){ const w=l.replace(/[^A-Za-z ]/g,'').trim();
    return w&&!/^(dear|hi|hello|hey)\b/i.test(w)&&!/^\{\{?[^}]*\}?\}?,?$/.test(l)&&!(w===w.toUpperCase()&&w.length<30)&&!/^CTA\b/i.test(w); });   // not the greeting, not a "WATCH VIDEO 👆" banner
  let t=(lines[0]||'').replace(/\*+/g,'').replace(/\s+/g,' ');
  if(!t&&s.name) t=s.name.replace(/_/g,' ');
  if(!t&&s.note) t=s.note.replace(/[{}]/g,'').replace(/\b(creative|video|image)?\s*to\s+(make|create)\s*:?/ig,'$1').replace(/\s+/g,' ').replace(/^[\s:]+/,'').trim();
  t=t||'(no text yet)';
  return t.charAt(0).toUpperCase()+t.slice(1); }
function watButtons(s){ const m=String(s.text||'').match(/CTA\s*[-–—:]+\s*(.+)$/im); return m?m[1].trim():''; }
function watIsPlan(s){ return !s.name&&!s.text; }
function watIsSkip(s){ return /^skip$/i.test(String(s.status||'')); }

function watProj(){ const P=WAT_DATA.projects; return P.filter(function(x){ return x.key===WAT_PROJ; })[0]||P[0]; }
// the message without its "CTA - ..." line (those become the buttons under the bubble)
function watBody(s){ return String(s.text||'').replace(/\n?\s*CTA\s*[-–—:]+.*$/im,'').trim(); }
function watBtnList(s){ const b=watButtons(s); if(!b) return []; return b.replace(/[👇👆.\s]+$/u,'').split(/\s*(?:&|,|\band\b)\s*/i).map(function(x){ return x.trim(); }).filter(Boolean); }
// the picture / video / PDF exactly where WhatsApp puts it: inside the bubble, above the text
function watMedia(s){
  const u=[s.attach].concat((s.preview||[]).filter(function(x){ return !/^assets\//.test(x); })).filter(Boolean)[0];
  if(!u) return '';
  if(/\.(mp4|mov|webm)(\?|$)/i.test(u)) return '<div class="mm"><video src="'+esc(u)+'#t=0.5" controls preload="metadata" playsinline></video></div>';
  if(/\.pdf(\?|$)/i.test(u)) return '<a class="wat-pdf" href="'+esc(u)+'" target="_blank" rel="noopener"><i class="fa-solid fa-file-pdf"></i>'+esc(decodeURIComponent(u.split('/').pop().replace(/\+/g,' ')))+'</a>';
  return '<div class="mm"><img src="'+esc(u)+'" alt="" loading="lazy"></div>'; }
function watLook(s){
  return '<div class="wat-look"><div class="wat-bub">'+watMedia(s)
    +'<div class="wat-txt">'+(watBody(s)?esc(watBody(s)):'<i style="color:#8696a0">No message written yet</i>')+'</div><div class="wat-tm">10:30</div>'
    +watBtnList(s).map(function(b){ return '<div class="wat-btn"><i class="fa-solid fa-reply"></i>'+esc(b)+'</div>'; }).join('')+'</div></div>'; }
function watDetail(st,s){
  const k=watKind(s.type);
  return '<div class="wat-det"><div class="lbl">Template ID</div><div class="big">'+(s.name?esc(s.name)+'<button title="Copy" onclick="event.stopPropagation();watCopy(\''+esc(s.name)+'\')"><i class="fa-regular fa-copy"></i></button>':'<span style="color:#94a3b8;font-family:inherit;font-weight:500">Not given in the sheet</span>')+'</div>'
    +'<div class="kv"><div>Stage</div><div>'+esc(st.name)+'</div><div>Sent on</div><div>'+(s.day==null?'-':'Day '+s.day)+'</div>'
    +'<div>Kind</div><div>'+esc(k[1]||'-')+'</div>'+(s.status?'<div>Status</div><div>'+esc(s.status)+'</div>':'')+'</div></div>'; }
window.watCopy=function(t){ try{ navigator.clipboard.writeText(t); toast('Copied','ok'); }catch(_e){} };

function watTemplates(){
  const P=WAT_DATA.projects, p=watProj();
  if(!p) return '<div class="card card-pad" style="color:var(--slate)">The template sheet could not be read.</div>';
  if(WAT_STAGE>=p.stages.length) WAT_STAGE=0;
  const real=function(st){ return st.steps.filter(function(t){ return !watIsPlan(t); }); };
  let h='<div class="wat-top"><div class="wat-seg">'+P.map(function(x){ return '<button class="'+(x.key===p.key?'on':'')+'" onclick="watPick(\''+x.key+'\')">'+esc(x.label)+'</button>'; }).join('')+'</div>'
    +'</div>';
  h+='<div class="wat-journey">'+p.stages.map(function(st,i){
    const c=WAT_STAGE_COL[st.name.toLowerCase()]||'#64748b', on=i===WAT_STAGE;
    return '<button class="wat-step'+(on?' on':'')+'" style="'+(on?'border-color:'+c:'')+'" onclick="watStage('+i+')"><div class="nm"><i style="background:'+c+'"></i>'+esc(st.name)+'</div>'
      +'<div class="ct">'+real(st).length+'<small>templates</small></div></button>'; }).join('')+'</div>';
  const st=p.stages[WAT_STAGE];
  window._watRows=[];
  const row=function(key,s,title){ const k=watKind(s.type), i=window._watRows.push({p:p,st:st,s:s,title:title})-1;
    return '<div class="wat-row'+(watIsSkip(s)?' skip':'')+'" onclick="watPop('+i+')">'
      +'<div class="d">'+(s.day==null?'':'Day<b>'+s.day+'</b>')+'</div><div class="k" title="'+esc(k[1])+'"><i class="'+k[0]+'"></i></div>'
      +'<div class="t">'+esc(title||watTitle(s))+'</div>'
      +(s.name?'<div class="id">'+esc(s.name)+'</div>':'<div class="id none">'+(watIsSkip(s)?'Skipped':'No ID')+'</div>')
      +'<i class="fa-solid fa-chevron-right cv"></i></div>'; };
  let rows='';
  if(p.welcome&&WAT_STAGE===0) p.welcome.options.forEach(function(o,i){ rows+=row('w'+i,{text:o.text,day:null,type:'text',name:''},p.welcome.title+' · '+o.name.replace(/^Option\s*\d+\s*:\s*/i,'')); });
  st.steps.forEach(function(s,i){ if(!watIsPlan(s)) rows+=row('s'+i,s); });
  const todo=st.steps.filter(watIsPlan);
  if(todo.length) rows+='<div class="wat-todo"><b style="color:#475569">Still to make</b>'+todo.map(function(s){ return '<div>· '+esc(watTitle(s))+'</div>'; }).join('')+'</div>';
  return h+'<div class="wat-list">'+(rows||'<div style="padding:16px;color:var(--slate)">No templates in this stage.</div>')+'</div>';
}
window.watPick=function(k){ WAT_PROJ=k; WAT_STAGE=0; WAD_STAGE=-1; renderPage(); };
window.watStage=function(i){ WAT_STAGE=i; renderPage(); };

VIEWS.wa_templates=async function(v,seg){
  setCrumb(['Growth & Strategy','WhatsApp Templates']);
  const ti=mTab(seg,WAT_TABS.length);
  const head=WAT_CSS+mHead('fa-comments','#16a34a','WhatsApp Templates'), load=head+mTabs('wa_templates',WAT_TABS,ti)+'<div class="loader"><div class="spin"></div></div>';
  try{
    if(!WAT_DATA){ v.innerHTML=load; await watLoad(); if(PAGE!=='wa_templates') return; }
    // Templates and Deliveries need the sheet; Knocking does not
    if(!WAT_DATA&&ti<2){ v.innerHTML=head+mTabs('wa_templates',WAT_TABS,ti)+watErrBox(); return; }
    if(ti>0){
      if(!WAD){ v.innerHTML=load; await wadPrep(); if(PAGE!=='wa_templates') return; }
      const acc=ti===1?wadAccFor(watProj().label):((WAD.acc||[]).filter(function(a){ return /ananta/i.test(a.name); })[0]||null);
      if(acc&&!WAD.byAcc[acc.id]){ v.innerHTML=load; await wadLoadAcc(acc.id); if(PAGE!=='wa_templates') return; }
    }
    const body=ti===0?watTemplates():ti===1?watDeliveries():watKnocking();
    v.innerHTML=head+mTabs('wa_templates',WAT_TABS,ti)+body;
    if(ti===1) wadDrawChart();
    // while Templates or Knocking is open, Deliveries' figures load in the background, so the tab opens at once
    if(ti!==1&&WAT_DATA) setTimeout(function(){ wadPrep().then(function(){ const a=wadAccFor(watProj().label); if(a) return wadLoadAcc(a.id); }).catch(function(){}); },300);
  }catch(e){
    v.innerHTML=head+mTabs('wa_templates',WAT_TABS,ti)+'<div class="card card-pad" style="color:#b91c1c;font-size:13.5px"><i class="fa-solid fa-triangle-exclamation"></i> This tab could not be shown: '+esc(String((e&&e.message)||e))+'. <a href="javascript:void(0)" onclick="WAD=null;renderPage()">Try again</a></div>';
    try{ console.error('wa_templates',e); }catch(_e){}
  }
};
// one shared load of the account list, however many tabs ask for it at once
let WAD_P=null;
function wadPrep(){ if(WAD) return Promise.resolve(); if(!WAD_P) WAD_P=wadLoad().finally(function(){ WAD_P=null; }); return WAD_P; }

/* THE POPUP (17 Nov 2026, Ayush, second version: "like the one before when it was on the right - the green top with
   the project name, status and then its level, then the look, and in the bottom left the Id - the bigger the better").
   A WhatsApp chat as large as the screen allows: green bar (project, status, number / stage and day), the message in its
   bubble with its picture, video or PDF and its reply buttons, and the template ID under it on the left. The whole popup
   grows with the message - nothing scrolls inside it. On Deliveries its figures follow under the chat. */
window.watPop=function(i){
  const o=(window._watRows||[])[i]; if(!o) return;
  const p=o.p, st=o.st, s=o.s, mt=(o.meta&&o.meta[0])||null;
  // the WhatsApp number of the account this template lives in (Meta's copy of it)
  const accs=(((typeof WAD!=='undefined'&&WAD&&WAD.acc)||(typeof KN!=='undefined'&&KN&&KN.acc))||[]).filter(function(a){ return mt?a.id===mt.waba_id:false; });
  const nums=[]; accs.forEach(function(a){ (a.phones||[]).forEach(function(ph){ if(ph.display_phone_number) nums.push(ph.display_phone_number); }); });
  const cap=function(x){ x=String(x||''); return x.charAt(0).toUpperCase()+x.slice(1).toLowerCase(); };
  const status=[s.status?cap(s.status):'', mt&&mt.status?'Meta '+cap(mt.status):''].filter(Boolean).join(' · ');
  const col=WAT_STAGE_COL[String(st.name||'').toLowerCase()]||'#25d366';
  let stats='';
  if(o.m){ const m=o.m, c=function(l,v,pc,cl){ return '<div class="wpp-s"><div style="color:'+cl+'">'+l+'</div><b>'+v+'</b><small>'+(pc||'&nbsp;')+'</small></div>'; };
    stats='<div class="wpp-foot"><div class="wpp-lbl">'+esc(fmtDate(o.range.s))+(o.range.s!==o.range.e?' – '+esc(fmtDate(o.range.e)):'')+'</div><div class="wpp-stats">'
      +c('Sent',wadN(m.sent),'','#64748b')+c('Delivered',wadN(m.delivered),wadPct(m.delivered,m.sent),'#2563eb')+c('Read',wadN(m.read),wadPct(m.read,m.delivered),'#16a34a')
      +c('Clicked',wadN(m.clicked),wadPct(m.clicked,m.read),'#7c3aed')+c(o.failLabel||'Failed',o.tracksFail?wadN(m.failed):'NA',o.failLabel?wadPct(m.failed,m.sent):'','#dc2626')+'</div>'
      +(o.btns&&o.btns.length?'<div class="wpp-lbl" style="margin-top:14px">Button clicks</div><div class="kn-b" style="display:flex;flex-wrap:wrap;gap:6px">'+o.btns.map(function(b){ return /PHONE/i.test(b.type)?'<span style="border:1px solid var(--line);background:#f8fafc;color:#94a3b8;border-radius:999px;padding:4px 11px;font-size:12.5px">'+esc(b.text)+' · not counted by Meta</span>':'<span style="border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:999px;padding:4px 11px;font-size:12.5px;font-weight:600">'+esc(b.text)+' · '+wadN((o.btnCount||{})[b.text]||0)+'</span>'; }).join('')+'</div>':'')
      +(Object.keys(m.reasons).length?'<div class="wpp-lbl" style="margin-top:14px">Why it failed</div>'+Object.keys(m.reasons).sort(function(a,b){ return m.reasons[b]-m.reasons[a]; }).map(function(w){ return '<div class="wpp-r"><span>'+esc(w)+'</span><b>'+m.reasons[w]+'</b></div>'; }).join(''):'')+'</div>'; }
  openModal('<style>'
    +'.overlay:has(.wpp-m){overflow:hidden;align-items:center;padding:12px}'
    +'.modal.wpp-m{max-width:min(720px,96vw)!important;width:min(720px,96vw)!important;max-height:none;overflow:hidden;border-radius:20px;margin:auto}'
    +'.wpph{background:#075e54;color:#fff;padding:16px 18px;display:flex;align-items:center;gap:13px}'
    +'.wpph .av{width:46px;height:46px;border-radius:50%;background:#25d366;display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0}'
    +'.wpph .nm{font-size:18px;font-weight:700;line-height:1.2}.wpph .su{font-size:13px;opacity:.85;margin-top:3px}'
    +'.wpph .lv{margin-left:auto;text-align:right;flex-shrink:0}.wpph .lv b{display:inline-block;background:rgba(255,255,255,.16);border-left:4px solid '+col+';border-radius:8px;padding:6px 11px;font-size:14px;font-weight:700;white-space:nowrap}'
    +'.wpph .x{font-size:28px;line-height:1;cursor:pointer;opacity:.85;margin-left:4px;flex-shrink:0}.wpph .x:hover{opacity:1}'
    +'.wppc{background:#efeae2;padding:24px 22px 16px}'
    +'.wppc .wat-look{background:transparent;padding:0;width:100%;border-radius:0}'
    +'.wppc .wat-bub{border-radius:0 14px 14px 14px;box-shadow:0 1px 2px rgba(0,0,0,.13)}'
    +'.wppc .wat-bub .mm{padding:5px 5px 0}.wppc .wat-bub img,.wppc .wat-bub video{border-radius:10px}'
    +'.wppc .wat-txt{font-size:16px;line-height:1.5;padding:12px 14px 4px}.wppc .wat-tm{font-size:12px}.wppc .wat-btn{font-size:16px;padding:13px}'
    +'.wppid{display:flex;align-items:center;gap:8px;margin-top:14px;flex-wrap:wrap}'
    +'.wppid code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;font-weight:700;color:#111b21;background:rgba(255,255,255,.75);border-radius:8px;padding:6px 10px;word-break:break-all}'
    +'.wppid button{border:0;background:rgba(255,255,255,.75);border-radius:8px;padding:7px 10px;cursor:pointer;color:#54656f}'
    +'.wppid .no{color:#667781;font-size:13px}'
    +'.wpp-foot{padding:16px 20px 20px;background:#fff}'
    +'.wpp-lbl{font-size:11px;font-weight:600;color:var(--slate);text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px}'
    +'.wpp-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}'
    +'.wpp-s{background:#f8fafc;border:1px solid var(--line);border-radius:10px;padding:9px 10px;font-size:11.5px;font-weight:600}.wpp-s b{display:block;font-size:18px;color:#0f172a;margin-top:2px}.wpp-s small{color:var(--slate);font-weight:500}'
    +'.wpp-r{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid #f1f5f9;font-size:13.5px}'
    +'@media(max-width:600px){.wpph{padding:13px 14px;gap:10px}.wpph .av{width:38px;height:38px;font-size:21px}.wpph .nm{font-size:16px}.wpph .lv b{font-size:12.5px;padding:5px 8px}'
    +'.wppc{padding:16px 12px 12px}.wpp-stats{grid-template-columns:repeat(3,minmax(0,1fr))}}'
    +'</style>'
    +'<div class="wpph"><div class="av"><i class="fa-brands fa-whatsapp"></i></div>'
    +'<div style="min-width:0"><div class="nm">'+esc(p.label)+'</div><div class="su">'+esc([status,nums.join(', ')].filter(Boolean).join(' · ')||'Template')+'</div></div>'
    +'<div class="lv"><b>'+esc(st.name)+(s.day!=null?' · Day '+s.day:'')+'</b></div><span class="x" onclick="closeModal()" title="Close">&times;</span></div>'
    +'<div class="wppc">'+watLook(s)
    +'<div class="wppid">'+(s.name?'<code>'+esc(s.name)+'</code><button title="Copy the template ID" onclick="watCopy(\''+esc(s.name)+'\')"><i class="fa-regular fa-copy"></i></button>':'<span class="no">No template ID in the sheet</span>')+'</div></div>'
    +stats,'wpp-m');
  watFit();
  const med=document.querySelectorAll('.modal.wpp-m .wat-bub img,.modal.wpp-m .wat-bub video');
  med.forEach(function(x){ x.addEventListener(x.tagName==='IMG'?'load':'loadedmetadata',watFit); });
};
/* NO SCROLL, AS BIG AS IT FITS (17 Nov 2026, Ayush: "the WhatsApp popup should not have scroll at all - the biggest it can get,
   not so big it becomes scrollable"). The popup is drawn at its full size (up to 720 px wide); if it is taller than the
   window, the picture / video is made shorter first (never below 200 px, shown whole), and if it still does not fit, the
   whole popup is scaled down to the window. Done again when the picture arrives and when the window changes size. */
function watFit(){
  const m=document.querySelector('.modal.wpp-m'); if(!m) return;
  m.style.zoom='';
  const med=m.querySelectorAll('.wat-bub img,.wat-bub video');
  med.forEach(function(x){ x.style.maxHeight=''; });
  const avail=window.innerHeight-24;
  let over=m.scrollHeight-avail;
  if(over>0&&med.length){ const h=med[0].getBoundingClientRect().height;
    med.forEach(function(x){ x.style.maxHeight=Math.max(200,h-over)+'px'; x.style.objectFit='contain'; x.style.background='#f0f2f5'; }); }
  over=m.scrollHeight-avail;
  if(over>0) m.style.zoom=String(Math.max(0.4,avail/m.scrollHeight));
}
if(!window._watFitWired){ window._watFitWired=true; window.addEventListener('resize',function(){ watFit(); }); }

/* ---------------- DELIVERIES + KNOCKING (17-18 Nov 2026) ----------------
   18 Nov 2026, Ayush: Deliveries "takes too much time to open"; "why is Failed NA"; range buttons Yesterday / Last 7 / 14 /
   30 days / Custom, no loose date picker, Custom opens a calendar like Accountability's task date picker (without the
   frequency); "the bar graph more detailed, not such thin bars"; the green date chip after clicking a bar removed;
   "Ananta's graph - why negative space if there is no data for most of the period" (the chart now starts at the first
   day with data); Knocking "not segregated, row-wise one by one".
   SPEED: only the open project's WhatsApp account is read (its templates' daily rows and contents), every page at once,
   and kept for the visit - before, all 8,000+ rows of every account were read one page after another (~5 s).
   NOT DELIVERED: Meta's template analytics have no "failed" figure; failures with their reason reach only the number's
   webhook, which is the sending tool's, not JainE's. "Not delivered" = sent - delivered (failed, or not delivered yet).
   Figures: camp.wa_template_daily (Meta template analytics, UTC days, read nightly by wa-deliveries-sync). */
let WAD=null, WAD_STAGE=-1, KN=null;
const WAD_Y0=new Date().getFullYear()+'-01-01';
const WAD_R={q:'30',from:null,to:null,day:null};
const WCAL={open:false,y:0,m:0,a:null,b:null};
const WAD_CSS='<style>'
+'.wad-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 14px;position:relative}'
+'.wad-q{display:inline-flex;background:#f1f5f9;border-radius:10px;padding:3px;gap:2px;max-width:100%;overflow-x:auto;scrollbar-width:none}.wad-q::-webkit-scrollbar{display:none}'
+'.wad-q button{border:0;background:transparent;border-radius:8px;padding:7px 13px;font-size:12.5px;font-weight:600;color:#475569;cursor:pointer;font-family:inherit;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}'
+'.wad-q button.on{background:#fff;color:#0f172a;box-shadow:0 1px 3px rgba(15,23,42,.12)}'
+'.wad-rng{font-size:12.5px;color:var(--slate)}'
+'.wcal{position:absolute;top:44px;left:0;z-index:40;width:300px;max-width:94vw;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 30px rgba(16,24,40,.16);overflow:hidden}'
+'.wcal-main{padding:10px 12px 12px}'
+'.wcal-head{display:flex;align-items:center;gap:2px;margin-bottom:4px}.wcal-title{flex:1;text-align:center;font-size:12.5px;font-weight:700}'
+'.wcal-nav{width:25px;height:25px;display:flex;align-items:center;justify-content:center;border:0;border-radius:7px;background:transparent;color:var(--slate);cursor:pointer;font-size:11px}.wcal-nav:hover{background:#eef2ff;color:#1d4ed8}'
+'.wcal-dow{display:grid;grid-template-columns:repeat(7,1fr)}.wcal-dow span{text-align:center;font-size:10px;font-weight:700;color:#94a3b8;padding-bottom:2px}'
+'.wcal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px}'
+'.wcal-day{height:30px;border:0;border-radius:7px;background:transparent;font:inherit;font-size:12.5px;font-variant-numeric:tabular-nums;color:var(--ink,#0f172a);cursor:pointer;padding:0;position:relative}'
+'.wcal-day:hover:not([disabled]):not(.on){background:#eef2ff}.wcal-day.pad{visibility:hidden}.wcal-day[disabled]{color:#94a3b8;opacity:.35;cursor:default}'
+'.wcal-day.in{background:#eff4ff;color:#1e40af;border-radius:0}.wcal-day.on{background:#1d4ed8;color:#fff;font-weight:700}'
+'.wcal-day.today:not(.on)::after{content:"";position:absolute;left:50%;bottom:4px;width:3px;height:3px;margin-left:-1.5px;border-radius:50%;background:#1d4ed8}'
+'.wcal-says{border-top:1px solid var(--line);background:#f8fafc;padding:9px 12px;font-size:11.5px;color:var(--slate);min-height:20px}.wcal-says b{color:#0f172a}'
+'.wcal-foot{display:flex;align-items:center;gap:10px;border-top:1px solid var(--line);padding:9px 12px}'
+'.wcal-foot .clr{border:0;background:transparent;padding:0;font:inherit;font-size:12px;color:var(--slate);cursor:pointer}.wcal-foot .clr:hover{color:#dc2626}'
+'.wcal-foot .done{margin-left:auto;height:31px;padding:0 17px;border:0;border-radius:8px;background:#1d4ed8;color:#fff;font:inherit;font-size:12px;font-weight:600;cursor:pointer}.wcal-foot .done[disabled]{opacity:.45;cursor:not-allowed}'
+'.wad-cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:0 0 14px}.wad-cards.c4{grid-template-columns:repeat(4,minmax(0,1fr))}'
+'.wad-card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:13px 15px}'
+'.wad-card .l{font-size:12px;color:var(--slate);font-weight:600;display:flex;align-items:center;gap:6px}.wad-card .l i{width:8px;height:8px;border-radius:50%}'
+'.wad-card .v{font-size:24px;font-weight:700;color:#0f172a;margin-top:5px;line-height:1.1}.wad-card .p{font-size:12px;color:var(--slate);margin-top:2px}'
+'.wad-chart{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px 10px;margin:0 0 14px}'
+'.wad-chart .hd{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--slate);margin:0 0 6px}.wad-chart .hd b{color:#0f172a;font-size:13px}'
+'.wad-chart .cv{position:relative;height:280px}'
+'.wad-stg{display:flex;gap:6px;overflow-x:auto;margin:0 0 10px;scrollbar-width:none}.wad-stg::-webkit-scrollbar{display:none}'
+'.wad-stg button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:7px 14px;font-size:13px;font-weight:600;color:#475569;cursor:pointer;white-space:nowrap;font-family:inherit}'
+'.wad-stg button.on{background:#0f172a;border-color:#0f172a;color:#fff}'
+'.wad-row{display:grid;grid-template-columns:54px 40px minmax(0,1fr) repeat(5,minmax(66px,auto)) 16px;gap:12px;align-items:center;padding:10px 16px;border-top:1px solid #f1f5f9;cursor:pointer}'
+'.wad-row.kn{grid-template-columns:118px minmax(0,1fr) repeat(4,minmax(70px,auto)) 16px}'
+'.wad-row:hover{background:#f8fafc}'
+'.wad-row.h{cursor:default;background:#f8fafc;font-size:11px;font-weight:600;color:var(--slate);text-transform:uppercase;letter-spacing:.03em;padding:9px 16px;border-top:0}'
+'.wad-row .th{width:40px;height:40px;border-radius:8px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;color:#94a3b8;overflow:hidden}.wad-row .th img{width:100%;height:100%;object-fit:cover}'
+'.wad-row .n{text-align:right;font-variant-numeric:tabular-nums;font-size:13px;color:#0f172a}.wad-row .n small{display:block;font-size:10.5px;color:var(--slate)}.wad-row .n.bad{color:#b91c1c}'
+'.wad-row .t{font-size:13.5px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
+'.wad-row .id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:#475569;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
+'.wad-row .cv{color:#94a3b8;font-size:12px}'
+'.wad-path{font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:6px;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}.wad-path i{width:8px;height:8px;border-radius:50%}'
+'.wad-btns{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}.wad-btns span{border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;white-space:nowrap}.wad-btns span.off{border-color:var(--line);background:#f8fafc;color:#94a3b8;font-weight:500}'
+'.wad-empty{background:#fff;border:1px solid var(--line);border-radius:14px;padding:22px;color:#475569;font-size:13.5px;display:flex;gap:12px;align-items:flex-start}'
+'@media(max-width:900px){.wad-cards{grid-template-columns:repeat(3,minmax(0,1fr))}}'
+'@media(max-width:720px){'
+'.wad-cards,.wad-cards.c4{grid-template-columns:repeat(2,minmax(0,1fr))}.wad-card .v{font-size:20px}.wad-chart .cv{height:220px}'
+'.wad-row,.wad-row.kn{grid-template-columns:40px minmax(0,1fr) 16px;grid-template-areas:"th t cv" "th nums cv";gap:4px 10px;padding:10px 12px}'
+'.wad-row .th,.wad-row .pth{grid-area:th}.wad-row .d{display:none}.wad-row>div.tt{grid-area:t;min-width:0}.wad-row .cv{grid-area:cv}'
+'.wad-row .nums{grid-area:nums;display:flex;gap:12px;flex-wrap:wrap}.wad-row .n{text-align:left;font-size:12px}.wad-row .n::before{content:attr(data-l) " ";color:var(--slate)}.wad-row .n small{display:inline;margin-left:3px}.wad-row.h{display:none}'
+'.wad-row.kn .pth .wad-path span{display:none}'
+'}'
+'@media(min-width:721px){.wad-row .nums{display:contents}}'
+'</style>';

function wadIso(d){ return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10); }
function wadAdd(iso,n){ return wadIso(new Date(new Date(iso+'T00:00:00').getTime()+n*864e5)); }
function wadN(n){ return n==null?'NA':Number(n).toLocaleString('en-IN'); }
function wadPct(a,b){ return b?Math.round(a/b*1000)/10+'%':''; }
// the chosen range: Yesterday / last 7, 14, 30 days (up to yesterday - today is only part-read in the morning) / custom
function wadRange0(){
  const today=wadIso(new Date()), y=wadAdd(today,-1);
  if(WAD_R.q==='y') return {s:y,e:y};
  if(WAD_R.q==='custom'&&WAD_R.from) return {s:WAD_R.from,e:WAD_R.to||WAD_R.from};
  const n=+WAD_R.q||30; return {s:wadAdd(today,-n),e:y};
}
function wadRange(){ return WAD_R.day?{s:WAD_R.day,e:WAD_R.day}:wadRange0(); }
function wadShort(iso){ return new Date(iso+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}); }
function wadBar(){
  const r=wadRange0();
  let h='<div class="wad-bar"><div class="wad-q">'+[['y','Yesterday'],['7','Last 7 days'],['14','Last 14 days'],['30','Last 30 days']].map(function(o){ return '<button class="'+(WAD_R.q===o[0]?'on':'')+'" onclick="wadQ(\''+o[0]+'\')">'+o[1]+'</button>'; }).join('')
    +'<button class="'+(WAD_R.q==='custom'?'on':'')+'" onclick="event.stopPropagation();wcalOpen()"><i class="fa-regular fa-calendar"></i>'+(WAD_R.q==='custom'&&WAD_R.from?esc(wadShort(r.s))+(r.s!==r.e?' – '+esc(wadShort(r.e)):''):'Custom')+'</button></div>'
    +'<span class="wad-rng">'+esc(fmtDate(r.s))+(r.s!==r.e?' – '+esc(fmtDate(r.e)):'')+'</span>';
  if(WCAL.open) h+=wcalHtml();
  return h+'</div>';
}
/* THE CUSTOM CALENDAR - Accountability's task date picker look (month, arrows, Mon-Sun grid, today's dot, Clear / Done),
   without the frequency rail: first click = from, second click = to. */
const WCAL_MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
function wcalHtml(){
  const y=WCAL.y, m=WCAL.m, first=(new Date(y,m,1).getDay()+6)%7, n=new Date(y,m+1,0).getDate(), today=wadIso(new Date());
  const a=WCAL.a, b=WCAL.b||WCAL.a;
  let g='';
  for(let i=0;i<first;i++) g+='<button type="button" class="wcal-day pad" disabled></button>';
  for(let d=1;d<=n;d++){ const iso=y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0'), off=iso>today||iso<WAD_Y0;
    const on=iso===a||iso===b, inr=a&&b&&iso>a&&iso<b;
    g+='<button type="button" class="wcal-day'+(on?' on':inr?' in':'')+(iso===today?' today':'')+'"'+(off?' disabled':' onclick="event.stopPropagation();wcalPick(\''+iso+'\')"')+'>'+d+'</button>'; }
  const says=a?(WCAL.b?'<b>'+esc(fmtDate(a))+'</b> to <b>'+esc(fmtDate(WCAL.b))+'</b>':'From <b>'+esc(fmtDate(a))+'</b> - now pick the last day (or Done for this one day)'):'Pick the first day';
  return '<div class="wcal" onclick="event.stopPropagation()"><div class="wcal-main"><div class="wcal-head"><button type="button" class="wcal-nav" onclick="wcalMv(-1)"><i class="fa-solid fa-chevron-left"></i></button><div class="wcal-title">'+WCAL_MON[m]+' '+y+'</div><button type="button" class="wcal-nav" onclick="wcalMv(1)"><i class="fa-solid fa-chevron-right"></i></button></div>'
    +'<div class="wcal-dow">'+['Mo','Tu','We','Th','Fr','Sa','Su'].map(function(x){ return '<span>'+x+'</span>'; }).join('')+'</div><div class="wcal-grid">'+g+'</div></div>'
    +'<div class="wcal-says">'+says+'</div><div class="wcal-foot"><button type="button" class="clr" onclick="wcalClear()">Clear</button><button type="button" class="done"'+(a?'':' disabled')+' onclick="wcalDone()">Done</button></div></div>';
}
window.wcalOpen=function(){ const r=wadRange0(), d=new Date((WAD_R.q==='custom'?r.e:wadIso(new Date()))+'T00:00:00');
  WCAL.open=!WCAL.open; WCAL.y=d.getFullYear(); WCAL.m=d.getMonth(); WCAL.a=WAD_R.q==='custom'?WAD_R.from:null; WCAL.b=WAD_R.q==='custom'?WAD_R.to:null; renderPage(); };
window.wcalMv=function(n){ const d=new Date(WCAL.y,WCAL.m+n,1); WCAL.y=d.getFullYear(); WCAL.m=d.getMonth(); renderPage(); };
window.wcalPick=function(iso){ if(!WCAL.a||WCAL.b){ WCAL.a=iso; WCAL.b=null; } else if(iso<WCAL.a){ WCAL.b=WCAL.a; WCAL.a=iso; } else WCAL.b=iso; renderPage(); };
window.wcalClear=function(){ WCAL.a=null; WCAL.b=null; renderPage(); };
window.wcalDone=function(){ if(!WCAL.a) return; WAD_R.q='custom'; WAD_R.from=WCAL.a; WAD_R.to=WCAL.b||WCAL.a; WAD_R.day=null; WCAL.open=false; renderPage(); };
if(!window._wcalWired){ window._wcalWired=true; document.addEventListener('click',function(){ if(WCAL.open){ WCAL.open=false; if(PAGE==='wa_templates') renderPage(); } }); }
window.wadQ=function(q){ WAD_R.q=q; WAD_R.day=null; WCAL.open=false; renderPage(); };
window.wadStage=function(i){ WAD_STAGE=i; renderPage(); };

// ---- loading: the accounts and template list once; a project's own account's figures when it is first opened ----
async function wadPages(q){   // four pages at a time until one comes back short
  let out=[]; for(let f=0;;f+=4000){ const got=await Promise.all([0,1,2,3].map(function(i){ return q().range(f+i*1000,f+i*1000+999); }));
    for(const g of got){ out=out.concat(g.data||[]); if(g.error||!g.data||g.data.length<1000) return out; } }
}
async function wadLoad(){
  const C=sb.schema('camp');
  const got=await Promise.all([
    C.from('wa_sync_state').select('last_sync_at').eq('id',1).maybeSingle().then(function(r){ return r.error?{missing:true}:(r.data||{}); },function(){ return {missing:true}; }),
    C.from('wa_accounts').select('id,name,phones').then(function(r){ return r.data||[]; },function(){ return []; }),
    C.from('wa_templates').select('id,waba_id,name,language,status,category,quality,rejected_reason').order('id').range(0,1999).then(function(r){ return r.data||[]; },function(){ return []; })
  ]);
  WAD={state:got[0],acc:got[1],tpl:got[2],byAcc:{}};
}
const WAD_ACC_P={};
function wadLoadAcc(accId){   // one load per account, even when the background load and a click ask together
  if(!WAD||!accId||WAD.byAcc[accId]) return Promise.resolve();
  if(!WAD_ACC_P[accId]) WAD_ACC_P[accId]=wadLoadAcc0(accId).finally(function(){ delete WAD_ACC_P[accId]; });
  return WAD_ACC_P[accId];
}
async function wadLoadAcc0(accId){
  if(!WAD||!accId||WAD.byAcc[accId]) return;
  const C=sb.schema('camp'), ids=WAD.tpl.filter(function(t){ return t.waba_id===accId; }).map(function(t){ return t.id; });
  const parts=[]; for(let i=0;i<ids.length;i+=60) parts.push(ids.slice(i,i+60));
  const res=await Promise.all([
    C.from('wa_templates').select('id,components').eq('waba_id',accId).then(function(r){ return r.data||[]; },function(){ return []; })
  ].concat(parts.map(function(p){ return wadPages(function(){ return C.from('wa_template_daily').select('template_id,day,sent,delivered,read,clicked,clicks').in('template_id',p).gte('day',WAD_Y0).order('day').order('template_id'); }); })));
  const comp={}; (res[0]||[]).forEach(function(x){ comp[x.id]=x.components; });
  WAD.tpl.forEach(function(t){ if(t.waba_id===accId) t.components=comp[t.id]||null; });
  WAD.byAcc[accId]={daily:[].concat.apply([],res.slice(1))};
}
function wadAccFor(label){ const pn=function(x){ return String(x||'').toLowerCase().replace(/dream|by jain group/g,'').replace(/[^a-z0-9]/g,''); };
  return ((WAD&&WAD.acc)||[]).filter(function(a){ return pn(a.name)===pn(label); })[0]||null; }
function wadNoData(){ return '<div class="wad-empty"><i class="fa-brands fa-whatsapp" style="font-size:22px;color:#16a34a"></i><div><b style="color:#0f172a">No WhatsApp figures here yet.</b><br>They are read from Meta every morning at 06:15 IST.</div></div>'; }
function knBranch(n){ n=String(n).toLowerCase(); return /_yes_/.test(n)?1:/_no_/.test(n)?2:/_silent_/.test(n)?3:0; }
function knStep(n){ const m=String(n).match(/q(\d+)/i); return m?+m[1]:0; }
function knLabel(n){ const b=['First knock','Said Yes','Said No','No reply'][knBranch(n)], q=knStep(n); return knBranch(n)===0?'First knock':b+(q?' · Q'+q:''); }
function knBody(t){ const c=(t.components||[]).filter(function(x){ return x.type==='BODY'; })[0]; return String((c&&c.text)||''); }
function knButtons(t){ const c=(t.components||[]).filter(function(x){ return x.type==='BUTTONS'; })[0]; return ((c&&c.buttons)||[]).map(function(b){ return {text:b.text,type:b.type}; }); }
function wadChips(btns,cnt){ return btns.length?'<div class="wad-btns">'+btns.map(function(b){ return /PHONE/i.test(b.type)?'<span class="off" title="Meta does not count clicks on call buttons">'+esc(b.text)+' · not counted</span>':'<span>'+esc(b.text)+' · '+wadN((cnt||{})[b.text]||0)+'</span>'; }).join('')+'</div>':''; }
function wadCard(col,l,v,pc,ttl){ return '<div class="wad-card"'+(ttl?' title="'+esc(ttl)+'"':'')+'><div class="l"><i style="background:'+col+'"></i>'+l+'</div><div class="v">'+v+'</div><div class="p">'+(pc||'&nbsp;')+'</div></div>'; }
const WAD_ND='Meta does not report failed messages - this is sent minus delivered (failed, or not delivered yet)';
// sums per template (in the range) and per day (for the chart) of the chosen templates
function wadSum(daily,ids,r){
  const per={}, perDay={}, tot={sent:0,delivered:0,read:0,clicked:0}, r0=wadRange0();
  daily.forEach(function(x){ if(!ids[x.template_id]) return;
    if(x.day>=r0.s&&x.day<=r0.e){ const dd=perDay[x.day]=perDay[x.day]||{sent:0,delivered:0,read:0}; dd.sent+=+x.sent||0; dd.delivered+=+x.delivered||0; dd.read+=+x.read||0; }
    if(x.day<r.s||x.day>r.e) return;
    const m=per[x.template_id]=per[x.template_id]||{sent:0,delivered:0,read:0,clicked:0,btn:{}};
    ['sent','delivered','read','clicked'].forEach(function(k){ m[k]+=+x[k]||0; tot[k]+=+x[k]||0; });
    (x.clicks||[]).forEach(function(c){ const b=c.button_content||c.type||'Button'; m.btn[b]=(m.btn[b]||0)+(+c.count||0); }); });
  return {per:per,perDay:perDay,tot:tot};
}

function watDeliveries(){
  const P=WAT_DATA.projects, p=watProj();
  if(!WAD) return '<div class="loader"><div class="spin"></div></div>';
  let h=WAD_CSS+'<div class="wat-top"><div class="wat-seg">'+P.map(function(x){ return '<button class="'+(x.key===p.key?'on':'')+'" onclick="watPick(\''+x.key+'\')">'+esc(x.label)+'</button>'; }).join('')+'</div></div>';
  const acc=wadAccFor(p.label);
  if(WAD.state.missing||!acc||!WAD.byAcc[acc.id]) return h+wadNoData();
  h+=wadBar();
  const r=wadRange(), D=WAD.byAcc[acc.id].daily;
  // the sheet's templates of this project, matched by name to its own account's templates
  const byName={}; WAD.tpl.forEach(function(t){ if(t.waba_id===acc.id) byName[t.name]=t; });
  const stages=p.stages.map(function(st){ return {name:st.name,steps:st.steps.filter(function(s){ return s.name; })}; }).filter(function(st){ return st.steps.length; });
  if(WAD_STAGE>=stages.length) WAD_STAGE=-1;
  const shown=WAD_STAGE===-1?stages:[stages[WAD_STAGE]];
  const ids={}; shown.forEach(function(st){ st.steps.forEach(function(s){ const t=byName[s.name]; if(t) ids[t.id]=1; }); });
  const S=wadSum(D,ids,r), tot=S.tot, nd=Math.max(0,tot.sent-tot.delivered);
  h+='<div class="wad-cards">'+wadCard('#64748b','Sent',wadN(tot.sent))+wadCard('#2563eb','Delivered',wadN(tot.delivered),wadPct(tot.delivered,tot.sent)+(tot.sent?' of sent':''))
    +wadCard('#16a34a','Read',wadN(tot.read),wadPct(tot.read,tot.delivered)+(tot.delivered?' of delivered':''))+wadCard('#7c3aed','Clicked',wadN(tot.clicked),wadPct(tot.clicked,tot.read)+(tot.read?' of read':''))
    +wadCard('#dc2626','Not delivered',wadN(nd),wadPct(nd,tot.sent)+(tot.sent?' of sent':''),WAD_ND)+'</div>';
  h+=wadChartBox(S.perDay);
  h+='<div class="wad-stg"><button class="'+(WAD_STAGE===-1?'on':'')+'" onclick="wadStage(-1)">All stages</button>'+stages.map(function(st,i){ return '<button class="'+(WAD_STAGE===i?'on':'')+'" onclick="wadStage('+i+')">'+esc(st.name)+'</button>'; }).join('')+'</div>';
  window._watRows=[];
  let rows='<div class="wad-row h"><div>Day</div><div></div><div>Template</div><div style="text-align:right">Sent</div><div style="text-align:right">Delivered</div><div style="text-align:right">Read</div><div style="text-align:right">Clicked</div><div style="text-align:right" title="'+esc(WAD_ND)+'">Not delivered</div><div></div></div>';
  shown.forEach(function(st){
    if(WAD_STAGE===-1) rows+='<div class="wad-row h" style="display:block;background:#fff;color:#0f172a;font-size:12px;border-top:1px solid var(--line)">'+esc(st.name)+'</div>';
    st.steps.forEach(function(s){ const t=byName[s.name], m=(t&&S.per[t.id])||{sent:0,delivered:0,read:0,clicked:0,btn:{}}, btns=t?knButtons(t):[], nd1=Math.max(0,m.sent-m.delivered);
      const pic=[s.attach].concat(s.preview||[]).filter(function(u){ return u&&/\.(jpe?g|png|webp|gif)(\?|$)/i.test(u); })[0], k=watKind(s.type);
      const pi=window._watRows.push({p:p,st:st,s:s,m:{sent:m.sent,delivered:m.delivered,read:m.read,clicked:m.clicked,failed:nd1,reasons:{}},meta:t?[t]:[],tracksFail:true,failLabel:'Not delivered',range:r,btns:btns,btnCount:m.btn})-1;
      rows+='<div class="wad-row" onclick="watPop('+pi+')"><div class="d" style="font-size:12px;color:var(--slate);font-weight:600">'+(s.day==null?'':'Day <b style="color:#0f172a;font-size:15px">'+s.day+'</b>')+'</div>'
        +'<div class="th">'+(pic?'<img src="'+esc(pic)+'" alt="" loading="lazy">':'<i class="'+k[0]+'"></i>')+'</div>'
        +'<div class="tt"><div class="t">'+esc(watTitle(s))+'</div><div class="id">'+esc(s.name)+(t?'':' · not found on this number')+'</div>'+wadChips(btns,m.btn)+'</div>'
        +'<div class="nums"><div class="n" data-l="Sent">'+wadN(m.sent)+'</div><div class="n" data-l="Delivered">'+wadN(m.delivered)+'<small>'+wadPct(m.delivered,m.sent)+'</small></div><div class="n" data-l="Read">'+wadN(m.read)+'<small>'+wadPct(m.read,m.delivered)+'</small></div>'
        +'<div class="n" data-l="Clicked">'+wadN(m.clicked)+'<small>'+wadPct(m.clicked,m.read)+'</small></div><div class="n'+(nd1?' bad':'')+'" data-l="Not delivered">'+wadN(nd1)+'</div></div>'
        +'<i class="fa-solid fa-chevron-right cv"></i></div>';
    });
  });
  return h+'<div class="wat-list">'+rows+'</div>';
}

/* THE CHART (18 Nov 2026): Chart.js grouped bars - Sent, Delivered, Read per day (per week past 45 days), with axes, values
   on hover and wide bars; it starts at the first day that has figures, so a project that began sending late (Ananta, mid
   November) is not a long empty strip. A click on a bar shows that day; the range buttons go back. */
let WAD_CH=null;
function wadChartBox(perDay){
  const r0=wadRange0(), days=[]; for(let d=r0.s; d<=r0.e; d=wadAdd(d,1)) days.push(d);
  const firstData=days.findIndex(function(d){ const x=perDay[d]; return x&&(x.sent||x.delivered||x.read); });
  if(firstData<0){ window._wadChart=null; return '<div class="wad-chart"><div class="hd"><b>By day</b></div><div style="padding:30px 0;text-align:center;color:var(--slate);font-size:13px">Nothing sent in this period</div></div>'; }
  const use=days.slice(firstData), wk=use.length>45, B=[];
  use.forEach(function(d,i){ if(!wk||i%7===0) B.push({k:d,days:[],sent:0,delivered:0,read:0}); const b=B[B.length-1]; b.days.push(d); const x=perDay[d]; if(x){ b.sent+=x.sent; b.delivered+=x.delivered; b.read+=x.read; } });
  window._wadChart={B:B,wk:wk};
  return '<div class="wad-chart"><div class="hd"><b>'+(wk?'By week':'By day')+'</b><span>'+esc(fmtDate(use[0]))+' – '+esc(fmtDate(use[use.length-1]))+(firstData>0?' · from the first day with messages':'')+'</span><span style="margin-left:auto">Click a bar for that day</span></div><div class="cv"><canvas id="wadCanvas"></canvas></div></div>';
}
function wadDrawChart(){
  const cv=document.getElementById('wadCanvas'); if(WAD_CH){ try{ WAD_CH.destroy(); }catch(_e){} WAD_CH=null; }
  if(!cv||!window._wadChart||typeof Chart==='undefined') return;
  const B=window._wadChart.B, wk=window._wadChart.wk;
  const lab=B.map(function(b){ return wk?'Wk of '+wadShort(b.k):wadShort(b.k); });
  const sel=function(c){ return B.map(function(b){ return WAD_R.day&&b.days.indexOf(WAD_R.day)>-1?c[0]:(WAD_R.day?c[1]:c[0]); }); };
  WAD_CH=new Chart(cv,{type:'bar',data:{labels:lab,datasets:[
      {label:'Sent',data:B.map(function(b){ return b.sent; }),backgroundColor:sel(['#94a3b8','#cbd5e1']),borderRadius:4,maxBarThickness:28},
      {label:'Delivered',data:B.map(function(b){ return b.delivered; }),backgroundColor:sel(['#2563eb','#bfdbfe']),borderRadius:4,maxBarThickness:28},
      {label:'Read',data:B.map(function(b){ return b.read; }),backgroundColor:sel(['#16a34a','#bbf7d0']),borderRadius:4,maxBarThickness:28}]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,font:{size:11.5}}},
        tooltip:{callbacks:{title:function(it){ const b=B[it[0].dataIndex]; return wk?fmtDate(b.days[0])+' – '+fmtDate(b.days[b.days.length-1]):fmtDate(b.k); },
          label:function(c){ return ' '+c.dataset.label+': '+Number(c.raw).toLocaleString('en-IN'); }}}},
      scales:{x:{grid:{display:false},ticks:{font:{size:11},maxRotation:0,autoSkip:true,autoSkipPadding:10}},y:{beginAtZero:true,grid:{color:'#f1f5f9'},ticks:{font:{size:11},precision:0}}},
      categoryPercentage:.82,barPercentage:.92,
      onClick:function(_e,els){ if(!els.length||wk) return; const b=B[els[0].index]; WAD_R.day=WAD_R.day===b.k?null:b.k; renderPage(); }}});
}

/* ---------------- KNOCKING (17 Nov 2026; rows 18 Nov 2026 - Ayush: "not segregated on any basis, row-wise one by one") ----
   Ananta's ask_question* templates ("knocking messages") only - not in Deliveries. One full-width row each, in the order
   they run (first knock, then said Yes, said No, no reply), its path as a small tag: Sent, Delivered, Not delivered, Read
   and the clicks on every button (Meta does not count phone-call buttons). */
const KN_RE=/^ask_question/i;
function watKnocking(){
  if(!WAD) return '<div class="loader"><div class="spin"></div></div>';
  let h=WAD_CSS;
  const acc=((WAD.acc)||[]).filter(function(a){ return /ananta/i.test(a.name); })[0];
  if(WAD.state.missing||!acc||!WAD.byAcc[acc.id]) return h+wadNoData();
  h+='<div class="wat-top"><div style="font-size:15px;font-weight:700;color:#0f172a"><i class="fa-brands fa-whatsapp" style="color:#16a34a"></i> '+esc(acc.name)+' <span style="font-weight:500;color:var(--slate);font-size:13px">· knocking messages</span></div></div>';
  h+=wadBar();
  const r=wadRange(), tpl=WAD.tpl.filter(function(t){ return t.waba_id===acc.id&&KN_RE.test(t.name); });
  const ids={}; tpl.forEach(function(t){ ids[t.id]=1; });
  const S=wadSum(WAD.byAcc[acc.id].daily,ids,r), tot=S.tot, nd=Math.max(0,tot.sent-tot.delivered);
  h+='<div class="wad-cards c4">'+wadCard('#64748b','Sent',wadN(tot.sent))+wadCard('#2563eb','Delivered',wadN(tot.delivered),wadPct(tot.delivered,tot.sent)+(tot.sent?' of sent':''))
    +wadCard('#dc2626','Not delivered',wadN(nd),wadPct(nd,tot.sent)+(tot.sent?' of sent':''),WAD_ND)
    +wadCard('#16a34a','Read',wadN(tot.read),wadPct(tot.read,tot.delivered)+(tot.delivered?' of delivered':''))+'</div>';
  const cols=[['First knock','#0f172a'],['Said Yes','#16a34a'],['Said No','#dc2626'],['No reply','#d97706']];
  const ordered=tpl.slice().sort(function(a,b){ return knBranch(a.name)-knBranch(b.name)||knStep(a.name)-knStep(b.name)||a.name.localeCompare(b.name); });
  window._watRows=[];
  let rows='<div class="wad-row kn h"><div>Path</div><div>Template</div><div style="text-align:right">Sent</div><div style="text-align:right">Delivered</div><div style="text-align:right" title="'+esc(WAD_ND)+'">Not delivered</div><div style="text-align:right">Read</div><div></div></div>';
  ordered.forEach(function(t){
    const c=cols[knBranch(t.name)], m=S.per[t.id]||{sent:0,delivered:0,read:0,clicked:0,btn:{}}, btns=knButtons(t), body=knBody(t), nd1=Math.max(0,m.sent-m.delivered);
    const s={text:body+(btns.length?'\nCTA - '+btns.map(function(b){ return b.text; }).join(' & '):''),name:t.name,day:null,status:'',type:'text'};
    const pi=window._watRows.push({p:{label:acc.name},st:{name:knLabel(t.name)},s:s,meta:[t],m:{sent:m.sent,delivered:m.delivered,read:m.read,clicked:m.clicked,failed:nd1,reasons:{}},tracksFail:true,failLabel:'Not delivered',btns:btns,btnCount:m.btn,range:r})-1;
    rows+='<div class="wad-row kn" onclick="watPop('+pi+')"><div class="pth"><span class="wad-path" style="color:'+c[1]+'"><i style="background:'+c[1]+'"></i><span>'+esc(knLabel(t.name))+'</span></span></div>'
      +'<div class="tt"><div class="t">'+esc(watTitle({text:body}))+'</div><div class="id">'+esc(t.name)+'</div>'+(btns.length?wadChips(btns,m.btn):'<div class="wad-btns"><span class="off">No buttons</span></div>')+'</div>'
      +'<div class="nums"><div class="n" data-l="Sent">'+wadN(m.sent)+'</div><div class="n" data-l="Delivered">'+wadN(m.delivered)+'<small>'+wadPct(m.delivered,m.sent)+'</small></div>'
      +'<div class="n'+(nd1?' bad':'')+'" data-l="Not delivered">'+wadN(nd1)+'<small>'+wadPct(nd1,m.sent)+'</small></div><div class="n" data-l="Read">'+wadN(m.read)+'<small>'+wadPct(m.read,m.delivered)+'</small></div></div>'
      +'<i class="fa-solid fa-chevron-right cv"></i></div>';
  });
  return h+'<div class="wat-list">'+(ordered.length?rows:'<div style="padding:16px;color:var(--slate)">No knocking templates on this number.</div>')+'</div>';
}
