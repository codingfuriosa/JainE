
/* ============================ CRM & SALES — QUALIFIED LEADS REPORT (20 Nov 2026) ============================
   Ayush: "I want the data to be uploaded in JainE in CRM & Sales as a new Report divided into Daily, Weekly, Monthly".
   It replaces the Google Sheet "Qualified Leads" that a browser routine filled from RealtyBucket: the CRM's Qualified
   leads from Online + Other Project Campaign, per project. Read-only over acc.crm_qualified_report - the Sheet's rows
   were copied in once, and every night at 02:00 IST acc.crm_qualified_refresh() re-reads the last 30 days from the
   CRM's source report and overwrites any figure that changed, in place. Columns and labels are the Sheet's. */
const CQ_COLS=[[70,'Dream Gurukul'],[3,'Dream World City'],[2,'Dream One'],[6,'Dream Valley'],[5,'Dream Eco City'],[4,'Dream Exotica'],[71,'Durbaar Banquets'],[7,'Dream Pallazo'],[8,'Dream Residency Manor'],[1,'Dream Patham'],[171,'New Project']];
const CQ_KINDS=[['daily','Daily','Day'],['weekly','Weekly','Week'],['monthly','Monthly','Month']];
let CQ={kind:'daily',rows:null};
const CQ_MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
function cqOrd(n){ const s=n%100; return n+((s>10&&s<14)?'th':({1:'st',2:'nd',3:'rd'}[n%10]||'th')); }
function cqDay(d,full){ const p=d.split('-'); return cqOrd(+p[2])+' '+(full?CQ_MON[+p[1]-1]:CQ_MON[+p[1]-1].slice(0,3))+"'"+p[0].slice(2); }
// the Sheet's labels: "1st October'26", "28th Sep'26 - 4th Oct'26", "Oct'26"
function cqLabel(kind,s,e){ if(kind==='daily') return cqDay(s,true); if(kind==='weekly') return cqDay(s,false)+' - '+cqDay(e,false);
  const p=s.split('-'); return CQ_MON[+p[1]-1].slice(0,3)+"'"+p[0].slice(2); }
async function cqLoad(){
  const wrap=$('cqWrap'); if(!wrap) return; loader(wrap);
  const out=[];
  for(let f=0;;f+=1000){
    const q=await sb.schema('acc').from('crm_qualified_report').select('period_start,period_end,bu_id,q,origin,updated_at').eq('kind',CQ.kind).order('period_start',{ascending:false}).range(f,f+999);
    if(q.error){ wrap.innerHTML=/crm_qualified_report|does not exist|schema cache/i.test(q.error.message)
        ?'<div class="card card-pad" style="color:var(--slate)"><i class="fa-solid fa-moon"></i> The report is being set up tonight - it shows here from 20:15 IST today.</div>'
        :'<div class="card card-pad" style="color:#b91c1c">Could not load: '+esc(q.error.message)+'</div>'; return; }
    out.push.apply(out,q.data||[]); if(!q.data||q.data.length<1000) break; }
  CQ.rows=out; cqPaint();
}
function cqPaint(){
  const wrap=$('cqWrap'); if(!wrap||!CQ.rows) return;
  const by={}; let last=null;
  CQ.rows.forEach(function(r){ const x=by[r.period_start]||(by[r.period_start]={s:r.period_start,e:r.period_end,v:{}}); x.v[r.bu_id]=r.q; if(r.origin==='api'&&(!last||r.updated_at>last)) last=r.updated_at; });
  const keys=Object.keys(by).sort().reverse();
  const k=CQ_KINDS.filter(function(x){ return x[0]===CQ.kind; })[0];
  const th='<th style="text-align:left">'+k[2]+'</th>'+CQ_COLS.map(function(c){ return '<th>'+esc(c[1])+'</th>'; }).join('')+'<th>Total</th>';
  const body=keys.map(function(p){ const x=by[p]; let t=0;
    const cells=CQ_COLS.map(function(c){ const v=x.v[c[0]]||0; t+=v; return '<td'+(v?'':' style="color:#cbd5e1"')+'>'+v+'</td>'; }).join('');
    return '<tr><td style="text-align:left;font-weight:600">'+esc(cqLabel(CQ.kind,x.s,x.e))+'</td>'+cells+'<td><b>'+t+'</b></td></tr>'; }).join('');
  wrap.innerHTML='<div class="cq-tabs">'+CQ_KINDS.map(function(x){ return '<button type="button" class="'+(x[0]===CQ.kind?'on':'')+'" onclick="cqKind(\''+x[0]+'\')">'+x[1]+'</button>'; }).join('')+'</div>'
    +'<div class="card" style="padding:0;overflow:auto;max-height:70vh"><table class="cq-t"><thead><tr>'+th+'</tr></thead><tbody>'
    +(body||'<tr><td colspan="13" style="text-align:center;color:var(--slate);padding:24px">Nothing yet</td></tr>')+'</tbody></table></div>'
    +'<div style="font-size:12px;color:var(--slate);margin-top:10px;line-height:1.5">Qualified leads from Online + Other Project Campaign, as the CRM counts them. Every night at 2:00 the last 30 days are read again and any changed figure is corrected in place.'+(last?' Last corrected '+esc(fmtDate(last))+'.':'')+'</div>';
}
window.cqKind=function(k){ CQ.kind=k; cqLoad(); };
const CQ_CSS='<style>.cq-tabs{display:inline-flex;gap:4px;background:#f1f5f9;border-radius:10px;padding:4px;margin:0 0 12px}'
  +'.cq-tabs button{border:0;background:transparent;font:inherit;font-size:13px;font-weight:600;color:var(--slate);padding:7px 16px;border-radius:7px;cursor:pointer}'
  +'.cq-tabs button.on{background:var(--bg-card,#fff);color:var(--ink);box-shadow:0 1px 3px rgba(15,23,42,.12)}'
  +'.cq-t{width:100%;border-collapse:collapse;font-size:13px}.cq-t th{position:sticky;top:0;z-index:1;background:#f8fafc;font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:var(--slate);padding:9px 10px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}'
  +'.cq-t td{padding:8px 10px;border-bottom:1px solid #eef1f4;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.cq-t tr:hover td{background:#f8fafc}</style>';
