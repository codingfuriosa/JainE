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

async function watLoad(){
  try{ const r=await fetch('assets/wa-templates/flows.json?v=1',{cache:'no-cache'}); WAT_DATA=await r.json(); }
  catch(_e){ WAT_DATA={projects:[]}; }
  if(!WAT_PROJ && WAT_DATA.projects[0]) WAT_PROJ=WAT_DATA.projects[0].key;
}
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
    +'<div class="wat-links">'+(p.links||[]).filter(function(l){ return /^https:\/\//.test(l[1]); }).map(function(l){ return '<a href="'+esc(l[1])+'" target="_blank" rel="noopener" title="'+esc(l[0])+'"><i class="fa-solid '+(/flow/i.test(l[0])?'fa-diagram-project':'fa-table')+'"></i></a>'; }).join('')+'</div></div>';
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
  const head=WAT_CSS+mHead('fa-comments','#16a34a','WhatsApp Templates');
  if(!WAT_DATA){ v.innerHTML=head+'<div class="loader"><div class="spin"></div></div>'; await watLoad(); if(PAGE!=='wa_templates') return; }
  if(ti===2&&!KN){ v.innerHTML=head+mTabs('wa_templates',WAT_TABS,ti)+'<div class="loader"><div class="spin"></div></div>'; await knLoad(); if(PAGE!=='wa_templates') return; }
  if(ti===1&&!WAD){ v.innerHTML=head+mTabs('wa_templates',WAT_TABS,ti)+'<div class="loader"><div class="spin"></div></div>'; await wadLoad(); if(PAGE!=='wa_templates') return; }
  const body=ti===0?watTemplates():ti===1?watDeliveries():watKnocking();
  v.innerHTML=head+mTabs('wa_templates',WAT_TABS,ti)+body;
};

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

/* ---------------- DELIVERIES (17 Nov 2026, list approved by Ayush) ----------------
   One project at a time; a date range (quick picks + from / to, this year only) or one day (click a bar);
   cards Sent / Delivered / Read / Clicked / Failed; the daily bars; the stage as sub-tabs; every template of
   the sheet as a full-width row with its figures - a click opens its WhatsApp look, Meta's status and the
   failure reasons. Figures: camp.wa_template_daily (Meta template analytics) and camp.wa_msg_status (failed
   + reason, only from numbers whose webhooks reach JainE), filled nightly by wa-deliveries-sync. */
let WAD=null, WAD_STAGE=-1;
const WAD_Y0=new Date().getFullYear()+'-01-01';
const WAD_R={q:'30',from:null,to:null,day:null};
const WAD_CSS='<style>'
+'.wad-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 14px}'
+'.wad-q{display:inline-flex;background:#f1f5f9;border-radius:10px;padding:3px;gap:2px;max-width:100%;overflow-x:auto;scrollbar-width:none}.wad-q::-webkit-scrollbar{display:none}'
+'.wad-q button{border:0;background:transparent;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:600;color:#475569;cursor:pointer;font-family:inherit;white-space:nowrap}'
+'.wad-q button.on{background:#fff;color:#0f172a;box-shadow:0 1px 3px rgba(15,23,42,.12)}'
+'.wad-bar input[type=date]{height:34px;border:1px solid var(--line);border-radius:8px;padding:0 8px;font-family:inherit;font-size:12.5px;background:#fff}'
+'.wad-day{display:inline-flex;align-items:center;gap:8px;background:#ecfdf5;color:#065f46;border-radius:8px;padding:6px 10px;font-size:12.5px;font-weight:600}'
+'.wad-day button{border:0;background:transparent;color:#065f46;cursor:pointer}'
+'.wad-cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:0 0 14px}'
+'.wad-card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:13px 15px}'
+'.wad-card .l{font-size:12px;color:var(--slate);font-weight:600;display:flex;align-items:center;gap:6px}.wad-card .l i{width:8px;height:8px;border-radius:50%}'
+'.wad-card .v{font-size:24px;font-weight:700;color:#0f172a;margin-top:5px;line-height:1.1}'
+'.wad-card .p{font-size:12px;color:var(--slate);margin-top:2px}'
+'.wad-chart{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 14px 8px;margin:0 0 14px}'
+'.wad-cols{display:flex;align-items:flex-end;gap:2px;height:150px}'
+'.wad-col{flex:1;display:flex;align-items:flex-end;justify-content:center;gap:1px;height:100%;cursor:pointer;border-radius:4px;min-width:0}'
+'.wad-col:hover{background:#f1f5f9}.wad-col.on{background:#ecfdf5}'
+'.wad-col i{display:block;width:30%;max-width:9px;border-radius:2px 2px 0 0;min-height:0}'
+'.wad-ax{display:flex;justify-content:space-between;font-size:10.5px;color:#94a3b8;margin-top:5px}'
+'.wad-leg{display:flex;gap:14px;font-size:11.5px;color:var(--slate);margin:0 0 8px}.wad-leg span{display:inline-flex;align-items:center;gap:5px}.wad-leg i{width:9px;height:9px;border-radius:2px}'
+'.wad-stg{display:flex;gap:6px;overflow-x:auto;margin:0 0 10px;scrollbar-width:none}.wad-stg::-webkit-scrollbar{display:none}'
+'.wad-stg button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:7px 14px;font-size:13px;font-weight:600;color:#475569;cursor:pointer;white-space:nowrap;font-family:inherit}'
+'.wad-stg button.on{background:#0f172a;border-color:#0f172a;color:#fff}'
+'.wad-row{display:grid;grid-template-columns:54px 40px minmax(0,1fr) repeat(5,minmax(62px,auto)) 16px;gap:12px;align-items:center;padding:10px 16px;border-top:1px solid #f1f5f9;cursor:pointer}'
+'.wad-row:hover{background:#f8fafc}.wad-row.on{background:#f0fdf4}'
+'.wad-row.h{cursor:default;background:#f8fafc;font-size:11px;font-weight:600;color:var(--slate);text-transform:uppercase;letter-spacing:.03em;padding:9px 16px;border-top:0}'
+'.wad-row .th{width:40px;height:40px;border-radius:8px;object-fit:cover;background:#f1f5f9;display:flex;align-items:center;justify-content:center;color:#94a3b8;overflow:hidden}'
+'.wad-row .th img{width:100%;height:100%;object-fit:cover}'
+'.wad-row .n{text-align:right;font-variant-numeric:tabular-nums;font-size:13px;color:#0f172a}.wad-row .n small{display:block;font-size:10.5px;color:var(--slate)}'
+'.wad-row .n.bad{color:#b91c1c}'
+'.wad-row .t{font-size:13.5px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
+'.wad-row .id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:#475569;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
+'.wad-row .cv{color:#94a3b8;font-size:12px}.wad-row.on .cv{transform:rotate(180deg)}'
+'.wad-fail{margin-top:14px}.wad-fail .r{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid #f1f5f9;font-size:13px}'
+'.wad-empty{background:#fff;border:1px solid var(--line);border-radius:14px;padding:22px;color:#475569;font-size:13.5px;display:flex;gap:12px;align-items:flex-start}'
+'@media(max-width:900px){.wad-cards{grid-template-columns:repeat(3,minmax(0,1fr))}}'
+'@media(max-width:720px){'
+'.wad-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.wad-card .v{font-size:20px}'
+'.wad-row{grid-template-columns:40px minmax(0,1fr) 16px;grid-template-areas:"th t cv" "th nums cv";gap:4px 10px;padding:10px 12px}'
+'.wad-row .th{grid-area:th}.wad-row .d{display:none}.wad-row>div:nth-child(3){grid-area:t;min-width:0}.wad-row .cv{grid-area:cv}'
+'.wad-row .n::before{content:attr(data-l) " ";color:var(--slate)}.wad-row .n small{display:inline;margin-left:3px}'
+'.wad-row .nums{grid-area:nums;display:flex;gap:12px;flex-wrap:wrap}.wad-row .n{text-align:left;font-size:12px}.wad-row.h{display:none}'
+'}'
+'@media(min-width:721px){.wad-row .nums{display:contents}}'
+'</style>';

async function wadLoad(){
  const C=sb.schema('camp');
  const all=async function(q){ const out=[]; for(let i=0;i<60;i++){ const r=await q().range(i*1000,i*1000+999); if(r.error) break; out.push.apply(out,r.data||[]); if(!r.data||r.data.length<1000) break; } return out; };
  const got=await Promise.all([
    C.from('wa_sync_state').select('*').eq('id',1).maybeSingle().then(function(r){ return r.error?{missing:true}:(r.data||{}); },function(){ return {missing:true}; }),
    C.from('wa_accounts').select('*').then(function(r){ return r.data||[]; },function(){ return []; }),
    all(function(){ return C.from('wa_templates').select('id,waba_id,name,language,status,category,quality,rejected_reason').order('id'); }),
    all(function(){ return C.from('wa_template_daily').select('template_id,day,sent,delivered,read,clicked').gte('day',WAD_Y0).order('day'); }),
    all(function(){ return C.from('wa_msg_status').select('message_id,ts,template_name,error_code,error_title,error_detail').eq('status','failed').gte('ts',WAD_Y0).order('ts'); })
  ]);
  WAD={state:got[0],acc:got[1],tpl:got[2],daily:got[3],fail:got[4]};
}
function wadIso(d){ return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10); }
function wadRange(){
  const t=new Date(), today=wadIso(t);
  if(WAD_R.day) return {s:WAD_R.day,e:WAD_R.day};
  if(WAD_R.q==='custom') return {s:WAD_R.from||WAD_Y0,e:WAD_R.to||today};
  if(WAD_R.q==='month') return {s:today.slice(0,8)+'01',e:today};
  if(WAD_R.q==='year') return {s:WAD_Y0,e:today};
  const s=new Date(t.getTime()-(+WAD_R.q-1)*864e5); return {s:wadIso(s)<WAD_Y0?WAD_Y0:wadIso(s),e:today};
}
function wadN(n){ return n==null?'NA':Number(n).toLocaleString('en-IN'); }
function wadPct(a,b){ return b?Math.round(a/b*1000)/10+'%':''; }

