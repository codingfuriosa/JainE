/* ============================ PURCHASE & STORES — STOCK REPORTS (Stage 9) ============================
   Stock summary (as on a date, by project / warehouse / item group), the item-wise stock ledger (opening,
   receipts, issues, returns, adjustments, transfers, closing, with a running balance) and stock ageing.
   Spec: docs/purchase-stores-spec.md §9. Functions: supabase/migrations/20261004390000_purchase_reports.sql
   (report_stock_summary / report_item_ledger / report_stock_ageing - they need the report.view permission).
   Opened from the "Stock & reports" tab through purchase-stores.js. Routes: inventory/6/<summary|item|ageing>. */
(function(){
if(window.__PRP_LOADED) return;
window.__PRP_LOADED=true;

const U=()=>window.PUS;
const qty=n=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:3});
const money=n=>(n==null||n==='')?'—':(Number(n)<0?'−':'')+'₹'+Math.abs(Number(n)).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const num=v=>{const n=parseFloat(v);return isFinite(n)?n:0;};
const r2=n=>Math.round((n+Number.EPSILON)*100)/100;
const ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const today=()=>ymd(new Date());
const fyStart=()=>{ const d=new Date(); return (d.getMonth()<3?d.getFullYear()-1:d.getFullYear())+'-04-01'; };
const itemById=id=>U().S.items.find(i=>i.id===id);
const whById=id=>U().S.warehouses.find(w=>w.id===id);
const projName=id=>{const p=U().S.projects.find(x=>x.id===id);return p?p.name:'—';};
const groupName=id=>{const g=U().S.groups.find(x=>x.id===id);return g?g.name:'—';};
const unitOf=id=>{const i=itemById(id);return i?U().uomCode(i.stock_uom_id):'';};
const R={summary:{on:null,project:'',wh:'',group:''},item:{item:'',wh:'',from:null,to:null},ageing:{on:null,project:'',wh:'',group:'',show:'qty'}};
const TITLES={summary:'Stock summary',item:'Item stock ledger',ageing:'Stock ageing'};
let LAST={rows:[],head:[],name:'report'};   // what is on screen, for the CSV download

// Groups listed parent first with children indented, so a parent filter reads as "this group and everything in it".
function groupOptions(sel){
  const gs=U().S.groups, out=[];
  const walk=(pid,depth)=>gs.filter(g=>(g.parent_id||null)===pid).sort((a,b)=>String(a.name).localeCompare(b.name)).forEach(g=>{ out.push('<option value="'+g.id+'"'+(String(g.id)===String(sel)?' selected':'')+'>'+'&nbsp;&nbsp;'.repeat(depth)+esc(g.name)+'</option>'); walk(g.id,depth+1); });
  walk(null,0); return '<option value="">All item groups</option>'+out.join('');
}
const projOptions=sel=>'<option value="">All projects</option>'+U().S.projects.map(p=>'<option value="'+p.id+'"'+(String(p.id)===String(sel)?' selected':'')+'>'+esc(p.name)+'</option>').join('');
const whOptions=(sel,project)=>'<option value="">All warehouses</option>'+U().S.warehouses.filter(w=>!project||String(w.project_id)===String(project)).map(w=>'<option value="'+w.id+'"'+(String(w.id)===String(sel)?' selected':'')+'>'+esc(w.name)+'</option>').join('');
const bar=(which)=>'<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">'+TITLES[which]+'</div><div class="pus-hint" style="margin:0">'+({
  summary:'Quantity and value of the stock in each warehouse as on a date. Stock is valued at the weighted-average cost.',
  item:'Every movement of one item between two dates, with the balance after each. Opening and closing are shown above.',
  ageing:'How long the stock on hand has been in the store. Stock is used oldest-first, so what is left is counted against the newest receipts.'})[which]+'</div></div>'
  +'<button class="btn" onclick="pusRpCsv()"><i class="fa-solid fa-file-arrow-down"></i> Download CSV</button></div>';
