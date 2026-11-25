
/* ============================ CRM & SALES — PERFORMANCE REPORT (23 Nov 2026) ============================
   Ayush: "a new report in CRM & Sales named Performance Report ... Monthly data is pulled and updated weekly Sunday ...
   Channel, Spent, Lead, CPL, QL, QL%, CPQL, SV, Booking, QL to SV%, SV to Booking% ... Digital and Non Digital ... 3
   totals ... Project wise ... Others when clicked shows the drill down ... All Projects as well".
   Data: acc.crm_perf_report (rebuilt every Sunday 07:00 IST by acc.crm_perf_refresh - this month to Saturday and last
   month) and acc.crm_perf_spend (the spend typed in for channels other than Facebook / Google). See migration
   20261123201000_crm_performance_report.sql for where each figure comes from. Lead (and so CPL and QL%) is shown
   for every channel since 23 Nov 2026 (the CRM source report now carries leads; before that only Facebook / Google). A channel with
   nothing in the month is not shown (Facebook and Google always are). */
const CP_DIG=['Facebook','Google','Social Media','ChatGPT','Others'], CP_NON=['Agent','Hoarding','Walk In','Newspaper','Others'];
const CP_MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let CP={month:null,bu:'all',rows:null,spend:null,open:{},range:null,rangeRows:null,rangeSpend:null};
// 25 Nov 2026 (Ayush): "make a -, NA instead" - every empty figure reads NA
const CP_NA='NA';
function cpMonLabel(m){ if(m==='custom') return cpRangeLabel(); const p=String(m).split('-'); return CP_MON[+p[1]-1]+" '"+p[0].slice(2); }
function cpInr(n){ return '₹'+Math.round(Number(n)||0).toLocaleString('en-IN'); }
function cpPct(a,b){ return (b>0)?(Math.round(a/b*1000)/10)+'%':CP_NA; }
function cpDiv(a,b){ return (a>0&&b>0)?cpInr(a/b):CP_NA; }
function cpD(s){ const p=String(s).split('-'); return (+p[2])+' '+CP_MON[+p[1]-1]+" '"+p[0].slice(2); }
function cpRangeLabel(){ return CP.range?cpD(CP.range.from)+' – '+cpD(CP.range.to):'Custom'; }
// Facebook and Google spend comes from the CRM's own reports - no box to type it (Ayush 25 Nov)
function cpAutoCh(ch){ return ch==='Facebook'||ch==='Google'; }
async function cpLoad(){
  const wrap=$('cpWrap'); if(!wrap) return; loader(wrap);
  const all=[]; let err=null;
  for(let f=0;;f+=1000){
    const q=await sb.schema('acc').from('crm_perf_report').select('month,bu_id,business_unit,grp,channel,sub,leads,auto_spend,ql,sv,bk,refreshed_at').order('month',{ascending:false}).range(f,f+999);
    if(q.error){ err=q.error; break; } all.push.apply(all,q.data||[]); if(!q.data||q.data.length<1000) break; }
  if(err){ wrap.innerHTML=/crm_perf_report|does not exist|schema cache/i.test(err.message)
      ?'<div class="card card-pad" style="color:var(--slate)"><i class="fa-solid fa-moon"></i> The Performance Report is being set up tonight - it shows here from 20:15 IST today.</div>'
      :'<div class="card card-pad" style="color:#b91c1c">Could not load: '+esc(err.message)+'</div>'; return; }
  const sp=await sb.schema('acc').from('crm_perf_spend').select('month,bu_id,channel,amount,updated_by,updated_at');
  CP.rows=all; CP.spend=(sp&&sp.data)||[];
  const months=[...new Set(all.map(r=>r.month))].sort().reverse();
  if(!CP.month||months.indexOf(CP.month)===-1) CP.month=months[0]||null;
  cpPaint();
}
function cpPaint(){
  const wrap=$('cpWrap'); if(!wrap||!CP.rows) return;
  const months=[...new Set(CP.rows.map(r=>r.month))].sort().reverse();
  if(!CP.month){ wrap.innerHTML='<div class="card card-pad" style="color:var(--slate)">No data yet.</div>'; return; }
  const isRange=CP.month==='custom';
  if(isRange&&!CP.rangeRows){ wrap.innerHTML=cpBarHtml(months,{})+'<div class="card card-pad" style="color:var(--slate)">'+(CP.range?'Loading '+esc(cpRangeLabel())+'…':'Choose the From and To dates, then Apply.')+'</div>'; return; }
  const inMonth=isRange?CP.rangeRows:CP.rows.filter(r=>r.month===CP.month);
  const projects={}; CP.rows.concat(inMonth).forEach(r=>{ projects[r.bu_id]=r.business_unit||('Project '+r.bu_id); });
  if(CP.bu!=='all'&&!projects[CP.bu]) CP.bu='all';
  const pick=inMonth.filter(r=>CP.bu==='all'||r.bu_id===Number(CP.bu));
  const spends=(isRange?CP.rangeSpend:CP.spend.filter(s=>s.month===CP.month)).filter(s=>(CP.bu==='all'||s.bu_id===Number(CP.bu))&&!/^D:(Facebook|Google)$/.test(s.channel));
  // one line per channel (Others carries its sub-sources)
  /* SPEND IS TYPED IN FOR EVERY CHANNEL (23 Nov 2026, Ayush: "Spend will be manually addable"). A typed amount for a
     project and month is used as it is; for Facebook and Google, a project-month with nothing typed still shows the
     spend from the CRM's Facebook / Google reports. */
  const line=function(grp,ch){
    const rs=pick.filter(r=>r.grp===grp&&r.channel===ch);
    const o={grp:grp,ch:ch,ql:0,sv:0,bk:0,leads:null,spend:0,manual:false,subs:{}};
    const key=(grp==='digital'?'D:':'N:')+ch, autoBu={}, typedBu={};
    spends.filter(s=>s.channel===key).forEach(s=>{ typedBu[s.bu_id]=(typedBu[s.bu_id]||0)+(Number(s.amount)||0); });
    rs.forEach(r=>{ o.ql+=r.ql; o.sv+=r.sv; o.bk+=r.bk;
      if(r.leads!=null) o.leads=(o.leads||0)+r.leads; if(r.auto_spend!=null) autoBu[r.bu_id]=(autoBu[r.bu_id]||0)+Number(r.auto_spend);
      if(r.sub){ const s=o.subs[r.sub]||(o.subs[r.sub]={l:0,ql:0,sv:0,bk:0}); s.l+=r.leads||0; s.ql+=r.ql; s.sv+=r.sv; s.bk+=r.bk; } });
    new Set(Object.keys(autoBu).concat(Object.keys(typedBu))).forEach(b=>{ if(typedBu[b]!=null){ o.spend+=typedBu[b]; o.manual=true; } else o.spend+=autoBu[b]||0; });
    // EVERY CHANNEL IS ALWAYS LISTED (23 Nov 2026), so spend can be typed for one that had nothing yet this month and
    // Non Digital "Others" is never missing.
    o.show=true;
    return o;
  };
  const dig=CP_DIG.map(c=>line('digital',c)).filter(o=>o.show), non=CP_NON.map(c=>line('nondigital',c)).filter(o=>o.show);
  const tot=function(list,label){ const t={ch:label,ql:0,sv:0,bk:0,leads:0,spend:0,lspend:0,lql:0,total:true};
    list.forEach(o=>{ t.ql+=o.ql; t.sv+=o.sv; t.bk+=o.bk; t.spend+=o.spend; if(o.leads!=null){ t.leads+=o.leads; t.lspend+=o.spend; t.lql+=o.ql; } }); return t; };
  const tD=tot(dig,'Total Digital'), tN=tot(non,'Total Non Digital'), tA=tot(dig.concat(non),'Grand Total');
  CP.projList=Object.keys(projects).map(id=>[id,projects[id]]).sort((a,b)=>a[1].localeCompare(b[1]));
  /* SPENT (25 Nov 2026, Ayush: "where data will be added will not have NA instead a small field to add amt and no field
     for Facebook"): every channel except Facebook / Google gets a small amount box, for one project and one month (the
     amount is kept per project and month). All Projects and a custom range show the total only. */
  const boxOk=!isRange&&CP.bu!=='all';
  const cells=function(o){
    const hasL=o.total?o.leads>0:o.leads!=null;
    const lead=hasL?(o.leads||0).toLocaleString('en-IN'):CP_NA;
    const cpl=o.total?(o.leads>0?cpDiv(o.lspend,o.leads):CP_NA):(hasL?cpDiv(o.spend,o.leads):CP_NA);
    const qlp=o.total?(o.leads>0?cpPct(o.lql,o.leads):CP_NA):(hasL?cpPct(o.ql,o.leads):CP_NA);
    const key=o.total?'':(o.grp==='digital'?'D:':'N:')+o.ch;
    const spent=(!o.total&&boxOk&&!cpAutoCh(o.ch))
      ?'<input class="cp-in" type="number" min="0" step="1" inputmode="numeric" placeholder="Add ₹" data-k="'+esc(key)+'" value="'+(o.manual?Math.round(o.spend):'')+'" onclick="event.stopPropagation()" onchange="cpSpendSet(this)" onkeydown="if(event.key===\'Enter\')this.blur()">'
      // All Projects (25 Nov 2026, Ayush: "I can't add anything"): the total, and an Add button that asks for the project
      :(!o.total&&!isRange&&CP.bu==='all'&&!cpAutoCh(o.ch))
        ?(o.spend>0?cpInr(o.spend)+' ':'')+'<button class="cp-add" title="Add the amount spent this month for one project" onclick="event.stopPropagation();cpSpendAsk(\''+o.grp+'\',\''+esc(o.ch).replace(/'/g,"\\'")+'\')">+ Add ₹</button>'
      :(o.spend>0?cpInr(o.spend):CP_NA);
    return '<td>'+spent+'</td><td>'+lead+'</td><td>'+cpl+'</td><td>'+o.ql+'</td><td>'+qlp+'</td><td>'+cpDiv(o.spend,o.ql)+'</td><td>'+o.sv+'</td><td>'+o.bk+'</td><td>'+cpPct(o.sv,o.ql)+'</td><td>'+cpPct(o.bk,o.sv)+'</td>';
  };
  const rowsHtml=function(list){ return list.map(o=>{
    const subs=Object.keys(o.subs).sort((a,b)=>(o.subs[b].ql+o.subs[b].sv+o.subs[b].l)-(o.subs[a].ql+o.subs[a].sv+o.subs[a].l)||a.localeCompare(b));
    const k=o.grp+'|'+o.ch, isO=o.ch==='Others'&&subs.length, op=!!CP.open[k];
    return '<tr'+(isO?' class="cp-op" onclick="cpToggle(\''+k+'\')"':'')+'><td class="cp-ch">'+(isO?'<i class="fa-solid fa-caret-'+(op?'down':'right')+'" style="width:12px;color:#94a3b8"></i> ':'<span style="display:inline-block;width:16px"></span>')+esc(o.ch)+'</td>'+cells(o)+'</tr>'
      +(isO&&op?subs.map(s=>{ const x=o.subs[s]; return '<tr class="cp-sub"><td class="cp-ch" style="padding-left:40px">'+esc(s)+'</td><td>'+CP_NA+'</td><td>'+(x.l||0).toLocaleString('en-IN')+'</td><td>'+CP_NA+'</td><td>'+x.ql+'</td><td>'+cpPct(x.ql,x.l)+'</td><td>'+CP_NA+'</td><td>'+x.sv+'</td><td>'+x.bk+'</td><td>'+cpPct(x.sv,x.ql)+'</td><td>'+cpPct(x.bk,x.sv)+'</td></tr>'; }).join(''):''); }).join(''); };
  const totRow=function(t,cls){ return '<tr class="'+cls+'"><td class="cp-ch">'+esc(t.ch)+'</td>'+cells(t)+'</tr>'; };
  const last=CP.rows.reduce((m,r)=>r.refreshed_at>m?r.refreshed_at:m,'');
  const fk=document.activeElement&&document.activeElement.classList&&document.activeElement.classList.contains('cp-in')?document.activeElement.getAttribute('data-k'):null;
  wrap.innerHTML=cpBarHtml(months,projects)
    +'<div class="card" style="padding:0;overflow:auto"><table class="cp-t"><thead><tr><th style="text-align:left">Channel</th><th>Spent</th><th>Lead</th><th>CPL</th><th>QL</th><th>QL%</th><th>CPQL</th><th>SV</th><th>Booking</th><th>QL to SV%</th><th>SV to Booking%</th></tr></thead><tbody>'
      +'<tr class="cp-grp"><td colspan="11">Digital</td></tr>'+rowsHtml(dig)+totRow(tD,'cp-tot')
      +'<tr class="cp-grp"><td colspan="11">Non Digital</td></tr>'+rowsHtml(non)+totRow(tN,'cp-tot')
      +totRow(tA,'cp-grand')
    +'</tbody></table></div>'
    +'<div class="cp-note">'+esc(cpMonLabel(CP.month))+(CP.month===months[0]?' (month to date)':'')+' &middot; '+esc(CP.bu==='all'?'All Projects':projects[CP.bu])
      +'. Lead, QL, SV and Booking: the CRM\u2019s source report, counted '+(isRange?'on the days they happened':'in the month they happened')+'. Spent: Facebook and Google from the CRM\u2019s Facebook and Google reports; every other channel is typed in the box, per project and month'
      +(isRange?' (for a custom range, a month\u2019s typed amount is counted for the days of that month inside the range)':(CP.bu==='all'?' (choose a project to type an amount)':''))+'. '
      +(isRange?'Read live from the CRM\u2019s daily figures.':'Updated every Sunday at 7:00 AM'+(last?' - last on '+esc(fmtDate(last)):'')+'.')+'</div>';
  if(fk){ const el=wrap.querySelector('.cp-in[data-k="'+fk.replace(/"/g,'\\"')+'"]'); if(el) el.focus(); }
}
function cpBarHtml(months,projects){
  const projOpts=[['all','All Projects']].concat(Object.keys(projects).map(id=>[id,projects[id]]).sort((a,b)=>a[1].localeCompare(b[1])));
  const isRange=CP.month==='custom', today=new Date(Date.now()+330*60000).toISOString().slice(0,10);
  return '<div class="cp-bar"><div class="cq-tabs cp-mon">'+months.slice(0,12).map(m=>'<button type="button" class="'+(m===CP.month?'on':'')+'" onclick="cpMonth(\''+m+'\')">'+cpMonLabel(m)+'</button>').join('')
      +'<button type="button" class="'+(isRange?'on':'')+'" onclick="cpMonth(\'custom\')"><i class="fa-regular fa-calendar"></i> Custom</button></div>'
    // 25 Nov 2026 (Ayush): months and the project picker on ONE row, the months scroll sideways; the custom dates go under them
    +'<select class="sel" style="height:36px;margin-left:auto" onchange="cpBu(this.value)">'+projOpts.map(p=>'<option value="'+p[0]+'"'+(String(CP.bu)===String(p[0])?' selected':'')+'>'+esc(p[1])+'</option>').join('')+'</select></div>'+(isRange?'<div class="cp-rng"><label>From <input type="date" id="cpFrom" min="2026-01-01" max="'+today+'" value="'+esc(CP.range?CP.range.from:'')+'"></label><label>To <input type="date" id="cpTo" min="2026-01-01" max="'+today+'" value="'+esc(CP.range?CP.range.to:'')+'"></label><button class="btn btn-primary" style="height:34px" onclick="cpRangeApply()">Apply</button></div>':'');
}
window.cpMonth=function(m){ CP.month=m; cpPaint(); };
/* CUSTOM DATE RANGE (25 Nov 2026, Ayush: "there will be a custom as well for date range"). Built in the page from the
   same daily tables and the same channel rules as acc.crm_perf_refresh (keep the two in step). */
window.cpRangeApply=async function(){
  const f=($('cpFrom')||{}).value, t=($('cpTo')||{}).value;
  if(!f||!t){ toast('Choose both dates','warn'); return; }
  if(f>t){ toast('From must be on or before To','warn'); return; }
  CP.range={from:f,to:t}; CP.rangeRows=null; cpPaint();
  try{ await cpRangeLoad(f,t); }catch(e){ CP.rangeRows=null; const w=$('cpWrap'); if(w) w.innerHTML='<div class="card card-pad" style="color:#b91c1c">Could not load: '+esc(e.message||String(e))+'</div>'; return; }
  if(CP.range&&CP.range.from===f&&CP.range.to===t) cpPaint();
};
async function cpPaged(mk){ const out=[]; for(let f=0;;f+=1000){ const q=await mk().range(f,f+999); if(q.error) throw q.error; out.push.apply(out,q.data||[]); if(!q.data||q.data.length<1000) break; } return out; }
async function cpRangeLoad(f,t){
  const src=await cpPaged(()=>sb.schema('camp').from('crm_source_daily').select('bu_id,business_unit,level,top_source,source,tot_leads,tot_q,tot_sv,tot_bk,self_leads,self_q,self_sv,self_bk').gte('day',f).lte('day',t).lte('level',1).order('day'));
  const gg=await cpPaged(()=>sb.schema('camp').from('crm_google_daily').select('bu_id,business_unit,campaign_type,cost').gte('day',f).lte('day',t).order('day'));
  const acc={}; const add=function(bu,name,g,ch,sub,l,q,v,b,sp){ const k=bu+'|'+g+'|'+ch+'|'+sub;
    const o=acc[k]||(acc[k]={month:'custom',bu_id:bu,business_unit:name||'',grp:g,channel:ch,sub:sub,leads:0,auto_spend:null,ql:0,sv:0,bk:0});
    if(name&&!o.business_unit) o.business_unit=name; o.leads+=l||0; o.ql+=q||0; o.sv+=v||0; o.bk+=b||0; if(sp!=null) o.auto_spend=(o.auto_spend||0)+Number(sp); };
  const NONDIG={'Agent':'Agent','Hoarding':'Hoarding','Walk In':'Walk In','NewsPaper':'Newspaper'};
  const L0X=['Online','Chatgpt','Social Media','Other Project Campaign','sms','Agent','Hoarding','Walk In','NewsPaper'];
  src.forEach(function(d){ const T=[d.tot_leads,d.tot_q,d.tot_sv,d.tot_bk], a=function(g,ch,sub,x){ add(d.bu_id,d.business_unit,g,ch,sub,x[0],x[1],x[2],x[3]); };
    if(d.level===1&&d.top_source==='Online'){
      if(d.source==='FACEBOOK') a('digital','Facebook','',T); else if(d.source==='Google') a('digital','Google','',T);
      else if(d.source==='Chatgpt') a('digital','ChatGPT','',T); else a('digital','Others',d.source,T);
    } else if(d.level===0){
      if(d.source==='Chatgpt') a('digital','ChatGPT','',T);
      else if(d.source==='Social Media') a('digital','Social Media','',T);
      else if(d.source==='Online') a('digital','Others','Online (no sub-source)',[d.self_leads,d.self_q,d.self_sv,d.self_bk]);
      else if(d.source==='Other Project Campaign'||d.source==='sms') a('digital','Others',d.source,T);
      else if(NONDIG[d.source]) a('nondigital',NONDIG[d.source],'',T);
      else if(L0X.indexOf(d.source)===-1) a('nondigital','Others',d.source,T);
    } });
  gg.forEach(function(r){ add(r.bu_id,r.business_unit,'digital',r.campaign_type==='facebook'?'Facebook':'Google','',0,0,0,0,r.cost); });
  // a month's typed amount, counted for the days of that month inside the range
  const day=s=>Date.UTC(+s.slice(0,4),+s.slice(5,7)-1,+s.slice(8,10)), F=day(f), Tt=day(t);
  CP.rangeSpend=CP.spend.map(function(s){ const m0=day(String(s.month)), y=+String(s.month).slice(0,4), mo=+String(s.month).slice(5,7);
    const m1=Date.UTC(y,mo,0), a=Math.max(F,m0), b=Math.min(Tt,m1); if(b<a) return null;
    const dim=new Date(Date.UTC(y,mo,0)).getUTCDate();
    return {month:'custom',bu_id:s.bu_id,channel:s.channel,amount:Number(s.amount)*(((b-a)/864e5)+1)/dim}; }).filter(Boolean);
  CP.rangeRows=Object.values(acc);
}
window.cpSpendSet=async function(el){
  const key=el.getAttribute('data-k'), bu=Number(CP.bu), raw=String(el.value||'').trim();
  if(!bu||CP.month==='custom') return;
  if(raw===''){
    const {error}=await sb.schema('acc').from('crm_perf_spend').delete().eq('month',CP.month).eq('bu_id',bu).eq('channel',key);
    if(error){ toast(error.message,'err'); return; }
    CP.spend=CP.spend.filter(s=>!(s.month===CP.month&&s.bu_id===bu&&s.channel===key)); toast('Amount removed','ok'); cpPaint(); return;
  }
  const v=Number(raw); if(!(v>=0)){ toast('Type an amount','warn'); return; }
  const row={month:CP.month,bu_id:bu,channel:key,amount:v,updated_by:state.email,updated_at:new Date().toISOString()};
  const {error}=await sb.schema('acc').from('crm_perf_spend').upsert(row,{onConflict:'month,bu_id,channel'});
  if(error){ toast(error.message,'err'); return; }
  CP.spend=CP.spend.filter(s=>!(s.month===row.month&&s.bu_id===row.bu_id&&s.channel===key)).concat([row]);
  toast('Saved','ok'); cpPaint();
};
window.cpBu=function(b){ CP.bu=b; cpPaint(); };
window.cpToggle=function(k){ CP.open[k]=!CP.open[k]; cpPaint(); };
window.cpSpendAsk=function(grp,ch){
  const key=(grp==='digital'?'D:':'N:')+ch;
  const list=CP.projList||[];
  const bu=CP.bu!=='all'?String(CP.bu):((list[0]||[])[0]||'');
  window._cpSpendKey=key;
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-indian-rupee-sign"></i> Spend - '+esc(ch)+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="width:min(92vw,420px);font-size:13.5px">'+esc(cpMonLabel(CP.month))+' &middot; '+(grp==='digital'?'Digital':'Non Digital')
      +'<div style="margin-top:12px">Project</div><select id="cpSpendBu" class="sel" style="width:100%;height:38px;margin-top:6px" onchange="cpSpendFill()">'
      +list.map(p=>'<option value="'+p[0]+'"'+(String(p[0])===bu?' selected':'')+'>'+esc(p[1])+'</option>').join('')+'</select>'
      +'<div style="margin-top:12px">Amount spent this month (₹)</div><input id="cpSpendIn" type="number" min="0" step="1" style="width:100%;height:38px;margin-top:6px;padding:0 10px;border:1px solid var(--line);border-radius:8px;font:inherit">'
      +'<div id="cpSpendWho" style="font-size:12px;color:var(--slate);margin-top:8px"></div>'
      +((ch==='Facebook'||ch==='Google')?'<div style="font-size:12px;color:var(--slate);margin-top:6px">A typed amount replaces the spend from the CRM\u2019s '+esc(ch)+' report for this project and month. Clear the box and save to go back to it.</div>':'')
      +'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="cpSpendSave()">Save</button></div>','sm');
  cpSpendFill();
  setTimeout(()=>{ const i=$('cpSpendIn'); if(i) i.focus(); },50);
};
window.cpSpendFill=function(){
  const b=Number(($('cpSpendBu')||{}).value), key=window._cpSpendKey;
  const cur=CP.spend.find(s=>s.month===CP.month&&s.bu_id===b&&s.channel===key);
  const i=$('cpSpendIn'); if(i) i.value=cur?Number(cur.amount):'';
  const w=$('cpSpendWho'); if(w) w.textContent=cur&&cur.updated_by?'Last typed by '+cur.updated_by:'';
};
window.cpSpendSave=async function(){
  const key=window._cpSpendKey, bu=Number(($('cpSpendBu')||{}).value);
  if(!bu){ toast('Choose a project','warn'); return; }
  const raw=String(($('cpSpendIn')||{}).value||'').trim();
  // an empty box removes the typed amount (Facebook / Google then show the CRM's spend again)
  if(raw===''){
    const {error}=await sb.schema('acc').from('crm_perf_spend').delete().eq('month',CP.month).eq('bu_id',bu).eq('channel',key);
    if(error){ toast(error.message,'err'); return; }
    CP.spend=CP.spend.filter(s=>!(s.month===CP.month&&s.bu_id===bu&&s.channel===key));
    closeModal(); toast('Typed spend removed','ok'); cpPaint(); return;
  }
  const v=Number(raw); if(!(v>=0)){ toast('Type an amount','warn'); return; }
  const row={month:CP.month,bu_id:bu,channel:key,amount:v,updated_by:state.email,updated_at:new Date().toISOString()};
  const {error}=await sb.schema('acc').from('crm_perf_spend').upsert(row,{onConflict:'month,bu_id,channel'});
  if(error){ toast(error.message,'err'); return; }
  CP.spend=CP.spend.filter(s=>!(s.month===row.month&&s.bu_id===row.bu_id&&s.channel===key)).concat([row]);
  closeModal(); toast('Spend saved','ok'); cpPaint();
};
const CP_CSS='<style>.cp-bar{display:flex;gap:10px;align-items:center;flex-wrap:nowrap;margin:0 0 12px}.cp-bar .sel{flex:0 0 auto;margin-left:auto;max-width:240px}@media(max-width:760px){.cp-bar .sel{max-width:42%}}'
  +'.cp-mon{margin:0;flex:1 1 auto;min-width:0;flex-wrap:nowrap!important;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}.cp-mon>button{flex:0 0 auto;white-space:nowrap}.cp-rng{margin:-4px 0 12px}'
  +'.cp-t{width:100%;border-collapse:collapse;font-size:13px}.cp-t th{position:sticky;top:0;z-index:1;background:#f8fafc;font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:var(--slate);padding:9px 10px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}'
  +'.cp-t td{padding:8px 10px;border-bottom:1px solid #eef1f4;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.cp-t td.cp-ch{text-align:left;font-weight:600}'
  +'.cp-t tr.cp-grp td{background:#eef2ff;color:#3730a3;font-weight:800;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.4px}'
  +'.cp-t tr.cp-tot td{background:#f8fafc;font-weight:800}.cp-t tr.cp-grand td{background:#e2e8f0;font-weight:800;border-top:2px solid #94a3b8}'
  +'.cp-t tr.cp-sub td{color:var(--slate);font-size:12.5px;background:#fcfcfd}.cp-t tr.cp-op{cursor:pointer}.cp-t tr.cp-op:hover td{background:#f8fafc}'
  +'.cp-ed{border:0;background:none;color:#94a3b8;cursor:pointer;padding:0 0 0 4px;font-size:11px}.cp-ed:hover{color:var(--brand)}'
  +'.cp-in{width:96px;height:28px;padding:0 8px;border:1px solid #cbd5e1;border-radius:6px;font:inherit;font-size:12.5px;text-align:right;background:#fff}.cp-in:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 2px rgba(15,118,110,.15)}.cp-in::placeholder{color:#94a3b8}'
  +'.cp-add{height:26px;padding:0 9px;border:1px dashed #94a3b8;border-radius:6px;background:#fff;color:#334155;font:inherit;font-size:12px;font-weight:600;cursor:pointer}.cp-add:hover{border-color:var(--brand);color:var(--brand)}'
  +'.cp-rng{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12.5px;color:var(--slate)}.cp-rng input{height:34px;margin-left:4px;padding:0 8px;border:1px solid var(--line);border-radius:8px;font:inherit}'
  +'.cp-note{font-size:12px;color:var(--slate);margin-top:10px;line-height:1.55}</style>';