function watDeliveries(){
  const P=WAT_DATA.projects, p=watProj();
  if(!WAD) return '<div class="loader"><div class="spin"></div></div>';
  let h=WAD_CSS+'<div class="wat-top"><div class="wat-seg">'+P.map(function(x){ return '<button class="'+(x.key===p.key?'on':'')+'" onclick="watPick(\''+x.key+'\')">'+esc(x.label)+'</button>'; }).join('')+'</div></div>';
  if(WAD.state.missing||!WAD.acc.length){
    return h+'<div class="wad-empty"><i class="fa-brands fa-whatsapp" style="font-size:22px;color:#16a34a"></i><div><b style="color:#0f172a">No WhatsApp account is connected yet.</b><br>'
      +'Meta shows no WhatsApp Business Account on the JAIN-E Sync system user. Once the drip number&rsquo;s account is assigned to it, the figures fill in here from the next morning.</div></div>';
  }
  const r=wadRange(), today=wadIso(new Date());
  // the sheet's templates of this project, by stage, matched to Meta's templates by name
  const byName={}; WAD.tpl.forEach(function(t){ (byName[t.name]=byName[t.name]||[]).push(t); });
  const stages=p.stages.map(function(st){ return {name:st.name,steps:st.steps.filter(function(s){ return s.name; })}; }).filter(function(st){ return st.steps.length; });
  if(WAD_STAGE>=stages.length) WAD_STAGE=-1;
  const shown=WAD_STAGE===-1?stages:[stages[WAD_STAGE]];
  const ids={}; shown.forEach(function(st){ st.steps.forEach(function(s){ (byName[s.name]||[]).forEach(function(t){ ids[t.id]=s.name; }); }); });
  const names={}; Object.keys(ids).forEach(function(k){ names[ids[k]]=1; });
  const inR=function(d){ return d>=r.s&&d<=r.e; };
  const per={}, perDay={}, tot={sent:0,delivered:0,read:0,clicked:0};
  WAD.daily.forEach(function(x){ const nm=ids[x.template_id]; if(!nm) return;
    const allR=WAD_R.day?{s:wadRange0().s,e:wadRange0().e}:r;
    if(x.day>=allR.s&&x.day<=allR.e){ const dd=perDay[x.day]=perDay[x.day]||{sent:0,delivered:0,read:0}; dd.sent+=x.sent; dd.delivered+=x.delivered; dd.read+=x.read; }
    if(!inR(x.day)) return;
    const m=per[nm]=per[nm]||{sent:0,delivered:0,read:0,clicked:0,failed:0,reasons:{}};
    ['sent','delivered','read','clicked'].forEach(function(k){ m[k]+=+x[k]||0; tot[k]+=+x[k]||0; }); });
  let failed=0; const reasons={};
  WAD.fail.forEach(function(f){ const d=String(f.ts).slice(0,10); if(!inR(d)||!names[f.template_name]) return; failed++;
    const why=f.error_title||('Error '+(f.error_code||'?')); reasons[why]=(reasons[why]||0)+1;
    const m=per[f.template_name]=per[f.template_name]||{sent:0,delivered:0,read:0,clicked:0,failed:0,reasons:{}}; m.failed++; m.reasons[why]=(m.reasons[why]||0)+1; });
  const tracksFail=WAD.fail.length>0;
  // range bar
  h+='<div class="wad-bar"><div class="wad-q">'+[['7','7 days'],['30','30 days'],['month','This month'],['year','This year'],['custom','Custom']].map(function(o){ return '<button class="'+(!WAD_R.day&&WAD_R.q===o[0]?'on':'')+'" onclick="wadQ(\''+o[0]+'\')">'+o[1]+'</button>'; }).join('')+'</div>'
    +(WAD_R.q==='custom'&&!WAD_R.day?'<input type="date" min="'+WAD_Y0+'" max="'+today+'" value="'+(WAD_R.from||WAD_Y0)+'" onchange="WAD_R.from=this.value;renderPage()"><span style="color:var(--slate)">to</span><input type="date" min="'+WAD_Y0+'" max="'+today+'" value="'+(WAD_R.to||today)+'" onchange="WAD_R.to=this.value;renderPage()">':'')
    +(WAD_R.day?'<span class="wad-day"><i class="fa-regular fa-calendar"></i>'+esc(fmtDate(WAD_R.day))+'<button onclick="WAD_R.day=null;renderPage()" title="Back to the range"><i class="fa-solid fa-xmark"></i></button></span>':'')
    +'<input type="date" min="'+WAD_Y0+'" max="'+today+'" value="'+(WAD_R.day||'')+'" title="One day" onchange="WAD_R.day=this.value||null;renderPage()" style="margin-left:auto"></div>';
  // cards
  const card=function(col,l,v,pc){ return '<div class="wad-card"><div class="l"><i style="background:'+col+'"></i>'+l+'</div><div class="v">'+v+'</div><div class="p">'+(pc||'&nbsp;')+'</div></div>'; };
  h+='<div class="wad-cards">'+card('#64748b','Sent',wadN(tot.sent))+card('#2563eb','Delivered',wadN(tot.delivered),wadPct(tot.delivered,tot.sent)+(tot.sent?' of sent':''))
    +card('#16a34a','Read',wadN(tot.read),wadPct(tot.read,tot.delivered)+(tot.delivered?' of delivered':''))+card('#7c3aed','Clicked',wadN(tot.clicked),wadPct(tot.clicked,tot.read)+(tot.read?' of read':''))
    +card('#dc2626','Failed',tracksFail?wadN(failed):'NA',tracksFail?wadPct(failed,tot.sent):'Not reported to JainE')+'</div>';
  // daily bars (by week when the range is long)
  const R0=wadRange0(), days=[]; for(let d=new Date(R0.s+'T00:00:00');wadIso(d)<=R0.e;d=new Date(d.getTime()+864e5)) days.push(wadIso(d));
  const wk=days.length>62, buckets=[];
  days.forEach(function(d,i){ if(!wk||i%7===0) buckets.push({k:d,days:[]}); buckets[buckets.length-1].days.push(d); });
  buckets.forEach(function(b){ b.sent=0; b.delivered=0; b.read=0; b.days.forEach(function(d){ const x=perDay[d]; if(x){ b.sent+=x.sent; b.delivered+=x.delivered; b.read+=x.read; } }); });
  const mx=Math.max.apply(null,buckets.map(function(b){ return b.sent; }).concat([1]));
  h+='<div class="wad-chart"><div class="wad-leg"><span><i style="background:#94a3b8"></i>Sent</span><span><i style="background:#2563eb"></i>Delivered</span><span><i style="background:#16a34a"></i>Read</span><span style="margin-left:auto">'+(wk?'By week':'By day')+' · click a bar for that day</span></div><div class="wad-cols">'
    +buckets.map(function(b){ const on=WAD_R.day&&b.days.indexOf(WAD_R.day)>-1;
      return '<div class="wad-col'+(on?' on':'')+'" title="'+esc(fmtDate(b.k))+(wk?' (week)':'')+' - Sent '+b.sent+', Delivered '+b.delivered+', Read '+b.read+'" onclick="wadDay(\''+b.k+'\')">'
        +[['sent','#94a3b8'],['delivered','#2563eb'],['read','#16a34a']].map(function(m){ return '<i style="height:'+(b[m[0]]/mx*100)+'%;background:'+m[1]+'"></i>'; }).join('')+'</div>'; }).join('')
    +'</div><div class="wad-ax"><span>'+esc(fmtDate(R0.s))+'</span><span>'+esc(fmtDate(R0.e))+'</span></div></div>';
  // stage sub-tabs + template rows
  h+='<div class="wad-stg"><button class="'+(WAD_STAGE===-1?'on':'')+'" onclick="wadStage(-1)">All stages</button>'+stages.map(function(st,i){ return '<button class="'+(WAD_STAGE===i?'on':'')+'" onclick="wadStage('+i+')">'+esc(st.name)+'</button>'; }).join('')+'</div>';
  window._watRows=[];
  let rows='<div class="wad-row h"><div>Day</div><div></div><div>Template</div><div style="text-align:right">Sent</div><div style="text-align:right">Delivered</div><div style="text-align:right">Read</div><div style="text-align:right">Clicked</div><div style="text-align:right">Failed</div><div></div></div>';
  shown.forEach(function(st){
    if(WAD_STAGE===-1) rows+='<div class="wad-row h" style="display:block;background:#fff;color:#0f172a;font-size:12px;border-top:1px solid var(--line)">'+esc(st.name)+'</div>';
    st.steps.forEach(function(s){ const m=per[s.name]||{sent:0,delivered:0,read:0,clicked:0,failed:0,reasons:{}}, meta=byName[s.name]||[];
      const pic=[s.attach].concat(s.preview||[]).filter(function(u){ return u&&/\.(jpe?g|png|webp|gif)(\?|$)/i.test(u); })[0], k=watKind(s.type);
      const pi=window._watRows.push({p:p,st:st,s:s,m:m,meta:meta,tracksFail:tracksFail,range:r})-1;
      rows+='<div class="wad-row" onclick="watPop('+pi+')"><div class="d" style="font-size:12px;color:var(--slate);font-weight:600">'+(s.day==null?'':'Day <b style="color:#0f172a;font-size:15px">'+s.day+'</b>')+'</div>'
        +'<div class="th">'+(pic?'<img src="'+esc(pic)+'" alt="" loading="lazy">':'<i class="'+k[0]+'"></i>')+'</div>'
        +'<div><div class="t">'+esc(watTitle(s))+'</div><div class="id">'+esc(s.name)+(meta.length?'':' · not found at Meta')+'</div></div>'
        +'<div class="nums"><div class="n" data-l="Sent">'+wadN(m.sent)+'</div><div class="n" data-l="Delivered">'+wadN(m.delivered)+'<small>'+wadPct(m.delivered,m.sent)+'</small></div><div class="n" data-l="Read">'+wadN(m.read)+'<small>'+wadPct(m.read,m.delivered)+'</small></div>'
        +'<div class="n" data-l="Clicked">'+wadN(m.clicked)+'<small>'+wadPct(m.clicked,m.read)+'</small></div><div class="n'+(m.failed?' bad':'')+'" data-l="Failed">'+(tracksFail?wadN(m.failed):'NA')+'</div></div>'
        +'<i class="fa-solid fa-chevron-right cv"></i></div>';
    });
  });
  h+='<div class="wat-list">'+rows+'</div>';
  if(Object.keys(reasons).length) h+='<div class="card card-pad wad-fail" style="margin-top:14px"><div class="lbl" style="font-weight:700;margin-bottom:6px">Why messages failed</div>'+Object.keys(reasons).sort(function(a,b){ return reasons[b]-reasons[a]; }).map(function(w){ return '<div class="r"><span>'+esc(w)+'</span><b>'+reasons[w]+'</b></div>'; }).join('')+'</div>';
  return h;
}
// the range the bars cover - the chosen range even while one day is picked
function wadRange0(){ const d=WAD_R.day; WAD_R.day=null; const r=wadRange(); WAD_R.day=d; return r; }
window.wadQ=function(q){ WAD_R.q=q; WAD_R.day=null; renderPage(); };
window.wadDay=function(d){ WAD_R.day=WAD_R.day===d?null:d; renderPage(); };
window.wadStage=function(i){ WAD_STAGE=i; renderPage(); };