const field=(label,ctl)=>'<label style="display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--slate);margin:0">'+label+ctl+'</label>';
const csvCell=v=>{ const s=String(v==null?'':v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
window.pusRpCsv=function(){
  if(!LAST.rows.length){ toast('Nothing to download','err'); return; }
  const text=[LAST.head].concat(LAST.rows).map(r=>r.map(csvCell).join(',')).join('\r\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['﻿'+text],{type:'text/csv;charset=utf-8'}));
  a.download=LAST.name+'-'+today()+'.csv'; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },500);
};

let SEQ=0, CUR='summary';
window.pusReportRender=async function(host,which){
  CUR=TITLES[which]?which:'summary';
  const mine=++SEQ, stale=()=>mine!==SEQ||!host.isConnected;
  if(!U().can('report.view')){ host.innerHTML=chipBar()+'<div class="empty" style="padding:30px"><i class="fa-solid fa-lock"></i><div>You do not have access to the stock reports. Ask a Purchase administrator for the Reports permission (Admin → Roles).</div></div>'; return; }
  R.summary.on=R.summary.on||today(); R.ageing.on=R.ageing.on||today(); R.item.from=R.item.from||fyStart(); R.item.to=R.item.to||today();
  host.innerHTML=chipBar()+'<div id="prpHost"></div>';
  await draw(stale);
};
const chipBar=()=>'<div class="pus-subs" style="margin-bottom:10px"><span class="chip" onclick="navTo(\'inventory/6/stock\')">Current stock</span><span class="chip" onclick="navTo(\'inventory/6/movements\')">Movements</span>'
  +['summary','item','ageing'].map(k=>'<span class="chip'+(k===CUR?' active':'')+'" onclick="navTo(\'inventory/6/'+k+'\')">'+TITLES[k]+'</span>').join('')+'</div>';
async function draw(stale){
  const host=$('prpHost'); if(!host) return;
  const s=R[CUR];
  let filters;
  if(CUR==='item') filters='<div class="pus-top" style="align-items:flex-end;flex-wrap:wrap;gap:12px">'
    +field('Item','<select id="rpItem" style="min-width:260px" onchange="pusRpGo()"><option value="">Choose an item…</option>'+U().S.items.slice().sort((a,b)=>String(a.name).localeCompare(b.name)).map(i=>'<option value="'+i.id+'"'+(String(i.id)===String(s.item)?' selected':'')+'>'+esc(i.name)+' ('+esc(i.code)+')</option>').join('')+'</select>')
    +field('Warehouse','<select id="rpWh" onchange="pusRpGo()">'+whOptions(s.wh,'')+'</select>')+field('From','<input id="rpFrom" type="date" value="'+esc(s.from)+'" onchange="pusRpGo()">')+field('To','<input id="rpTo" type="date" max="'+today()+'" value="'+esc(s.to)+'" onchange="pusRpGo()">')+'</div>';
  else filters='<div class="pus-top" style="align-items:flex-end;flex-wrap:wrap;gap:12px">'
    +field('As on','<input id="rpOn" type="date" max="'+today()+'" value="'+esc(s.on)+'" onchange="pusRpGo()">')+field('Project','<select id="rpProj" onchange="pusRpProj()">'+projOptions(s.project)+'</select>')
    +field('Warehouse','<select id="rpWh" onchange="pusRpGo()">'+whOptions(s.wh,s.project)+'</select>')+field('Item group','<select id="rpGroup" onchange="pusRpGo()">'+groupOptions(s.group)+'</select>')
    +(CUR==='ageing'?'<div class="pus-subs" style="margin:0 0 4px"><span class="chip'+(s.show==='qty'?' active':'')+'" onclick="pusRpShow(\'qty\')">Quantity</span><span class="chip'+(s.show==='value'?' active':'')+'" onclick="pusRpShow(\'value\')">Value</span></div>':'')+'</div>';
  host.innerHTML=bar(CUR)+filters+'<div id="prpOut"></div>';
  const out=$('prpOut'); loader(out);
  try{ await ({summary:drawSummary,item:drawItem,ageing:drawAgeing}[CUR])(out); }
  catch(e){ if(!stale||!stale()) out.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>'+esc(e.message||e)+'</div></div>'; }
}
function readFilters(){
  const v=U().val, s=R[CUR];
  if(CUR==='item'){ s.item=v('rpItem'); s.wh=v('rpWh'); s.from=v('rpFrom')||s.from; s.to=v('rpTo')||s.to; }
  else { s.on=v('rpOn')||s.on; s.project=v('rpProj'); s.wh=v('rpWh'); s.group=v('rpGroup'); }
}
window.pusRpGo=function(){ readFilters(); draw(); };
window.pusRpProj=function(){ readFilters(); const s=R[CUR]; if(s.wh&&s.project){ const w=whById(parseInt(s.wh,10)); if(!w||String(w.project_id)!==String(s.project)) s.wh=''; } draw(); };
window.pusRpShow=function(k){ R.ageing.show=k; draw(); };
const par=s=>({p_as_on:s.on,p_project:s.project?parseInt(s.project,10):null,p_warehouse:s.wh?parseInt(s.wh,10):null,p_group:s.group?parseInt(s.group,10):null});
const table=(heads,rows,foot)=>'<div class="card" style="padding:0;margin-top:10px"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+heads.map(h=>'<th'+(h[1]?' class="pus-num"':'')+'>'+esc(h[0])+'</th>').join('')+'</tr></thead><tbody>'+rows+(foot||'')+'</tbody></table></div></div>';
const nothing=(n,t)=>'<tr><td colspan="'+n+'"><div class="empty" style="padding:24px"><div>'+t+'</div></div></td></tr>';
const sortRows=list=>list.slice().sort((a,b)=>String((whById(a.warehouse_id)||{}).name).localeCompare(String((whById(b.warehouse_id)||{}).name))||String((itemById(a.item_id)||{}).name).localeCompare(String((itemById(b.item_id)||{}).name)));

/* ---------------- stock summary ---------------- */
async function drawSummary(out){
  const s=R.summary, {data,error}=await U().PU().rpc('report_stock_summary',par(s)); if(error) throw error;
  const list=sortRows(data||[]); let rows='', total=0, sub=0, last=null, subQ=null;
  const flush=()=>{ if(last!==null) rows+='<tr style="background:#f8fafc"><td colspan="6" style="text-align:right"><b>'+esc((whById(last)||{}).name||'')+' — stock value</b></td><td class="pus-num"><b>'+money(r2(sub))+'</b></td></tr>'; };
  const csv=[];
  list.forEach(r=>{ if(last!==r.warehouse_id){ flush(); last=r.warehouse_id; sub=0; }
    const it=itemById(r.item_id)||{}, w=whById(r.warehouse_id)||{}; sub+=+r.value; total+=+r.value;
    rows+='<tr><td>'+esc(w.name||'')+'<div style="font-size:12px;color:var(--slate)">'+esc(projName(w.project_id))+'</div></td><td><b>'+esc(it.name||'')+'</b><div style="font-size:12px;color:var(--slate)">'+esc(it.code||'')+'</div></td><td>'+esc(groupName(it.group_id))+'</td><td>'+esc(unitOf(r.item_id))+'</td><td class="pus-num"><b>'+qty(r.qty)+'</b></td><td class="pus-num">'+money(r.avg_rate)+'</td><td class="pus-num">'+money(r.value)+'</td></tr>';
    csv.push([w.name,projName(w.project_id),it.code,it.name,groupName(it.group_id),unitOf(r.item_id),r.qty,r.avg_rate,r.value]); });
  flush();
  LAST={name:'stock-summary-'+s.on,head:['Warehouse','Project','Item code','Item','Group','Unit','Quantity','Average cost','Value'],rows:csv};
  out.innerHTML='<div class="pus-hint" style="margin:10px 0 0">Stock as on <b>'+U().dmy(s.on)+'</b> · '+list.length+' item'+(list.length===1?'':'s')+' · total value <b>'+money(r2(total))+'</b></div>'
    +table([['Warehouse'],['Item'],['Group'],['Unit'],['Quantity',1],['Average cost',1],['Value',1]],rows||nothing(7,'No stock on this date for these filters'),list.length?'<tr style="background:#eef2f7"><td colspan="6" style="text-align:right"><b>Total stock value</b></td><td class="pus-num"><b>'+money(r2(total))+'</b></td></tr>':'');
}

/* ---------------- item ledger ---------------- */
const CATS=[['receipt','Receipts'],['issue','Issues'],['return','Returns'],['adjustment','Adjustments'],['transfer','Transfers']];
async function drawItem(out){
  const s=R.item;
  if(!s.item){ out.innerHTML='<div class="empty" style="padding:30px"><i class="fa-solid fa-magnifying-glass"></i><div>Choose an item to see its ledger.</div></div>'; LAST={rows:[],head:[],name:'item-ledger'}; return; }
  if(s.from>s.to){ out.innerHTML='<div class="empty" style="padding:30px"><div>The from date is after the to date.</div></div>'; LAST={rows:[],head:[],name:'item-ledger'}; return; }
  const {data,error}=await U().PU().rpc('report_item_ledger',{p_item:parseInt(s.item,10),p_warehouse:s.wh?parseInt(s.wh,10):null,p_from:s.from,p_to:s.to}); if(error) throw error;
  const list=(data||[]).slice().sort((a,b)=>(a.moved_on<b.moved_on?-1:a.moved_on>b.moved_on?1:(+a.seq)-(+b.seq)));
  const open=list.find(x=>x.doc_type==='OPEN')||{qty:0,value:0}, mv=list.filter(x=>x.doc_type!=='OPEN');
  const closing=mv.length?mv[mv.length-1]:open, tot={}; CATS.forEach(c=>tot[c[0]]={q:0,v:0}); mv.forEach(x=>{ const t=tot[x.category]; if(t){ t.q+=+x.qty; t.v+=+x.value; } });
  const it=itemById(parseInt(s.item,10))||{}, u=unitOf(parseInt(s.item,10));
  const cell=(l,q,v,strong)=>'<td class="pus-num" style="vertical-align:top"><div style="font-size:11.5px;color:var(--slate);text-transform:uppercase;letter-spacing:.04em">'+l+'</div><div style="font-size:16px;font-weight:'+(strong?'700':'600')+'">'+qty(q)+' '+esc(u)+'</div><div style="font-size:12px;color:var(--slate)">'+money(r2(v))+'</div></td>';
  const summary='<div class="card" style="padding:0;margin-top:10px"><div style="overflow-x:auto"><table class="tbl"><tbody><tr>'+cell('Opening',+open.qty,+open.value)+CATS.map(c=>{ const out=c[0]==='issue', sg=out?-1:1; return cell(c[1]+(c[0]==='receipt'?' (in)':out?' (out)':' (net)'),sg*tot[c[0]].q,sg*tot[c[0]].v); }).join('')+cell('Closing',+closing.run_qty,+closing.run_value,true)+'</tr></tbody></table></div></div>';
  const csv=[['Opening balance',U().dmy(s.from),'','','',+open.qty,+open.value]];
  const rows=mv.map(x=>{ const w=whById(x.warehouse_id)||{};
    csv.push([x.moved_on,x.doc_type+' '+(x.doc_no||''),w.name,x.narration||'',+x.qty,+x.run_qty,+x.run_value]);
    return '<tr><td style="white-space:nowrap">'+U().dmy(x.moved_on)+'</td><td><span class="pus-code">'+esc(x.doc_type)+'</span> '+esc(x.doc_no||'')+'<div style="font-size:12px;color:var(--slate)">'+esc(x.narration||'')+'</div></td><td>'+esc(w.name||'')+'</td>'
      +'<td class="pus-num" style="color:#15803d">'+(+x.qty>0?qty(x.qty):'')+'</td><td class="pus-num" style="color:#b91c1c">'+(+x.qty<0?qty(-x.qty):'')+'</td><td class="pus-num"><b>'+qty(x.run_qty)+'</b></td><td class="pus-num">'+money(x.run_value)+'</td></tr>'; }).join('');
  LAST={name:'item-ledger-'+(it.code||s.item),head:['Date','Document','Warehouse','Narration','Quantity (+in / −out)','Balance quantity','Balance value'],rows:csv};
  out.innerHTML='<div class="pus-hint" style="margin:10px 0 0"><b>'+esc(it.name||'')+'</b> ('+esc(it.code||'')+') · '+U().dmy(s.from)+' to '+U().dmy(s.to)+(s.wh?' · '+esc((whById(parseInt(s.wh,10))||{}).name||''):' · all warehouses')+'</div>'+summary
    +table([['Date'],['Document'],['Warehouse'],['In',1],['Out',1],['Balance',1],['Balance value',1]],'<tr style="background:#f8fafc"><td>'+U().dmy(s.from)+'</td><td colspan="2"><b>Opening balance</b></td><td></td><td></td><td class="pus-num"><b>'+qty(open.qty)+'</b></td><td class="pus-num">'+money(open.value)+'</td></tr>'+(rows||nothing(7,'No movements in this period')));
}

/* ---------------- stock ageing ---------------- */
const BK=[['b0','0–30 days'],['b1','31–60 days'],['b2','61–90 days'],['b3','91–180 days'],['b4','Over 180 days']];
async function drawAgeing(out){
  const s=R.ageing, {data,error}=await U().PU().rpc('report_stock_ageing',par(s)); if(error) throw error;
  const list=sortRows(data||[]), tv={b0:0,b1:0,b2:0,b3:0,b4:0}; let total=0; const csv=[], showV=s.show==='value';
  const rows=list.map(r=>{ const it=itemById(r.item_id)||{}, w=whById(r.warehouse_id)||{}, avg=+r.qty>0?+r.value/+r.qty:0; total+=+r.value;
    BK.forEach(b=>tv[b[0]]+=+r[b[0]]*avg);
    csv.push([w.name,it.code,it.name,unitOf(r.item_id),+r.qty].concat(BK.map(b=>showV?r2(+r[b[0]]*avg):+r[b[0]]),[r.oldest_days,+r.value]));
    return '<tr><td>'+esc(w.name||'')+'</td><td><b>'+esc(it.name||'')+'</b><div style="font-size:12px;color:var(--slate)">'+esc(it.code||'')+'</div></td><td>'+esc(unitOf(r.item_id))+'</td><td class="pus-num"><b>'+qty(r.qty)+'</b></td>'
      +BK.map(b=>'<td class="pus-num"'+(b[0]==='b4'&&+r[b[0]]>0?' style="color:#b91c1c"':'')+'>'+(+r[b[0]]>0?(showV?money(r2(+r[b[0]]*avg)):qty(r[b[0]])):'—')+'</td>').join('')
      +'<td class="pus-num">'+r.oldest_days+' d</td><td class="pus-num">'+money(r.value)+'</td></tr>'; }).join('');
  LAST={name:'stock-ageing-'+s.on,head:['Warehouse','Item code','Item','Unit','Quantity'].concat(BK.map(b=>b[1]+(showV?' (value)':' (qty)')),['Oldest (days)','Value']),rows:csv};
  const foot=list.length?'<tr style="background:#eef2f7"><td colspan="4" style="text-align:right"><b>'+(showV?'Value in each age band':'Total stock value')+'</b></td>'+(showV?BK.map(b=>'<td class="pus-num"><b>'+money(r2(tv[b[0]]))+'</b></td>').join(''):'<td colspan="5"></td>')+'<td></td><td class="pus-num"><b>'+money(r2(total))+'</b></td></tr>':'';
  out.innerHTML='<div class="pus-hint" style="margin:10px 0 0">Stock as on <b>'+U().dmy(s.on)+'</b> by how long ago it was received · '+list.length+' item'+(list.length===1?'':'s')+' · total value <b>'+money(r2(total))+'</b>'+(showV?'':' · quantities are in each item\'s stock unit')+'</div>'
    +table([['Warehouse'],['Item'],['Unit'],['Quantity',1]].concat(BK.map(b=>[b[1],1]),[['Oldest',1],['Value',1]]),rows||nothing(11,'No stock on this date for these filters'),foot);
}
})();