/* ---------------- KNOCKING (17 Nov 2026, Ayush: "these are Knocking Messages - I want them in a different tab, they will
   not be included in the Deliveries tab; for these 8 messages I want the Sent, Delivered, Failed, Read and how many
   clicked the different buttons offered as CTAs"). The ask_question* templates of a project's WhatsApp account, laid out
   the way they run: the first knock, then what goes to people who said Yes, who said No, and who did not reply. Each shows
   Sent, Delivered, Not delivered, Read and every button with its clicks. Figures: camp.wa_template_daily (Meta's template
   analytics, kept by Meta for ~90 days; read nightly). Meta does not report failed sends: "Not delivered" = sent minus
   delivered (failed, or not delivered yet). Phone-call buttons are not counted by Meta - they say so. */
let KN=null, KN_ACC=null;
const KN_RE=/^ask_question/i;
async function knLoad(){
  const C=sb.schema('camp');
  const all=async function(q){ const out=[]; for(let i=0;i<60;i++){ const r=await q().range(i*1000,i*1000+999); if(r.error) break; out.push.apply(out,r.data||[]); if(!r.data||r.data.length<1000) break; } return out; };
  const got=await Promise.all([
    C.from('wa_accounts').select('id,name,phones').then(function(r){ return r.error?null:(r.data||[]); },function(){ return null; }),
    all(function(){ return C.from('wa_templates').select('id,waba_id,name,status,category,components').ilike('name','ask_question%').order('id'); })
  ]);
  const tpl=got[1]||[], ids=tpl.map(function(t){ return t.id; });
  let daily=[];
  for(let i=0;i<ids.length;i+=100){ const part=ids.slice(i,i+100);
    daily=daily.concat(await all(function(){ return C.from('wa_template_daily').select('template_id,day,sent,delivered,read,clicked,clicks').in('template_id',part).gte('day',WAD_Y0).order('day'); })); }
  KN={acc:got[0],tpl:tpl,daily:daily};
}
function knBranch(n){ n=String(n).toLowerCase(); return /_yes_/.test(n)?1:/_no_/.test(n)?2:/_silent_/.test(n)?3:0; }
function knStep(n){ const m=String(n).match(/q(\d+)/i); return m?+m[1]:0; }
function knLabel(n){ const b=['First knock','Said Yes','Said No','No reply'][knBranch(n)], q=knStep(n); return knBranch(n)===0?'First knock':b+(q?' · Q'+q:''); }
function knBody(t){ const c=(t.components||[]).filter(function(x){ return x.type==='BODY'; })[0]; return String((c&&c.text)||''); }
function knButtons(t){ const c=(t.components||[]).filter(function(x){ return x.type==='BUTTONS'; })[0]; return ((c&&c.buttons)||[]).map(function(b){ return {text:b.text,type:b.type}; }); }
function watKnocking(){
  if(!KN) return '<div class="loader"><div class="spin"></div></div>';
  let h=WAD_CSS+'<style>'
    +'.wad-cards.kn-cards{grid-template-columns:repeat(4,minmax(0,1fr))}@media(max-width:720px){.wad-cards.kn-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}'
    +'.kn-board{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:start}'
    +'@media(max-width:1100px){.kn-board{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.kn-board{grid-template-columns:1fr}}'
    +'.kn-col h4{margin:0 0 8px;font-size:13px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:7px}.kn-col h4 i{width:9px;height:9px;border-radius:50%}'
    +'.kn-card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:13px 14px;margin:0 0 10px;cursor:pointer}.kn-card:hover{border-color:#94a3b8}'
    +'.kn-card .nm{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:#475569;background:#f1f5f9;border-radius:6px;padding:2px 7px;display:inline-block;margin-bottom:6px}'
    +'.kn-card .tx{font-size:13px;color:#0f172a;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:10px}'
    +'.kn-n{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-bottom:10px}'
    +'.kn-n div{background:#f8fafc;border-radius:8px;padding:6px 7px;font-size:10.5px;color:var(--slate);font-weight:600}.kn-n b{display:block;font-size:16px;color:#0f172a}'
    +'.kn-b{display:flex;flex-wrap:wrap;gap:6px}.kn-b span{border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600}'
    +'.kn-b span.off{border-color:var(--line);background:#f8fafc;color:#94a3b8;font-weight:500}'
    +'.kn-none{color:#94a3b8;font-size:12.5px;padding:6px 2px}'
    +'</style>';
  if(KN.acc===null||!KN.tpl.length) return h+'<div class="wad-empty"><i class="fa-brands fa-whatsapp" style="font-size:22px;color:#16a34a"></i><div><b style="color:#0f172a">The knocking figures are not read yet.</b><br>They show here after the next read from Meta.</div></div>';
  // ANANTA ONLY (17 Nov 2026, Ayush: "there is only for Ananta") - knocking runs on the Ananta number alone; other accounts
  // carry templates of the same names but they are not shown here
  const accName=function(id){ return ((KN.acc||[]).filter(function(a){ return a.id===id; })[0]||{}).name||id; };
  const accIds=[...new Set(KN.tpl.map(function(t){ return t.waba_id; }))].filter(function(id){ return /ananta/i.test(accName(id)); });
  KN_ACC=accIds[0]||null;
  if(!KN_ACC) return h+'<div class="wad-empty"><div>No knocking templates found on the Ananta number.</div></div>';
  h+='<div class="wat-top"><div style="font-size:15px;font-weight:700;color:#0f172a"><i class="fa-brands fa-whatsapp" style="color:#16a34a"></i> '+esc(accName(KN_ACC))+' <span style="font-weight:500;color:var(--slate);font-size:13px">· knocking messages</span></div></div>';
  const r=wadRange(), today=wadIso(new Date());
  h+='<div class="wad-bar"><div class="wad-q">'+[['7','7 days'],['30','30 days'],['month','This month'],['year','This year'],['custom','Custom']].map(function(o){ return '<button class="'+(!WAD_R.day&&WAD_R.q===o[0]?'on':'')+'" onclick="wadQ(\''+o[0]+'\')">'+o[1]+'</button>'; }).join('')+'</div>'
    +(WAD_R.q==='custom'&&!WAD_R.day?'<input type="date" min="'+WAD_Y0+'" max="'+today+'" value="'+(WAD_R.from||WAD_Y0)+'" onchange="WAD_R.from=this.value;renderPage()"><span style="color:var(--slate)">to</span><input type="date" min="'+WAD_Y0+'" max="'+today+'" value="'+(WAD_R.to||today)+'" onchange="WAD_R.to=this.value;renderPage()">':'')
    +(WAD_R.day?'<span class="wad-day"><i class="fa-regular fa-calendar"></i>'+esc(fmtDate(WAD_R.day))+'<button onclick="WAD_R.day=null;renderPage()"><i class="fa-solid fa-xmark"></i></button></span>':'')
    +'<input type="date" min="'+WAD_Y0+'" max="'+today+'" value="'+(WAD_R.day||'')+'" title="One day" onchange="WAD_R.day=this.value||null;renderPage()" style="margin-left:auto"></div>';
  const tpl=KN.tpl.filter(function(t){ return t.waba_id===KN_ACC; });
  const per={}, tot={sent:0,delivered:0,read:0,clicked:0};
  KN.daily.forEach(function(x){ if(x.day<r.s||x.day>r.e) return; const t=tpl.filter(function(z){ return z.id===x.template_id; })[0]; if(!t) return;
    const m=per[t.id]=per[t.id]||{sent:0,delivered:0,read:0,clicked:0,btn:{}};
    ['sent','delivered','read','clicked'].forEach(function(k){ m[k]+=+x[k]||0; tot[k]+=+x[k]||0; });
    (x.clicks||[]).forEach(function(c){ const b=c.button_content||c.type||'Button'; m.btn[b]=(m.btn[b]||0)+(+c.count||0); }); });
  const card=function(col,l,v,pc,ttl){ return '<div class="wad-card"'+(ttl?' title="'+esc(ttl)+'"':'')+'><div class="l"><i style="background:'+col+'"></i>'+l+'</div><div class="v">'+v+'</div><div class="p">'+(pc||'&nbsp;')+'</div></div>'; };
  const nd=Math.max(0,tot.sent-tot.delivered);
  // 17 Nov 2026 (Ayush: "remove button clicks"): no total-clicks card - the clicks stay per button on each template
  h+='<div class="wad-cards kn-cards">'+card('#64748b','Sent',wadN(tot.sent))+card('#2563eb','Delivered',wadN(tot.delivered),wadPct(tot.delivered,tot.sent)+(tot.sent?' of sent':''))
    +card('#dc2626','Not delivered',wadN(nd),wadPct(nd,tot.sent)+(tot.sent?' of sent':''),'Meta does not report failed messages - this is sent minus delivered (failed, or not delivered yet)')
    +card('#16a34a','Read',wadN(tot.read),wadPct(tot.read,tot.delivered)+(tot.delivered?' of delivered':''))+'</div>';
  window._watRows=[];
  const cols=[['First knock','#0f172a'],['Said Yes','#16a34a'],['Said No','#dc2626'],['No reply','#d97706']];
  h+='<div class="kn-board">'+cols.map(function(c,bi){
    const list=tpl.filter(function(t){ return knBranch(t.name)===bi; }).sort(function(a,b){ return knStep(a.name)-knStep(b.name)||a.name.localeCompare(b.name); });
    return '<div class="kn-col"><h4><i style="background:'+c[1]+'"></i>'+c[0]+'</h4>'+(list.length?list.map(function(t){
      const m=per[t.id]||{sent:0,delivered:0,read:0,clicked:0,btn:{}}, btns=knButtons(t), body=knBody(t);
      const s={text:body+(btns.length?'\nCTA - '+btns.map(function(b){ return b.text; }).join(' & '):''),name:t.name,day:null,status:'',type:'text'};
      const pi=window._watRows.push({p:{label:accName(KN_ACC)},st:{name:knLabel(t.name)},s:s,meta:[t],m:{sent:m.sent,delivered:m.delivered,read:m.read,clicked:m.clicked,failed:Math.max(0,m.sent-m.delivered),reasons:{}},tracksFail:true,failLabel:'Not delivered',btns:btns,btnCount:m.btn,range:r})-1;
      return '<div class="kn-card" onclick="watPop('+pi+')"><span class="nm">'+esc(t.name)+'</span><div class="tx">'+esc(watTitle({text:body}))+'</div>'
        +'<div class="kn-n"><div>Sent<b>'+wadN(m.sent)+'</b></div><div>Delivered<b>'+wadN(m.delivered)+'</b></div><div title="Sent minus delivered">Not deliv.<b>'+wadN(Math.max(0,m.sent-m.delivered))+'</b></div><div>Read<b>'+wadN(m.read)+'</b></div></div>'
        +'<div class="kn-b">'+(btns.length?btns.map(function(b){ const ph=/PHONE/i.test(b.type); return ph?'<span class="off" title="Meta does not count clicks on call buttons">'+esc(b.text)+' · not counted</span>':'<span>'+esc(b.text)+' · '+wadN(m.btn[b.text]||0)+'</span>'; }).join(''):'<span class="off">No buttons</span>')+'</div></div>';
    }).join(''):'<div class="kn-none">None in this account</div>')+'</div>';
  }).join('')+'</div>';
  return h;
}
window.knPick=function(id){ KN_ACC=id; renderPage(); };
