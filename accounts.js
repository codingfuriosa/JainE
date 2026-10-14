/* ============================ ACCOUNTS - TRANSACTIONS (tab 1) ============================
   Enterprise > Company > Business unit structure, vouchers (receipt, payment, deposit, withdrawal, contra),
   bills payable with on-account payments and adjustments. Bank reconciliation and cheque printing are in
   accounts-bank.js; the Ledgers & postings tab is accounts-books.js. All three share window.ACX.
   Spec: docs/accounts-spec.md. Tables and functions: supabase/migrations/20261005100000_accounts_core.sql,
   ..110000_accounts_payables_banking.sql, ..120000_accounts_postings_reports.sql.

   Loaded on demand by nexus-core.js (PAGE_EXTRA_SCRIPT.accounts); the guard below skips a second run.
   Routes: accounts/0/<structure|vouchers|deposits|contra|bills|brs|cheques>. */
(function(){
if(window.__ACX_LOADED) return;
window.__ACX_LOADED=true;

const AC=()=>sb.schema('accounts');
const PU=()=>sb.schema('purchase');
const S={ready:false,ent:[],co:[],bu:[],projects:[],psCodes:{},vendors:[],users:[],access:[],entId:null,coId:null,buId:'',isAdmin:false,canPost:false,
         groups:[],ledgers:[],subCache:{},sec:'vouchers'};
const X=window.ACX={S,AC,PU};

/* ---------------- small helpers ---------------- */
const num=v=>{const n=parseFloat(String(v==null?'':v).replace(/,/g,''));return isFinite(n)?n:0;};
const r2=n=>Math.round((n+Number.EPSILON)*100)/100;
const money=n=>(n==null||n==='')?'—':Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const drcr=n=>{n=Number(n||0);if(Math.abs(n)<0.005)return '0.00';return money(Math.abs(n))+(n>0?' Dr':' Cr');};
const dmy=d=>{if(!d)return '—';const t=String(d).slice(0,10).split('-');return t.length===3?t[2]+'-'+t[1]+'-'+t[0]:String(d);};
const dmyTime=d=>{if(!d)return '—';const dt=new Date(d);return isNaN(dt)?'—':dt.toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});};
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const val=id=>{const e=$(id);return e?String(e.value).trim():'';};
const chk=id=>{const e=$(id);return !!(e&&e.checked);};
const MODES=[['cash','Cash'],['cheque','Cheque'],['dd','Demand draft'],['neft','NEFT'],['rtgs','RTGS'],['imps','IMPS'],['upi','UPI'],['transfer','Bank transfer'],['other','Other']];
const MODE_LABEL={};MODES.forEach(m=>MODE_LABEL[m[0]]=m[1]);
const VTYPE={receipt:['Receipt','t-green'],payment:['Payment','t-red'],deposit:['Deposit','t-blue'],withdrawal:['Withdrawal','t-amber'],contra:['Contra','t-purple'],journal:['Journal','t-gray'],
             purchase_bill:['Bill','t-gray'],debit_note:['Debit note','t-gray'],ra_bill:['RA bill','t-gray'],advance_receipt:['Customer receipt','t-green'],customer_gst:['GST on invoice','t-gray']};
const vtag=t=>{const x=VTYPE[t]||[t,'t-gray'];return '<span class="tag '+x[1]+'">'+esc(x[0])+'</span>';};
const SRC_LABEL={purchase_bill:'Purchase bill',purchase_dn:'Debit note',ra_bill:'RA bill',ps_receipt:'Post Sales receipt',ps_invoice:'Post Sales invoice'};
const opt=(v,l,sel)=>'<option value="'+esc(v)+'"'+(String(v)===String(sel)?' selected':'')+'>'+esc(l)+'</option>';
const opts=(list,sel,blank)=>(blank!=null?'<option value="">'+esc(blank)+'</option>':'')+list.map(x=>opt(x[0],x[1],sel)).join('');
const field=(label,ctl,cls)=>'<div class="acx-field'+(cls?' '+cls:'')+'"><label>'+label+'</label>'+ctl+'</div>';
const errHtml=e=>'<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load Accounts: '+esc((e&&e.message)||e)+'</div></div>';

function fail(error,what){
  if(!error) return false;
  let m=error.message||String(error);
  const map=[[/enterprises_name_uq/,'an enterprise with that name already exists'],[/companies_name_uq/,'a company with that name already exists'],
    [/companies_code_uq/,'another company already uses that short code'],[/business_units_code_uq/,'that code is already used in this company'],
    [/business_units_name_uq/,'a business unit with that name already exists in this company'],[/business_units_project_uq/,'that project is already a business unit'],
    [/ledgers_code_uq/,'another ledger already uses that code'],[/ledgers_name_uq/,'a ledger with that name already exists'],[/ledgers_key_uq/,'another ledger already plays that role'],
    [/ledgers_psbank_uq/,'that Post Sales account is already linked to another ledger'],[/account_groups_name_uq/,'a group with that name already exists here'],
    [/sub_ledgers_name_uq/,'a sub-ledger with that name already exists'],[/cheques_ledger_id_cheque_no_key/,'that cheque number has already been used'],
    [/cheque_books_check/,'check the cheque book numbers (from, to and next)'],[/row-level security/,'you do not have permission for this'],
    [/opening_balances_uq/,'an opening balance already exists for that combination'],[/violates foreign key/,'it is still in use elsewhere']];
  for(const x of map){ if(x[0].test(m)){ m=x[1]; break; } }
  toast((what||'Could not save')+': '+m,'err'); return true;
}
const rpc=(name,args)=>AC().rpc(name,args||{});

function css(){
  if($('acxCss')) return;
  const st=document.createElement('style'); st.id='acxCss';
  st.textContent=`
  .acx-scope{display:flex;gap:10px 22px;align-items:center;flex-wrap:wrap;background:var(--bg-card,#fff);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin-bottom:14px}
  .acx-scope .sc{display:flex;align-items:center;gap:8px}
  .acx-scope label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--slate);font-weight:700}
  .acx-scope select{height:34px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font-size:13.5px;font-family:inherit;background:#fff;color:var(--ink);max-width:250px}
  .acx-subs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 16px}
  .acx-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
  .acx-top select,.acx-top input{height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font-size:13.5px;font-family:inherit;background:var(--bg-card,#fff);color:var(--ink)}
  .acx-top .grow{flex:1;min-width:180px}
  .acx-hint{font-size:12.5px;color:var(--slate)}
  .acx-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .acx-code{font-size:12px;font-weight:700;padding:2px 8px;border-radius:6px;background:#ecfeff;color:#0e7490;white-space:nowrap}
  .acx-act{white-space:nowrap;text-align:right}
  .acx-grid2,.acx-grid3,.acx-grid4{display:grid;gap:12px 16px;margin-bottom:14px}
  .acx-grid2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .acx-grid3{grid-template-columns:repeat(3,minmax(0,1fr))}
  .acx-grid4{grid-template-columns:repeat(4,minmax(0,1fr))}
  @media(max-width:760px){.acx-grid2,.acx-grid3,.acx-grid4{grid-template-columns:minmax(0,1fr)}}
  .acx-bal{font-size:12px;color:var(--slate);margin-top:4px;min-height:16px}.acx-bal b{color:var(--ink)}
  .acx-field input.acx-ro{background:#f1f5f9;color:#334155}
  .acx-field label{display:block;font-size:12px;font-weight:600;color:var(--slate);margin-bottom:4px}
  .acx-field input,.acx-field select,.acx-field textarea{width:100%;height:38px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font-size:13.5px;font-family:inherit;background:#fff;color:var(--ink);box-sizing:border-box}
  .acx-field textarea{height:auto;padding:8px 10px;resize:vertical}
  .acx-field input[type=checkbox]{width:auto;height:auto}
  .acx-field .h{font-size:11.5px;color:var(--slate);margin-top:3px}
  .acx-lines-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;margin-bottom:12px}
  .acx-lines{width:100%;border-collapse:collapse;font-size:13px;min-width:720px}
  .acx-lines th{background:#f8fafc;text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--slate);padding:8px 8px;border-bottom:1px solid var(--line)}
  .acx-lines td{padding:6px 6px;vertical-align:top;border-bottom:1px solid var(--line-2,#eef0f3)}
  .acx-lines select,.acx-lines input{width:100%;height:34px;border:1px solid var(--line);border-radius:6px;padding:0 8px;font-size:13px;font-family:inherit;background:#fff;color:var(--ink);box-sizing:border-box}
  .acx-lines input.n{text-align:right;font-variant-numeric:tabular-nums}
  .acx-tot{display:flex;justify-content:flex-end;gap:24px;font-size:14px;padding:4px 4px 10px}
  .acx-tot b{font-variant-numeric:tabular-nums}
  .acx-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px}
  .acx-kpi{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--bg-card,#fff)}
  .acx-kpi .k{font-size:11px;color:var(--slate);text-transform:uppercase;letter-spacing:.05em;font-weight:700}
  .acx-kpi .v{font-size:20px;font-weight:800;margin-top:4px;font-variant-numeric:tabular-nums}
  .acx-kpi .s{font-size:12px;color:var(--slate);margin-top:2px}
  .acx-warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:12px}
  .acx-ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:12px}
  .acx-ent{margin-bottom:16px;padding:0;overflow:hidden}
  .acx-ent-h{display:flex;align-items:center;gap:10px;padding:12px 16px;background:#f0f9ff;border-bottom:1px solid var(--line)}
  .acx-co{padding:12px 16px 4px;border-bottom:1px solid var(--line-2,#eef0f3)}
  .acx-co:last-child{border-bottom:none}
  .acx-co-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
  .acx-co-meta{font-size:12.5px;color:var(--slate)}
  .acx-bu{margin:0 0 10px 26px;border-left:2px solid #bae6fd;padding-left:12px}
  .acx-bu-row{display:flex;align-items:center;gap:10px;padding:5px 0;font-size:13.5px}
  .acx-bu-row .grow,.acx-co-h .grow,.acx-ent-h .grow{flex:1}
  .acx-sec-title{font-size:14px;font-weight:700;margin:18px 0 8px}
  .acx-mini td,.acx-mini th{font-size:12.5px}
  .acx-pill{display:inline-block;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px;background:#f1f5f9;color:#475569}
  .acx-link{color:var(--brand);cursor:pointer;font-weight:600}
  .acx-chk{width:16px;height:16px}
  .acx-sticky-foot{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .acx-dim{color:var(--slate)}
  .acx-right{margin-left:auto}
  `;
  document.head.appendChild(st);
}
X.css=css;

/* ---------------- base data ---------------- */
async function loadBase(){
  const [en,co,bu,pr,ps,ve,us,ac,ia,cp]=await Promise.all([
    AC().from('enterprises').select('*').order('name'),
    AC().from('companies').select('*').order('name'),
    AC().from('business_units').select('*').order('name'),
    sb.schema('cust').from('projects').select('id,name').order('name'),
    sb.schema('postsales').from('project_setup').select('project_id,code'),
    PU().from('vendors').select('id,code,legal_name,trade_name,status,gstin').is('deleted_at',null).order('legal_name'),
    sb.schema('adm').from('users').select('email,full_name,active').order('full_name'),
    AC().from('access').select('*').order('email'),
    AC().rpc('is_admin'),AC().rpc('can_post')
  ]);
  const bad=[en,co,bu,ia,cp].find(r=>r.error);
  if(bad) throw bad.error;
  S.ent=en.data||[]; S.co=co.data||[]; S.bu=bu.data||[]; S.projects=pr.data||[]; S.vendors=ve.data||[]; S.users=(us.data||[]).filter(u=>u.active!==false);
  S.access=ac.data||[]; S.isAdmin=ia.data===true; S.canPost=cp.data===true;
  S.psCodes={}; (ps.data||[]).forEach(p=>S.psCodes[p.project_id]=p.code);
  // restore the last scope, then make sure it still exists
  if(S.coId==null){ try{ const j=JSON.parse(localStorage.getItem('acx.scope')||'null'); if(j){ S.coId=j.co||null; S.buId=j.bu||''; } }catch(e){} }
  if(!S.co.find(c=>c.id===S.coId)) S.coId=(S.co.find(c=>c.active)||S.co[0]||{}).id||null;
  const cur=S.co.find(c=>c.id===S.coId);
  S.entId=cur?cur.enterprise_id:((S.ent[0]||{}).id||null);
  if(S.buId&&!S.bu.find(b=>String(b.id)===String(S.buId)&&b.company_id===S.coId)) S.buId='';
  S.ready=true;
}
async function loadLedgers(){
  if(!S.coId){ S.groups=[]; S.ledgers=[]; return; }
  const [g,l]=await Promise.all([
    AC().from('account_groups').select('*').eq('company_id',S.coId).order('sort_order').order('name'),
    AC().from('ledgers').select('*').eq('company_id',S.coId).order('code')
  ]);
  if(g.error) throw g.error; if(l.error) throw l.error;
  S.groups=g.data||[]; S.ledgers=l.data||[]; S.subCache={};
}
X.loadBase=loadBase; X.loadLedgers=loadLedgers;
const curCo=()=>S.co.find(c=>c.id===S.coId)||null;
const coBus=()=>S.bu.filter(b=>b.company_id===S.coId);
const buName=id=>{const b=S.bu.find(x=>x.id===id);return b?b.name:'—';};
const ledgerById=id=>S.ledgers.find(l=>l.id===id)||null;
const ledName=id=>{const l=ledgerById(id);return l?l.name:'#'+id;};
const vendorName=id=>{const v=S.vendors.find(x=>x.id===id);return v?(v.trade_name||v.legal_name):'#'+id;};
const projName=id=>{const p=S.projects.find(x=>x.id===id);return p?p.name:'—';};
const cashBank=()=>S.ledgers.filter(l=>l.active&&l.ledger_type==='general'&&(l.is_bank||l.is_cash));
const groupName=id=>{const g=S.groups.find(x=>x.id===id);return g?g.name:'';};
async function subsOf(ledgerId){
  if(S.subCache[ledgerId]) return S.subCache[ledgerId];
  const {data,error}=await AC().from('sub_ledgers').select('id,name,party_type,party_id,active').eq('ledger_id',ledgerId).eq('active',true).order('name').limit(5000);
  if(error){ fail(error,'Could not load sub-ledgers'); return []; }
  S.subCache[ledgerId]=data||[]; return S.subCache[ledgerId];
}
function fyStart(date){
  const co=curCo(); const m=co?co.fy_start_month:4; const d=date?new Date(date):new Date();
  const y=(d.getMonth()+1)<m?d.getFullYear()-1:d.getFullYear();
  return y+'-'+String(m).padStart(2,'0')+'-01';
}
// <option>s of the company's general ledgers, grouped by their chart group
function ledgerOpts(filter,selected,blank){
  const byG={}; S.ledgers.filter(l=>l.active&&l.ledger_type==='general'&&(!filter||filter(l))).forEach(l=>{(byG[l.group_id]=byG[l.group_id]||[]).push(l);});
  const order={asset:1,liability:2,income:3,expense:4};
  const gs=S.groups.filter(g=>byG[g.id]).sort((a,b)=>(order[a.nature]||9)-(order[b.nature]||9)||a.name.localeCompare(b.name));
  return (blank!=null?'<option value="">'+esc(blank)+'</option>':'')+gs.map(g=>'<optgroup label="'+esc(g.name)+'">'+byG[g.id].map(l=>opt(l.id,l.name+(l.sub_ledger_type?' ›':''),selected)).join('')+'</optgroup>').join('');
}
function costOpts(selected,blank){
  return '<option value="">'+esc(blank||'—')+'</option>'+S.ledgers.filter(l=>l.active&&l.ledger_type!=='general').map(l=>opt(l.id,l.name+' ('+(l.ledger_type==='cost'?'cost':'custom')+')',selected)).join('');
}
X.ledgerOpts=ledgerOpts; X.costOpts=costOpts;

// Indian rupees in words, for cheques and vouchers
function inrWords(n){
  n=Math.round(Number(n||0)*100)/100; const rup=Math.floor(n), pa=Math.round((n-rup)*100);
  const ones=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const two=x=>x<20?ones[x]:tens[Math.floor(x/10)]+(x%10?' '+ones[x%10]:'');
  const three=x=>{const h=Math.floor(x/100),r=x%100;return (h?ones[h]+' Hundred'+(r?' ':''):'')+(r?two(r):'');};
  const p=[]; const cr=Math.floor(rup/10000000), la=Math.floor(rup/100000)%100, th=Math.floor(rup/1000)%100, rest=rup%1000;
  if(cr) p.push(three(cr)+' Crore'); if(la) p.push(two(la)+' Lakh'); if(th) p.push(two(th)+' Thousand'); if(rest) p.push(three(rest));
  let s='Rupees '+(p.join(' ')||'Zero'); if(pa) s+=' and '+two(pa)+' Paise'; return s+' Only';
}
X.inrWords=inrWords;

/* ---------------- downloads: Excel (.xlsx) and PDF ----------------
   Every list and report offers both, laid out like the screen it came from (filters included): a header with the
   company, the title, what was filtered and who made it, the table, and a totals row. Excel has real numbers and
   dates; the PDF has page numbers. Built with ExcelJS and jsPDF + autoTable, loaded on first use (Post Sales and
   Usability already use them).
   spec = { title, sub, file, cols:[{h, t:'t'|'n'|'d'|'b'}], rows:[[...]], foot:[...], summary:[[label, value, type, bold]], orient }
   column types: t text, n amount, d date, b balance (a signed number shown as "x Dr" / "x Cr") */
const DL_BRAND='FF0E7490', DL_RGB=[14,116,144];
const XL_IND2='[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';
function dlBtns(fn,first,all){
  return '<button class="btn '+(all||'')+' '+(first||'')+'" onclick="'+fn+'(\'xlsx\',this)" title="Download as an Excel file"><i class="fa-solid fa-file-excel" style="color:#15803d"></i> Excel</button>'
    +'<button class="btn '+(all||'')+'" onclick="'+fn+'(\'pdf\',this)" title="Download as a PDF"><i class="fa-solid fa-file-pdf" style="color:#b91c1c"></i> PDF</button>';
}
const dlCompany=()=>{const c=curCo(); return c?c.name:'Accounts';};
const dlStamp=()=>{const d=new Date(); return dmy(today())+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+' by '+String((typeof state!=='undefined'&&state&&state.email)||'').split('@')[0];};
const dlFile=(spec,ext)=>String(spec.file||spec.title).replace(/[^\w ]+/g,' ').trim().replace(/\s+/g,'_')+'_'+today()+'.'+ext;
const dlTxt=(c,v,t)=>{
  t=t||c.t; if(v==null||v==='') return '';
  if(t==='d') return dmy(v);
  if(t==='n') return money(v);
  if(t==='b') return (typeof v==='number'||/^-?[0-9.]+$/.test(String(v)))?drcr(v):String(v);
  return String(v);
};
const pdfSafe=s=>String(s==null?'':s).replace(/›/g,'>').replace(/₹/g,'Rs.').replace(/[^ -~ -ÿ–—‘’“”•…]/g,'?');
const dlDate=v=>{const t=String(v).slice(0,10).split('-'); return new Date(Date.UTC(+t[0],+t[1]-1,+t[2]));};   // UTC, so Excel shows the same day in India

async function dlExcel(spec){
  if(!(await usbLoadXlsx())) throw new Error('could not load the spreadsheet library - check the internet connection and try again');
  const cols=spec.cols, n=cols.length;
  const wb=new ExcelJS.Workbook(); wb.creator='JAIN-E'; wb.created=new Date();
  const ws=wb.addWorksheet(String(spec.title).replace(/[^\w &-]/g,'').slice(0,31).trim()||'Report');
  const band=(row,text,font)=>{ if(n>1) ws.mergeCells(row,1,row,n); const c=ws.getCell(row,1); c.value=text; c.font=font; c.alignment={horizontal:'left',vertical:'middle'}; };
  band(1,dlCompany(),{size:15,bold:true,color:{argb:DL_BRAND}}); ws.getRow(1).height=22;
  band(2,spec.title,{size:13,bold:true}); ws.getRow(2).height=19;
  band(3,spec.sub||'',{size:10.5,italic:true,color:{argb:'FF475569'}});
  band(4,'Generated on '+dlStamp()+' · JAIN-E Accounts',{size:9,color:{argb:'FF94A3B8'}});
  const thin={style:'thin',color:{argb:'FFE4E4E7'}};
  let r=6;
  if(spec.summary&&spec.summary.length){
    const k=Math.max(1,n-2);
    spec.summary.forEach(s=>{
      if(k>1) ws.mergeCells(r,1,r,k); if(n>k+1) ws.mergeCells(r,k+1,r,n);
      const a=ws.getCell(r,1), b=ws.getCell(r,k+1), t=s[2]||'t';
      a.value=s[0]; a.font={size:10,bold:!!s[3]}; a.alignment={vertical:'middle',wrapText:true};
      if(t==='n'&&s[1]!==''&&s[1]!=null){ b.value=Math.round(Number(s[1])*100)/100; b.numFmt=XL_IND2; } else b.value=dlTxt({t},s[1],t);
      b.font={size:10,bold:!!s[3]}; b.alignment={horizontal:'right',vertical:'middle'};
      for(let i=1;i<=n;i++){ ws.getCell(r,i).border={bottom:thin}; if(s[3]) ws.getCell(r,i).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF1F5F9'}}; }
      r++;
    });
    r++;
  }
  const headRow=r, hr=ws.getRow(r); hr.values=cols.map(c=>c.h); hr.height=28;
  hr.eachCell(c=>{ c.font={bold:true,color:{argb:'FFFFFFFF'},size:10}; c.fill={type:'pattern',pattern:'solid',fgColor:{argb:DL_BRAND}}; c.alignment={vertical:'middle',horizontal:'center',wrapText:true}; c.border={top:thin,left:thin,bottom:thin,right:thin}; });
  ws.views=[{state:'frozen',ySplit:headRow}];
  const cell=(c,v)=>{ if(v==null||v==='') return null; if(c.t==='n') return Math.round(Number(v)*100)/100; if(c.t==='d') return dlDate(v); if(c.t==='b') return dlTxt(c,v); return v; };
  spec.rows.forEach((rowv,ri)=>{
    const row=ws.addRow(cols.map((c,i)=>cell(c,rowv[i])));
    row.eachCell({includeEmpty:true},(cl,ci)=>{ const c=cols[ci-1]; cl.border={top:thin,left:thin,bottom:thin,right:thin}; cl.font={size:10};
      if(ri%2===1) cl.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF0FDFA'}};
      if(c.t==='n'){ cl.numFmt=XL_IND2; cl.alignment={horizontal:'right',vertical:'top'}; }
      else if(c.t==='b') cl.alignment={horizontal:'right',vertical:'top'};
      else if(c.t==='d'){ cl.numFmt='dd-mm-yyyy'; cl.alignment={horizontal:'center',vertical:'top'}; }
      else cl.alignment={vertical:'top',wrapText:true}; });
  });
  if(spec.foot){
    const tr=ws.addRow(cols.map((c,i)=>cell(c,spec.foot[i])));
    tr.height=20;
    tr.eachCell({includeEmpty:true},(cl,ci)=>{ const c=cols[ci-1]; cl.font={bold:true,size:10.5}; cl.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFCCFBF1'}};
      cl.border={top:{style:'medium',color:{argb:DL_BRAND}},left:thin,bottom:{style:'double',color:{argb:DL_BRAND}},right:thin};
      if(c.t==='n'){ cl.numFmt=XL_IND2; cl.alignment={horizontal:'right'}; } else if(c.t==='b') cl.alignment={horizontal:'right'}; });
  }
  cols.forEach((c,i)=>{ const lens=[String(c.h).length*0.85].concat(spec.rows.slice(0,400).map(rv=>dlTxt(c,rv[i]).length)).concat(spec.foot?[dlTxt(c,spec.foot[i]).length]:[]);
    ws.getColumn(i+1).width=Math.max(c.t==='n'||c.t==='b'?15:(c.t==='d'?12:9),Math.min(46,Math.max.apply(null,lens)+3)); });
  if(spec.rows.length) ws.autoFilter={from:{row:headRow,column:1},to:{row:headRow,column:n}};
  ws.pageSetup={orientation:spec.orient==='portrait'?'portrait':'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:0.4,right:0.4,top:0.5,bottom:0.6,header:0.2,footer:0.3},printTitlesRow:headRow+':'+headRow};
  ws.headerFooter={oddFooter:'&L&8'+dlCompany().replace(/&/g,'&&')+' · JAIN-E Accounts&C&8'+String(spec.title).replace(/&/g,'&&')+'&R&8Page &P of &N'};
  const buf=await wb.xlsx.writeBuffer();
  usbSaveBlob(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),dlFile(spec,'xlsx'));
}

let _dlPdfP=null;
function dlLoadPdf(){
  if(window.jspdf&&window.jspdf.jsPDF&&window.jspdf.jsPDF.API.autoTable) return Promise.resolve(window.jspdf.jsPDF);
  if(_dlPdfP) return _dlPdfP;
  const add=src=>new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('could not load the PDF library - check the internet connection and try again'));document.head.appendChild(s);});
  _dlPdfP=add('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
    .then(()=>add('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'))
    .then(()=>window.jspdf.jsPDF).catch(e=>{_dlPdfP=null;throw e;});
  return _dlPdfP;
}
async function dlPdf(spec){
  const jsPDF=await dlLoadPdf(), cols=spec.cols;
  const doc=new jsPDF({orientation:spec.orient==='portrait'?'portrait':'landscape',unit:'pt',format:'a4'});
  const W=doc.internal.pageSize.getWidth(), H=doc.internal.pageSize.getHeight(), M=30, done={};
  const header=()=>{
    const p=doc.internal.getCurrentPageInfo().pageNumber; if(done[p]) return; done[p]=1;
    doc.setFillColor(...DL_RGB); doc.rect(0,0,W,56,'F');
    doc.setTextColor(255); doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.text(pdfSafe(dlCompany()),M,24);
    doc.setFontSize(11); doc.text(pdfSafe(spec.title),M,42);
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.text(pdfSafe('Generated '+dlStamp()),W-M,24,{align:'right'}); doc.text('JAIN-E Accounts',W-M,42,{align:'right'});
    doc.setTextColor(71,85,105); doc.setFontSize(9); doc.text(pdfSafe(spec.sub||'')+(spec.sub?'':''),M,72,{maxWidth:W-2*M});
  };
  const footer=()=>{ const p=doc.internal.getCurrentPageInfo().pageNumber; doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(148,163,184);
    doc.text(pdfSafe(dlCompany()+' · '+spec.title),M,H-16); doc.text('Page '+p+' of {total}',W-M,H-16,{align:'right'}); };
  let y=84;
  if(spec.summary&&spec.summary.length){
    doc.autoTable({ body:spec.summary.map(s=>[pdfSafe(s[0]),pdfSafe(dlTxt({t:s[2]||'t'},s[1],s[2]||'t'))]), startY:y, margin:{left:M,right:M,top:70,bottom:34}, theme:'plain',
      styles:{font:'helvetica',fontSize:8.6,cellPadding:3.2,textColor:[15,23,42],lineColor:[228,228,231],lineWidth:0.3},
      columnStyles:{0:{cellWidth:'auto'},1:{halign:'right',cellWidth:150}},
      didParseCell:d=>{ if(spec.summary[d.row.index]&&spec.summary[d.row.index][3]){ d.cell.styles.fontStyle='bold'; d.cell.styles.fillColor=[241,245,249]; } },
      didDrawPage:()=>{ header(); footer(); } });
    y=doc.lastAutoTable.finalY+14;
  }
  const colStyles={}; cols.forEach((c,i)=>{ if(c.t==='n'||c.t==='b') colStyles[i]={halign:'right'}; else if(c.t==='d') colStyles[i]={halign:'center'}; });
  doc.autoTable({
    head:[cols.map(c=>pdfSafe(c.h))],
    body:spec.rows.map(rv=>cols.map((c,i)=>pdfSafe(dlTxt(c,rv[i])))),
    foot:spec.foot?[cols.map((c,i)=>pdfSafe(dlTxt(c,spec.foot[i])))]:undefined,
    startY:y, margin:{left:M,right:M,top:84,bottom:34}, theme:'striped',
    styles:{font:'helvetica',fontSize:cols.length>10?6.8:(cols.length>8?7.4:8),cellPadding:3.4,overflow:'linebreak',valign:'top',lineColor:[228,228,231],lineWidth:0.3,textColor:[15,23,42]},
    headStyles:{fillColor:DL_RGB,textColor:255,fontStyle:'bold',halign:'center',valign:'middle'},
    footStyles:{fillColor:[204,251,241],textColor:[19,78,74],fontStyle:'bold'},
    alternateRowStyles:{fillColor:[240,253,250]},
    columnStyles:colStyles,
    didParseCell:d=>{ if(d.section==='foot'){ const c=cols[d.column.index]||{}; if(c.t==='n'||c.t==='b') d.cell.styles.halign='right'; } },
    didDrawPage:()=>{ header(); footer(); }
  });
  if(typeof doc.putTotalPages==='function') doc.putTotalPages('{total}');
  doc.save(dlFile(spec,'pdf'));
}
async function download(fmt,spec,btn){
  if(!spec.rows.length&&!(spec.summary&&spec.summary.length)){ toast('Nothing to download for these filters','warn'); return; }
  const restore=btn?btn.innerHTML:''; if(btn){ btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> '+(fmt==='pdf'?'PDF':'Excel'); }
  try{ if(fmt==='pdf') await dlPdf(spec); else await dlExcel(spec); toast((fmt==='pdf'?'PDF':'Excel file')+' downloaded','ok'); }
  catch(e){ console.error(e); toast('Could not build the '+(fmt==='pdf'?'PDF':'Excel file')+': '+((e&&e.message)||e),'err'); }
  finally{ if(btn){ btn.disabled=false; btn.innerHTML=restore; } }
}
Object.assign(X,{download,dlBtns,dlCompany});

function askReason(title,label,okLabel){
  return new Promise(res=>{
    X._reasonRes=res;
    openModal('<div class="modal-head"><h3>'+esc(title)+'</h3><span class="x" onclick="ACX.reasonDone(null)">&times;</span></div><div class="modal-body"><div class="acx-field"><label>'+esc(label)+'</label><textarea id="acxReason" rows="3"></textarea></div></div>'
      +'<div class="modal-foot"><button class="btn" onclick="ACX.reasonDone(null)">Cancel</button><button class="btn btn-danger" onclick="ACX.reasonDone(document.getElementById(\'acxReason\').value)">'+esc(okLabel||'Confirm')+'</button></div>');
    setTimeout(()=>{const e=$('acxReason'); if(e) e.focus();},60);
  });
}
X.reasonDone=function(v){ closeModal(); const r=X._reasonRes; X._reasonRes=null; if(r) r(v==null?null:String(v).trim()); };
X.askReason=askReason;

/* ---------------- shell shared by both tabs ---------------- */
let SEQ=0;
const SECS=[['structure','Structure'],['vouchers','Receipts & payments'],['deposits','Deposits & withdrawals'],['contra','Contra'],['journal','Journal'],['bills','Bills & on-account'],['brs','Bank reconciliation'],['cheques','Cheque printing']];
function scopeBar(){
  const ents=S.ent, cos=S.co.filter(c=>c.enterprise_id===S.entId), bus=coBus();
  return '<div class="acx-scope">'
    +'<div class="sc"><label>Enterprise</label><select id="acxEnt" onchange="acxSetEnt()">'+ents.map(e=>opt(e.id,e.name,S.entId)).join('')+'</select></div>'
    +'<div class="sc"><label>Company</label><select id="acxCo" onchange="acxSetCo()">'+cos.map(c=>opt(c.id,c.name+(c.active?'':' (inactive)'),S.coId)).join('')+'</select></div>'
    +'<div class="sc"><label>Business unit</label><select id="acxBu" onchange="acxSetBu()">'+opt('','All business units',S.buId)+bus.map(b=>opt(b.id,b.name+(b.active?'':' (inactive)'),S.buId)).join('')+'</select></div>'
    +'</div>';
}
function persistScope(){ try{ localStorage.setItem('acx.scope',JSON.stringify({co:S.coId,bu:S.buId})); }catch(e){} }
window.acxSetEnt=function(){ S.entId=parseInt(val('acxEnt'),10); const c=S.co.find(x=>x.enterprise_id===S.entId&&x.active)||S.co.find(x=>x.enterprise_id===S.entId); S.coId=c?c.id:null; S.buId=''; persistScope(); route(); };
window.acxSetCo=function(){ S.coId=parseInt(val('acxCo'),10)||null; S.buId=''; persistScope(); route(); };
window.acxSetBu=function(){ S.buId=val('acxBu')?parseInt(val('acxBu'),10):''; persistScope(); route(); };

X.shell=async function(host,seg,tab,secs,dflt,renderers){
  css();
  const mine=++SEQ, stale=()=>mine!==SEQ||!host.isConnected;
  loader(host);
  try{ await loadBase(); if(S.coId) await loadLedgers(); else { S.groups=[]; S.ledgers=[]; } }
  catch(e){ if(!stale()) host.innerHTML=errHtml(e); return; }
  if(stale()) return;
  S.sec=secs.some(s=>s[0]===seg[0])?seg[0]:dflt;
  let locked='';
  if(!S.co.length){
    if(tab===0&&!secs.some(s=>s[0]===seg[0])) S.sec='structure';      // no section chosen yet: land where the next step is
    // Nothing can be booked or posted until a company exists. Say so on the screen that was clicked,
    // instead of quietly showing Structure (which made every pill look dead).
    const what=S.ent.length?'Add a company to '+esc(S.ent[0].name)+' first.':'Set up an enterprise and a company first.';
    const how=S.ent.length?'Open Structure and use the "+ Company" button on the enterprise.':'Open Structure, add an enterprise, then a company under it.';
    locked='<div class="empty"><i class="fa-solid fa-lock"></i><div style="font-weight:600">'+what+'</div><div class="acx-hint" style="margin-top:4px">Books are kept per company, so this section stays locked until one exists. '+how+'</div><div style="margin-top:10px"><button class="btn btn-primary" onclick="navTo(\x27accounts/0/structure\x27)">Go to Structure</button></div></div>';
    if(tab===1){ host.innerHTML=locked; return; }
    if(S.sec==='structure') locked='';      // Structure is where the company gets added - it always works
  }
  host.innerHTML=(S.co.length?scopeBar():'')+'<div class="acx-subs">'+secs.map(s=>'<span class="chip'+(s[0]===S.sec?' active':'')+'" onclick="navTo(\'accounts/'+tab+'/'+s[0]+'\')">'+esc(s[1])+'</span>').join('')+'</div><div id="acxSec"></div>';
  const sec=$('acxSec'); if(locked){ sec.innerHTML=locked; return; } loader(sec);
  try{ await renderers[S.sec](sec,mine,stale); }
  catch(e){ console.error(e); if(!stale()) sec.innerHTML=errHtml(e); }
};
window.acxRender=function(host,seg){ return X.shell(host,seg||[],0,SECS,'vouchers',{structure:renderStructure,vouchers:renderVouchers.bind(null,{types:['receipt','payment'],title:'Receipts & payments',
    hint:'Money received into, and paid out of, the bank and cash accounts. Payments to vendors against their bills are made under Bills & on-account.',news:['receipt','payment']}),
  deposits:renderVouchers.bind(null,{types:['deposit','withdrawal'],title:'Deposits & withdrawals',hint:'Cash banked, and cash drawn from the bank.',news:['deposit','withdrawal']}),
  contra:renderVouchers.bind(null,{types:['contra'],title:'Contra entries',hint:'Money moved between bank and cash accounts (bank to bank, cash to bank ...).',news:['contra']}),
  journal:renderVouchers.bind(null,{types:['journal'],title:'Journal entries',hint:'Adjusting entries between ledgers that do not touch bank or cash — provisions, reclassifications, transfers between ledgers, corrections. Every journal must balance.',news:['journal']}),
  bills:renderBills,brs:(h)=>X.renderBrs(h),cheques:(h)=>X.renderCheques(h)}); };

/* =================================================================== STRUCTURE */
function renderStructure(host){
  const adm=S.isAdmin;
  let h='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Enterprise › Company › Business unit</div>'
    +'<div class="acx-hint">Books are kept per company. A business unit is a project: bills, work-order bills and Post Sales documents reach a company through the project mapped here.</div></div>'
    +(adm?'<button class="btn btn-primary" onclick="acxEntForm()"><i class="fa-solid fa-plus"></i> Enterprise</button>':'')+'</div>';
  if(!adm) h+='<div class="acx-hint" style="margin-bottom:10px">Only an Accounts administrator can change the structure.</div>';
  if(!S.ent.length) h+='<div class="card"><div class="empty" style="padding:28px"><i class="fa-solid fa-sitemap"></i><div>No enterprise has been set up yet.</div></div></div>';
  else if(!S.co.length) h+='<div class="acx-warn"><b>Next step - add a company.</b> Use the "+ Company" button on the enterprise below. Receipts, payments, bills, journals and the Ledgers tab all stay locked until a company exists.</div>';
  S.ent.forEach(e=>{
    const cos=S.co.filter(c=>c.enterprise_id===e.id);
    h+='<div class="card acx-ent"><div class="acx-ent-h"><i class="fa-solid fa-sitemap" style="color:#0e7490"></i><b>'+esc(e.name)+'</b><span class="acx-hint">Enterprise</span><span class="grow"></span>'
      +(adm?'<button class="btn btn-sm btn-ghost" title="Edit" onclick="acxEntForm('+e.id+')"><i class="fa-solid fa-pen"></i></button><button class="btn btn-sm" onclick="acxCoForm(0,'+e.id+')"><i class="fa-solid fa-plus"></i> Company</button>':'')+'</div>';
    if(!cos.length) h+='<div class="acx-co"><div class="acx-hint" style="padding-bottom:10px">No company in this enterprise yet.</div></div>';
    cos.forEach(c=>{
      const bus=S.bu.filter(b=>b.company_id===c.id);
      h+='<div class="acx-co"><div class="acx-co-h"><i class="fa-solid fa-building" style="color:#475569"></i><b>'+esc(c.name)+'</b><span class="acx-code">'+esc(c.short_code)+'</span>'
        +(c.active?'':'<span class="tag t-gray">Inactive</span>')
        +'<span class="grow"></span>'
        +(adm?'<button class="btn btn-sm btn-ghost" title="Edit company" onclick="acxCoForm('+c.id+')"><i class="fa-solid fa-pen"></i></button><button class="btn btn-sm" onclick="acxBuForm(0,'+c.id+')"><i class="fa-solid fa-plus"></i> Business unit</button>'
          +'<button class="btn btn-sm" onclick="acxSeedChart('+c.id+')" title="Adds the standard chart of accounts and the ledgers used by automatic postings"><i class="fa-solid fa-list-check"></i> Load standard chart</button>':'')
        +'</div><div class="acx-co-meta">'+[c.gstin?'GSTIN '+esc(c.gstin):'',c.pan?'PAN '+esc(c.pan):'','Financial year from '+['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][c.fy_start_month],
          'Books start '+dmy(c.books_start),c.books_locked_till?'Locked up to '+dmy(c.books_locked_till):'Not locked'].filter(Boolean).join(' · ')+'</div>'
        +'<div class="acx-bu">'+(bus.length?bus.map(b=>'<div class="acx-bu-row"><i class="fa-solid fa-diagram-project" style="color:#0e7490"></i><span class="acx-code">'+esc(b.code)+'</span><b>'+esc(b.name)+'</b>'
          +'<span class="acx-hint">'+(b.project_id?'Project: '+esc(projName(b.project_id)):'Not a project')+'</span>'+(b.active?'':'<span class="tag t-gray">Inactive</span>')+'<span class="grow"></span>'
          +(adm?'<button class="btn btn-sm btn-ghost" title="Edit" onclick="acxBuForm('+b.id+')"><i class="fa-solid fa-pen"></i></button>':'')+'</div>').join('')
          :'<div class="acx-hint" style="padding:4px 0 10px">No business unit yet.</div>')+'</div></div>';
    });
    h+='</div>';
  });
  // who can post
  const unmapped=S.projects.filter(p=>!S.bu.some(b=>b.project_id===p.id));
  if(S.co.length&&unmapped.length) h+='<div class="acx-warn"><b>'+unmapped.length+' project'+(unmapped.length===1?'':'s')+' not mapped to a business unit:</b> '+esc(unmapped.map(p=>p.name).join(', '))+'. Bills and Post Sales documents of these projects cannot be posted to Accounts until they are mapped.</div>';
  h+='<div class="acx-sec-title">Who can use Accounts</div><div class="acx-hint" style="margin-bottom:8px">Everyone given the Accounts module in the Control Panel can <b>view</b>. Only the people below can <b>post</b> (accountant) or also change the structure and chart (administrator).</div>';
  h+='<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Person</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>'
    +S.access.map(a=>{const u=S.users.find(x=>x.email===a.email);return '<tr><td>'+esc(u?u.full_name:'—')+'</td><td>'+esc(a.email)+'</td><td><span class="tag '+(a.role==='admin'?'t-blue':'t-gray')+'">'+(a.role==='admin'?'Administrator':'Accountant')+'</span></td>'
      +'<td class="acx-act">'+(adm?'<button class="btn btn-sm btn-ghost" title="Remove" onclick="acxAccessDel(\''+escJs(a.email)+'\')"><i class="fa-solid fa-trash"></i></button>':'')+'</td></tr>';}).join('')
    +'</tbody></table></div></div>';
  if(adm) h+='<div class="acx-top" style="margin-top:12px"><select id="acxAcUser" class="grow"><option value="">Choose a person…</option>'+S.users.filter(u=>!S.access.some(a=>a.email===String(u.email).toLowerCase())).map(u=>opt(u.email,(u.full_name||u.email)+' — '+u.email)).join('')+'</select>'
    +'<select id="acxAcRole"><option value="accountant">Accountant</option><option value="admin">Administrator</option></select><button class="btn btn-primary" onclick="acxAccessAdd()"><i class="fa-solid fa-user-plus"></i> Add</button></div>';
  host.innerHTML=h;
}
window.acxAccessAdd=async function(){
  const email=val('acxAcUser').toLowerCase(), role=val('acxAcRole'); if(!email){ toast('Choose a person','err'); return; }
  const {error}=await AC().from('access').insert({email,role}); if(fail(error)) return; toast('Added','ok'); route();
};
window.acxAccessDel=async function(email){
  if(!await confirmDialog('Remove '+email+' from Accounts?',{okLabel:'Remove'})) return;
  const {error}=await AC().from('access').delete().eq('email',email); if(fail(error,'Could not remove')) return; toast('Removed','ok'); route();
};
function formModal(title,body,saveFn,size,saveLabel){
  openModal('<div class="modal-head"><h3>'+esc(title)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body">'+body+'</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="'+saveFn+'">'+esc(saveLabel||'Save')+'</button></div>',size||'');
}
X.formModal=formModal;
window.acxEntForm=function(id){
  const e=id?S.ent.find(x=>x.id===id):{name:''};
  formModal(id?'Edit enterprise':'New enterprise',field('Enterprise name','<input id="enName" value="'+esc(e.name)+'" placeholder="e.g. Jain Group">'),'acxEntSave('+(id||0)+')');
};
window.acxEntSave=async function(id){
  const name=val('enName'); if(!name){ toast('Enter the enterprise name','err'); return; }
  const {error}=id?await AC().from('enterprises').update({name}).eq('id',id):await AC().from('enterprises').insert({name});
  if(fail(error)) return; closeModal(); toast('Saved','ok'); route();
};
window.acxCoForm=function(id,entId){
  const c=id?S.co.find(x=>x.id===id):{enterprise_id:entId,name:'',short_code:'',gstin:'',pan:'',state_code:'',fy_start_month:4,books_start:fyStart(today()),books_locked_till:'',active:true};
  const mnames=['January','February','March','April','May','June','July','August','September','October','November','December'];
  formModal(id?'Edit company':'New company',
    '<div class="acx-grid2">'+field('Company name','<input id="coName" value="'+esc(c.name)+'">')+field('Short code (used in voucher numbers)','<input id="coCode" maxlength="6" value="'+esc(c.short_code)+'" style="text-transform:uppercase" '+(id?'':'')+'><div class="h">2–6 letters or digits, e.g. JGV → JGV/RV/26-27/0001</div>')+'</div>'
    +'<div class="acx-grid3">'+field('GSTIN','<input id="coGstin" value="'+esc(c.gstin||'')+'" maxlength="15" oninput="acxGstState()" style="text-transform:uppercase">')+field('PAN','<input id="coPan" value="'+esc(c.pan||'')+'" maxlength="10" style="text-transform:uppercase">')
      +field('GST state code','<input id="coState" value="'+esc(c.state_code||'')+'" maxlength="2" placeholder="19"><div class="h">Decides CGST + SGST or IGST on contractor bills</div>')+'</div>'
    +'<div class="acx-grid3">'+field('Financial year starts in','<select id="coFy">'+mnames.map((m,i)=>opt(i+1,m,c.fy_start_month)).join('')+'</select>')
      +field('Books start on','<input type="date" id="coStart" value="'+esc(c.books_start||'')+'"><div class="h">Opening balances are as at this date</div>')
      +field('Books locked up to','<input type="date" id="coLock" value="'+esc(c.books_locked_till||'')+'"><div class="h">Nothing can be posted or cancelled on or before this date</div>')+'</div>'
    +(id?'<div class="acx-field"><label><input type="checkbox" id="coActive" '+(c.active?'checked':'')+'> Active</label></div>':'')
    +'<input type="hidden" id="coEnt" value="'+(c.enterprise_id||'')+'">','acxCoSave('+(id||0)+')','lg');
  if(!id) setTimeout(()=>{ const n=$('coName'); if(n) n.addEventListener('input',()=>{ const cd=$('coCode'); if(cd&&!cd.dataset.touched){ cd.value=n.value.split(/\s+/).filter(Boolean).map(w=>w[0]).join('').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6); } }); const cd=$('coCode'); if(cd) cd.addEventListener('input',()=>{cd.dataset.touched='1';}); },30);
};
window.acxGstState=function(){ const g=val('coGstin'); if(/^[0-9]{2}/.test(g)&&$('coState')&&!val('coState')) $('coState').value=g.slice(0,2); };
window.acxCoSave=async function(id){
  const row={enterprise_id:parseInt(val('coEnt'),10),name:val('coName'),short_code:val('coCode').toUpperCase(),gstin:val('coGstin').toUpperCase()||null,pan:val('coPan').toUpperCase()||null,
    state_code:val('coState')||null,fy_start_month:parseInt(val('coFy'),10),books_start:val('coStart')||null,books_locked_till:val('coLock')||null};
  if(!row.name){ toast('Enter the company name','err'); return; }
  if(!/^[A-Z0-9]{2,6}$/.test(row.short_code)){ toast('The short code must be 2–6 letters or digits','err'); return; }
  if(!row.books_start){ toast('Enter the date the books start','err'); return; }
  if(row.state_code&&!/^[0-9]{2}$/.test(row.state_code)){ toast('The GST state code is two digits','err'); return; }
  if(id) row.active=chk('coActive');
  const {data,error}=id?await AC().from('companies').update(row).eq('id',id).select('id'):await AC().from('companies').insert(row).select('id');
  if(fail(error)) return; if(!id&&data&&data[0]){ S.coId=data[0].id; persistScope(); }
  closeModal(); toast('Saved','ok'); route();
};
window.acxBuForm=function(id,coId){
  const b=id?S.bu.find(x=>x.id===id):{company_id:coId,code:'',name:'',project_id:'',active:true};
  const used=new Set(S.bu.filter(x=>x.project_id&&x.id!==id).map(x=>x.project_id));
  formModal(id?'Edit business unit':'New business unit',
    field('Project','<select id="buProj" onchange="acxBuFromProject()">'+opt('','Not a project (e.g. head office)',b.project_id||'')+S.projects.filter(p=>!used.has(p.id)).map(p=>opt(p.id,p.name,b.project_id)).join('')+'</select><div class="h">A business unit is normally a project</div>')
    +'<div class="acx-grid2">'+field('Business unit name','<input id="buName" value="'+esc(b.name)+'">')+field('Code','<input id="buCode" maxlength="8" value="'+esc(b.code)+'" style="text-transform:uppercase">')+'</div>'
    +(id?'<div class="acx-field"><label><input type="checkbox" id="buActive" '+(b.active?'checked':'')+'> Active</label></div>':'')
    +'<input type="hidden" id="buCo" value="'+(b.company_id||'')+'">','acxBuSave('+(id||0)+')');
};
window.acxBuFromProject=function(){
  const pid=parseInt(val('buProj'),10); if(!pid) return; const p=S.projects.find(x=>x.id===pid);
  if(p&&!val('buName')) $('buName').value=p.name;
  if(!val('buCode')) $('buCode').value=(S.psCodes[pid]||(p?p.name.split(/\s+/).map(w=>w[0]).join(''):'')).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
};
window.acxBuSave=async function(id){
  const row={company_id:parseInt(val('buCo'),10),name:val('buName'),code:val('buCode').toUpperCase(),project_id:val('buProj')?parseInt(val('buProj'),10):null};
  if(!row.name){ toast('Enter the business unit name','err'); return; }
  if(!/^[A-Z0-9]{1,8}$/.test(row.code)){ toast('The code is 1–8 letters or digits','err'); return; }
  if(id) row.active=chk('buActive');
  const {error}=id?await AC().from('business_units').update(row).eq('id',id):await AC().from('business_units').insert(row);
  if(fail(error)) return; closeModal(); toast('Saved','ok'); route();
};
window.acxSeedChart=async function(coId){
  if(!await confirmDialog('Add the standard chart of accounts (groups and the ledgers used by automatic postings) to this company? Anything already there is kept.',{danger:false,okLabel:'Add'})) return;
  const {data,error}=await rpc('seed_chart',{p_company:coId}); if(fail(error,'Could not load the chart')) return;
  toast(data>0?'Added '+data+' groups and ledgers':'The standard chart was already there','ok'); route();
};

/* =================================================================== VOUCHER REGISTER */
const VR={status:'posted',from:'',to:'',q:'',rows:[],cfg:null};
async function renderVouchers(cfg,host,mine,stale){
  VR.cfg=cfg; if(!VR.from) VR.from=fyStart(today()); if(!VR.to) VR.to=today();
  const co=curCo();
  const cb=cashBank();
  let top='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">'+esc(cfg.title)+'</div><div class="acx-hint" style="margin:0">'+esc(cfg.hint)+'</div></div>';
  if(S.canPost){
    top+=cfg.news.map(n=>{const L={receipt:['fa-arrow-down','New receipt'],payment:['fa-arrow-up','New payment'],vendor:['fa-truck','Pay a vendor'],deposit:['fa-piggy-bank','New deposit'],withdrawal:['fa-money-bill-transfer','New withdrawal'],contra:['fa-right-left','New contra'],journal:['fa-pen-to-square','New journal']}[n];
      return '<button class="btn '+(n==='vendor'||n==='receipt'&&cfg.news.length===1?'btn-primary':'')+'" onclick="'+(n==='vendor'?'acxPayOpen()':'acxVoucherNew(\''+n+'\')')+'"><i class="fa-solid '+L[0]+'"></i> '+L[1]+'</button>';}).join(' ');
  }
  top+='</div>';
  if(S.canPost&&!cb.length&&cfg.types[0]!=='journal') top+='<div class="acx-warn">This company has no bank or cash ledger yet. Add one under <b>Ledgers & postings › Chart of accounts</b> (mark it as a bank account or cash) before entering vouchers.</div>';
  host.innerHTML=top+'<div id="acxVrBody"></div>';
  await vrLoad(host);
}
async function vrLoad(host){
  const cfg=VR.cfg;
  let q=AC().from('vouchers').select('*').eq('company_id',S.coId).in('voucher_type',cfg.types).gte('voucher_date',VR.from).lte('voucher_date',VR.to).order('voucher_date',{ascending:false}).order('id',{ascending:false}).limit(1000);
  if(S.buId) q=q.eq('business_unit_id',S.buId);
  if(VR.status!=='all') q=q.eq('status',VR.status);
  const {data,error}=await q; if(error) throw error;
  VR.rows=data||[]; vrDraw();
}
function vrList(){ const q=VR.q.toLowerCase(); return VR.rows.filter(v=>!q||((v.doc_no||'')+' '+(v.payee||'')+' '+(v.narration||'')+' '+(v.instrument_no||'')).toLowerCase().includes(q)); }
function vrDraw(){
  const body=$('acxVrBody'); if(!body) return;
  const q=VR.q.toLowerCase();
  const list=vrList();
  const total=list.filter(v=>v.status==='posted').reduce((s,v)=>s+Number(v.amount||0),0);
  const rows=list.map(v=>'<tr style="cursor:pointer" onclick="acxVoucherOpen('+v.id+')"><td><span class="acx-code">'+esc(v.doc_no)+'</span></td><td style="white-space:nowrap">'+dmy(v.voucher_date)+'</td><td>'+vtag(v.voucher_type)+'</td>'
    +'<td>'+esc(v.payee||v.narration||'—')+(v.payee&&v.narration?'<div class="acx-hint">'+esc(v.narration)+'</div>':'')+'</td>'
    +'<td>'+esc(MODE_LABEL[v.mode]||'—')+(v.instrument_no?'<div class="acx-hint">'+esc(v.instrument_no)+(v.instrument_date?' · '+dmy(v.instrument_date):'')+'</div>':'')+'</td>'
    +'<td>'+esc(v.business_unit_id?buName(v.business_unit_id):'Company level')+'</td><td class="acx-num"><b>'+money(v.amount)+'</b></td>'
    +'<td>'+(v.status==='posted'?'<span class="tag t-green">Posted</span>':'<span class="tag t-red">Cancelled</span>')+'</td></tr>').join('');
  body.innerHTML='<div class="acx-top"><div class="acx-subs" style="margin:0">'+[['posted','Posted'],['cancelled','Cancelled'],['all','All']].map(s=>'<span class="chip'+(VR.status===s[0]?' active':'')+'" onclick="acxVrStatus(\''+s[0]+'\')">'+s[1]+'</span>').join('')+'</div>'
    +'<input type="date" id="vrFrom" value="'+VR.from+'" onchange="acxVrDates()"><span class="acx-hint">to</span><input type="date" id="vrTo" value="'+VR.to+'" onchange="acxVrDates()">'
    +'<input class="grow" id="vrQ" placeholder="Search by number, party, narration or cheque no." value="'+esc(VR.q)+'" oninput="acxVrSearch()">'
    +dlBtns('acxVrDownload')+'</div>'
    +'<div class="acx-hint" style="margin-bottom:8px">'+list.length+' voucher'+(list.length===1?'':'s')+' · total '+money(total)+(VR.rows.length>=1000?' · showing the latest 1,000 — narrow the dates':'')+'</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Voucher no</th><th>Date</th><th>Type</th><th>Particulars</th><th>Mode</th><th>Business unit</th><th class="acx-num">Amount</th><th>Status</th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="8"><div class="empty" style="padding:24px"><div>No vouchers in this period</div></div></td></tr>')+'</tbody></table></div></div>';
}
window.acxVrStatus=function(s){ VR.status=s; vrLoad(); };
window.acxVrDates=function(){ VR.from=val('vrFrom')||VR.from; VR.to=val('vrTo')||VR.to; vrLoad(); };
window.acxVrSearch=function(){ VR.q=val('vrQ'); vrDraw(); const e=$('vrQ'); if(e){ e.focus(); e.setSelectionRange(e.value.length,e.value.length); } };
window.acxVrDownload=function(fmt,btn){
  const list=vrList(), st={posted:'Posted',cancelled:'Cancelled',all:'Posted and cancelled'}[VR.status]||'';
  const posted=list.filter(v=>v.status==='posted'), total=posted.reduce((s,v)=>s+Number(v.amount||0),0);
  X.download(fmt,{title:VR.cfg.title,file:'Register_'+VR.cfg.title,
    sub:dmy(VR.from)+' to '+dmy(VR.to)+' · '+st+(S.buId?' · Business unit: '+buName(S.buId):' · All business units')+(VR.q?' · Search: "'+VR.q+'"':''),
    cols:[{h:'Voucher no'},{h:'Date',t:'d'},{h:'Type'},{h:'Payee'},{h:'Narration'},{h:'Mode'},{h:'Instrument no'},{h:'Business unit'},{h:'Amount',t:'n'},{h:'Status'}],
    rows:list.map(v=>[v.doc_no,v.voucher_date,(VTYPE[v.voucher_type]||[v.voucher_type])[0],v.payee||'',v.narration||'',MODE_LABEL[v.mode]||'',v.instrument_no||'',v.business_unit_id?buName(v.business_unit_id):'Company level',v.amount,v.status==='posted'?'Posted':'Cancelled']),
    foot:['Total ('+posted.length+' posted)','','','','','','','',total,'']},btn);
};

/* ---------------- one voucher ---------------- */
async function voucherOpen(id){
  openModal('<div class="modal-body"><div class="loader"><div class="spin"></div></div></div>','lg');
  const [v,l,lg,al,ch]=await Promise.all([
    AC().from('vouchers').select('*').eq('id',id).single(),
    AC().from('voucher_lines').select('*').eq('voucher_id',id).order('line_no'),
    AC().from('doc_log').select('*').eq('doc_type','voucher').eq('doc_id',id).order('at'),
    AC().from('payable_allocations').select('*').eq('from_voucher_id',id).order('id'),
    AC().from('cheques').select('*').eq('voucher_id',id).order('id')]);
  const bad=[v,l,lg,al,ch].find(r=>r.error); if(bad){ closeModal(); fail(bad.error,'Could not open the voucher'); return; }
  const vo=v.data, lines=l.data||[];
  const subIds=[...new Set(lines.flatMap(x=>[x.sub_ledger_id,x.cost_sub_ledger_id]).filter(Boolean))];
  const subs={}; if(subIds.length){ const {data}=await AC().from('sub_ledgers').select('id,name').in('id',subIds); (data||[]).forEach(s=>subs[s.id]=s.name); }
  const payIds=[...new Set((al.data||[]).map(a=>a.payable_id))]; const pays={};
  if(payIds.length){ const {data}=await AC().from('v_payables').select('id,ref_no,kind,vendor_id').in('id',payIds); (data||[]).forEach(p=>pays[p.id]=p); }
  const dr=lines.reduce((s,x)=>s+Number(x.dr),0), cr=lines.reduce((s,x)=>s+Number(x.cr),0);
  const kv=(k,vv)=>vv==null||vv===''?'':'<div class="acx-field"><label>'+k+'</label><div>'+vv+'</div></div>';
  const allocs=(al.data||[]).filter(a=>a.status==='active');
  const canCancel=S.canPost&&vo.status==='posted'&&!vo.source_type;
  const activeCheque=(ch.data||[]).find(c=>c.status!=='cancelled');
  openModal('<div class="modal-head"><h3>'+esc(vo.doc_no)+' '+vtag(vo.voucher_type)+(vo.status==='cancelled'?' <span class="tag t-red">Cancelled</span>':'')+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body">'
    +'<div class="acx-grid4">'+kv('Date',dmy(vo.voucher_date))+kv('Business unit',esc(vo.business_unit_id?buName(vo.business_unit_id):'Company level'))+kv('Mode',esc(MODE_LABEL[vo.mode]||''))
      +kv('Instrument',vo.instrument_no?esc(vo.instrument_no)+(vo.instrument_date?' · '+dmy(vo.instrument_date):''):'')+kv('Party',esc(vo.payee||''))+kv('Amount','<b>'+money(vo.amount)+'</b>')
      +kv('Entered by',esc(vo.created_by||'')+' · '+dmyTime(vo.created_at))+kv('Came from',vo.source_type?esc(SRC_LABEL[vo.source_type]||vo.source_type):'Entered here')+'</div>'
    +(vo.narration?'<div class="acx-hint" style="margin:-4px 0 12px">'+esc(vo.narration)+'</div>':'')
    +(vo.status==='cancelled'?'<div class="acx-warn">Cancelled '+dmyTime(vo.cancelled_at)+' by '+esc(vo.cancelled_by||'')+': '+esc(vo.cancel_reason||'')+'</div>':'')
    +'<div class="card" style="padding:0;margin-bottom:12px"><div style="overflow-x:auto"><table class="tbl acx-mini"><thead><tr><th>#</th><th>Ledger</th><th>Sub-ledger</th><th>Cost / custom ledger</th><th class="acx-num">Debit</th><th class="acx-num">Credit</th><th>Cleared</th></tr></thead><tbody>'
    +lines.map(x=>'<tr><td>'+x.line_no+'</td><td>'+esc(ledName(x.ledger_id))+(x.narration?'<div class="acx-hint">'+esc(x.narration)+'</div>':'')+'</td><td>'+esc(subs[x.sub_ledger_id]||'')+'</td>'
      +'<td>'+(x.cost_ledger_id?esc(ledName(x.cost_ledger_id))+(x.cost_sub_ledger_id?' › '+esc(subs[x.cost_sub_ledger_id]||''):''):'')+'</td><td class="acx-num">'+(x.dr>0?money(x.dr):'')+'</td><td class="acx-num">'+(x.cr>0?money(x.cr):'')+'</td><td>'+(x.cleared_on?dmy(x.cleared_on):'')+'</td></tr>').join('')
    +'<tr><td colspan="4" class="acx-num"><b>Total</b></td><td class="acx-num"><b>'+money(dr)+'</b></td><td class="acx-num"><b>'+money(cr)+'</b></td><td></td></tr></tbody></table></div></div>'
    +(allocs.length?'<div class="acx-sec-title" style="margin-top:4px">Bills this entry is set against</div><div class="card" style="padding:0;margin-bottom:12px"><table class="tbl acx-mini"><thead><tr><th>Bill</th><th>Vendor</th><th>How</th><th class="acx-num">Amount</th><th>Date</th></tr></thead><tbody>'
      +allocs.map(a=>{const p=pays[a.payable_id]||{};return '<tr><td>'+esc(p.ref_no||'#'+a.payable_id)+(p.kind==='retention'?' <span class="acx-pill">retention</span>':'')+'</td><td>'+esc(p.vendor_id?vendorName(p.vendor_id):'')+'</td><td>'+({payment:'Payment',adjustment:'On-account adjustment',debit_note:'Debit note'}[a.kind]||a.kind)+'</td><td class="acx-num">'+money(a.amount)+'</td><td>'+dmy(a.alloc_date)+'</td></tr>';}).join('')+'</tbody></table></div>':'')
    +(activeCheque?'<div class="acx-hint" style="margin-bottom:10px"><i class="fa-solid fa-money-check"></i> Cheque <b>'+esc(activeCheque.cheque_no)+'</b> · '+esc(activeCheque.status)+(activeCheque.print_count?' · printed '+activeCheque.print_count+'×':'')+'</div>':'')
    +'<div class="acx-sec-title" style="margin-top:4px">History</div><div class="acx-hint">'+((lg.data||[]).map(x=>esc(x.action)+(x.remark&&x.remark!=='manual'?' ('+esc(x.remark)+')':'')+' — '+esc(x.by||'')+', '+dmyTime(x.at)).join('<br>')||'—')+'</div>'
    +'</div><div class="modal-foot">'
    +(canCancel?'<button class="btn btn-danger" style="margin-right:auto" onclick="acxVoucherCancel('+id+')"><i class="fa-solid fa-ban"></i> Cancel voucher</button>':'')
    +(S.canPost&&vo.status==='posted'&&vo.voucher_type==='payment'&&vo.mode==='cheque'?'<button class="btn" onclick="acxChequeFor('+id+')"><i class="fa-solid fa-money-check"></i> '+(activeCheque?'Print cheque':'Issue &amp; print cheque')+'</button>':'')
    +'<button class="btn" onclick="closeModal()">Close</button></div>','lg');
}
window.acxVoucherOpen=voucherOpen; X.voucherOpen=voucherOpen;
window.acxVoucherCancel=async function(id){
  const reason=await askReason('Cancel this voucher','Why is it being cancelled?','Cancel voucher'); if(!reason) return;
  const {error}=await rpc('voucher_cancel',{p_id:id,p_reason:reason}); if(fail(error,'Could not cancel')) return;
  toast('Voucher cancelled','ok'); route();
};

/* ---------------- voucher entry ---------------- */
let VF=null;
const VT={
  receipt:{label:'Receipt',acct:'Received in',party:'Received from',lines:'Credited to',kind:'lines',mode:'transfer'},
  payment:{label:'Payment',acct:'Paid from',party:'Paid to',lines:'Debited to',kind:'lines',mode:'cheque'},
  deposit:{label:'Deposit',kind:'pair',from:'Cash / cheques in hand (credit)',to:'Deposited in bank (debit)',mode:'cash',fromF:l=>l.is_cash,toF:l=>l.is_bank},
  withdrawal:{label:'Withdrawal',kind:'pair',from:'Drawn from bank (credit)',to:'Cash in hand (debit)',mode:'cheque',fromF:l=>l.is_bank,toF:l=>l.is_cash},
  contra:{label:'Contra',kind:'pair',from:'From (credit)',to:'To (debit)',mode:'transfer',fromF:l=>true,toF:l=>true},
  journal:{label:'Journal',kind:'journal',mode:null}
};
const blankLine=()=>({ledger:'',sub:'',subNew:'',cost:'',csub:'',amt:'',dr:'',cr:'',nar:''});
window.acxVoucherNew=function(type){
  const cb=cashBank();
  if(type!=='journal'&&!cb.length){ toast('Add a bank or cash ledger first (Ledgers & postings › Chart of accounts)','err'); return; }
  const T=VT[type];
  const pick=f=>(cb.filter(f)[0]||{}).id||'';
  VF={type,tab:'main',bal:{},date:today(),bu:S.buId||'',mode:T.mode,inst:'',instDate:'',party:'',narr:'',amount:'',
      bank:T.kind==='lines'?((cb.find(l=>l.is_bank)||cb[0]).id):'',from:T.kind==='pair'?pick(T.fromF):'',to:T.kind==='pair'?pick(T.toF):'',
      lines:type==='journal'?[blankLine(),blankLine()]:[blankLine()]};
  if(type==='contra'&&VF.from===VF.to){ const other=cb.find(l=>l.id!==VF.from); if(other) VF.to=other.id; }
  vfDraw();
};
function vfHead(){
  const T=VT[VF.type];
  if(T.kind==='journal') return '<div class="acx-grid2">'+field('Date','<input type="date" id="vfDate" value="'+esc(VF.date)+'" max="'+today()+'">')
    +field('Business unit','<select id="vfBu">'+opt('','Company level (no business unit)',VF.bu)+coBus().filter(b=>b.active).map(b=>opt(b.id,b.name,VF.bu)).join('')+'</select>')+'</div>';
  let h='<div class="acx-grid4">'+field('Date','<input type="date" id="vfDate" value="'+esc(VF.date)+'" max="'+today()+'">')
    +field('Business unit','<select id="vfBu">'+opt('','Company level (no business unit)',VF.bu)+coBus().filter(b=>b.active).map(b=>opt(b.id,b.name,VF.bu)).join('')+'</select>')
    +field('Mode','<select id="vfMode" onchange="acxVfMode()">'+opts(MODES.filter(m=>VF.type==='deposit'||VF.type==='withdrawal'?['cash','cheque','dd'].includes(m[0]):true),VF.mode)+'</select>');
  if(T.kind==='lines') h+=field(T.acct,'<select id="vfBank">'+cashBank().map(l=>opt(l.id,l.name+(l.is_cash?' (cash)':''),VF.bank)).join('')+'</select>');
  else h+=field('Amount','<input id="vfAmount" class="n" inputmode="decimal" value="'+esc(VF.amount)+'" style="text-align:right">');
  h+='</div>';
  if(T.kind==='pair'){
    h+='<div class="acx-grid2">'+field(T.from,'<select id="vfFrom">'+cashBank().filter(T.fromF).map(l=>opt(l.id,l.name,VF.from)).join('')+'</select>')
      +field(T.to,'<select id="vfTo">'+cashBank().filter(T.toF).map(l=>opt(l.id,l.name,VF.to)).join('')+'</select>')+'</div>';
  }
  h+='<div class="acx-grid3" id="vfInstRow">'+field((VF.type==='payment'?'Cheque no':'Cheque / DD / reference no')+(VF.type==='payment'?' (leave blank to take the next from the cheque book)':''),'<input id="vfInst" value="'+esc(VF.inst)+'">')
    +field('Instrument date','<input type="date" id="vfInstDate" value="'+esc(VF.instDate)+'">')
    +(T.kind==='lines'?field(T.party,'<input id="vfParty" value="'+esc(VF.party)+'">'):field('Reference / narration','<input id="vfNarr2" value="'+esc(VF.narr)+'">'))+'</div>';
  return h;
}
/* ---- journal: free debit / credit lines that must balance ---- */
function jnTotals(){ const dr=r2(VF.lines.reduce((s,l)=>s+num(l.dr),0)), cr=r2(VF.lines.reduce((s,l)=>s+num(l.cr),0)); return {dr,cr,diff:r2(dr-cr)}; }
function jnTotalsHtml(){
  const t=jnTotals(), ok=Math.abs(t.diff)<0.005&&t.dr>0;
  return '<span>Debit <b>'+money(t.dr)+'</b></span><span>Credit <b>'+money(t.cr)+'</b></span><span style="color:'+(ok?'#15803d':'#b91c1c')+'">'+(ok?'Balanced ✔':(Math.abs(t.diff)<0.005?'Enter the amounts':'Difference <b>'+money(Math.abs(t.diff))+(t.diff>0?' more debit':' more credit')+'</b>'))+'</span>';
}
function vfJournalHtml(){
  const rows=VF.lines.map((l,i)=>{
    const led=l.ledger?ledgerById(parseInt(l.ledger,10)):null;
    const subs=led&&led.sub_ledger_type?(S.subCache[led.id]||[]):[];
    const cled=l.cost?ledgerById(parseInt(l.cost,10)):null;
    const csubs=cled&&cled.sub_ledger_type?(S.subCache[cled.id]||[]):[];
    return '<tr><td style="min-width:200px"><select onchange="acxVfLed('+i+',this.value)">'+ledgerOpts(x=>!x.is_bank&&!x.is_cash,l.ledger,'Choose ledger…')+'</select></td>'
      +'<td style="min-width:170px">'+(led&&led.sub_ledger_type?'<select onchange="acxVfSub('+i+',this.value)">'+opt('','Choose '+led.sub_ledger_type+'…',l.sub)+subs.map(s=>opt(s.id,s.name,l.sub)).join('')+opt('__new','＋ New sub-ledger…',l.sub)+'</select>'
         +(l.sub==='__new'?'<input style="margin-top:4px" placeholder="New sub-ledger name" value="'+esc(l.subNew)+'" oninput="acxVfF('+i+',\'subNew\',this.value)">':''):'<span class="acx-dim">—</span>')+'</td>'
      +'<td style="min-width:170px"><select onchange="acxVfCost('+i+',this.value)">'+costOpts(l.cost,'—')+'</select>'
         +(cled&&cled.sub_ledger_type?'<select style="margin-top:4px" onchange="acxVfF('+i+',\'csub\',this.value)">'+opt('','Choose sub-ledger…',l.csub)+csubs.map(s=>opt(s.id,s.name,l.csub)).join('')+'</select>':'')+'</td>'
      +'<td style="min-width:120px"><input class="n" id="vfdr_'+i+'" inputmode="decimal" value="'+esc(l.dr)+'" oninput="acxJnDc('+i+',\'dr\',this.value)"></td>'
      +'<td style="min-width:120px"><input class="n" id="vfcr_'+i+'" inputmode="decimal" value="'+esc(l.cr)+'" oninput="acxJnDc('+i+',\'cr\',this.value)"></td>'
      +'<td style="min-width:130px"><input value="'+esc(l.nar)+'" oninput="acxVfF('+i+',\'nar\',this.value)" placeholder="Narration"></td>'
      +'<td style="width:64px;white-space:nowrap"><button class="btn btn-sm btn-ghost" title="Put the balancing amount on this line" onclick="acxJnFill('+i+')"><i class="fa-solid fa-scale-balanced"></i></button><button class="btn btn-sm btn-ghost" title="Remove line" onclick="acxVfDel('+i+')"><i class="fa-solid fa-xmark"></i></button></td></tr>';}).join('');
  return '<div class="acx-sec-title" style="margin-top:0">Lines</div><div class="acx-lines-wrap"><table class="acx-lines"><thead><tr><th>Ledger</th><th>Sub-ledger</th><th>Cost / custom ledger <span class="acx-dim" style="text-transform:none;letter-spacing:0">(optional)</span></th><th>Debit</th><th>Credit</th><th>Narration</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'
    +'<div class="acx-sticky-foot"><button class="btn btn-sm" onclick="acxVfAdd()"><i class="fa-solid fa-plus"></i> Add line</button><span class="acx-right"></span><div class="acx-tot" id="jnTot">'+jnTotalsHtml()+'</div></div>'
    +'<div class="acx-field"><label>Narration — why is this entry being made?</label><textarea id="vfNarr" rows="2">'+esc(VF.narr)+'</textarea></div>';
}
window.acxJnDc=function(i,k,v){
  const l=VF.lines[i]; l[k]=v;
  if(num(v)>0){ const o=k==='dr'?'cr':'dr'; if(l[o]!==''){ l[o]=''; const e=$('vf'+o+'_'+i); if(e) e.value=''; } }
  const t=$('jnTot'); if(t) t.innerHTML=jnTotalsHtml();
};
window.acxJnFill=function(i){
  vfSyncHead(); const l=VF.lines[i]; const others=VF.lines.filter((x,j)=>j!==i);
  const diff=r2(others.reduce((s,x)=>s+num(x.dr),0)-others.reduce((s,x)=>s+num(x.cr),0));
  if(Math.abs(diff)<0.005){ toast('Nothing to balance yet — enter the other lines first','warn'); return; }
  if(diff>0){ l.cr=String(diff); l.dr=''; } else { l.dr=String(-diff); l.cr=''; }
  vfRedrawLines();
};
function vfLinesHtml(){
  const T=VT[VF.type]; if(T.kind==='journal') return vfJournalHtml(); if(T.kind==='lines') return vfRpLower(); return '';
}

/* ---- receipt / payment: laid out like the Farvision Receipt/Payment screen ----
   Header: Business unit, Financial year, Document no (the next number, filled in for you), Document date,
   Cash / Bank with its current balance, Narration. Below: Main Info (Dr / Cr, account head, amount with the
   balance before and after), Other Info (mode, cheque / reference no, payee) and Dimension (cost / custom ledger).
   Not carried over: Document type (the voucher type follows Dr / Cr), Copy template, the two empty search boxes. */
const fmtDmy=d=>String(d.getDate()).padStart(2,'0')+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+d.getFullYear();
function fyLabel(date){
  const co=curCo(); const m=co?co.fy_start_month:4; const d=date?new Date(date+'T00:00:00'):new Date();
  const y=(d.getMonth()+1)<m?d.getFullYear()-1:d.getFullYear();
  return fmtDmy(new Date(y,m-1,1))+' to '+fmtDmy(new Date(y+1,m-1,0));
}
const balTxt=b=>money(Math.abs(b))+(b>=0.005?' Dr':b<=-0.005?' Cr':'');
async function vfBal(ledger,sub){
  const key=ledger+'|'+(sub||'')+'|'+VF.date; VF.bal=VF.bal||{};
  if(VF.bal[key]!==undefined) return VF.bal[key];
  const {data,error}=await rpc('ledger_balance',{p_company:S.coId,p_ledger:parseInt(ledger,10),p_sub:sub&&sub!=='__new'?parseInt(sub,10):null,p_as_on:VF.date});
  VF.bal[key]=error?null:Number(data||0); return VF.bal[key];
}
function vfPaintAfter(i,b){
  const a=$('vfLA_'+i); if(!a||!VF) return; const amt=r2(num(VF.lines[i].amt));
  if(b==null||!amt){ a.textContent=''; return; }
  a.innerHTML='Balance: <b>'+balTxt(b+(VF.type==='payment'?amt:-amt))+'</b>';   // a payment debits the account head, a receipt credits it
}
async function vfPaintBal(){
  if(!VF||VT[VF.type].kind!=='lines') return;
  const my=VF.bseq=(VF.bseq||0)+1, still=()=>VF&&VF.bseq===my;
  if(VF.bank&&$('vfBankBal')){ const b=await vfBal(VF.bank,''); if(!still()) return; const e=$('vfBankBal'); if(e) e.innerHTML='Current balance: <b>'+(b==null?'—':balTxt(b))+'</b>'; }
  for(let i=0;i<VF.lines.length;i++){
    const l=VF.lines[i], c=$('vfLB_'+i); if(!c) continue;
    if(!l.ledger){ c.textContent=''; l.cur=null; vfPaintAfter(i,null); continue; }
    const b=l.sub==='__new'?0:await vfBal(l.ledger,l.sub||''); if(!still()) return;
    l.cur=b; const c2=$('vfLB_'+i); if(c2) c2.innerHTML='Current balance: <b>'+(b==null?'—':balTxt(b))+'</b>'; vfPaintAfter(i,b);
  }
}
async function vfLoadDocNo(){
  const my=VF.dseq=(VF.dseq||0)+1; if(!$('vfDocNo')) return;
  const {data,error}=await rpc('peek_doc_no',{p_company:S.coId,p_type:VF.type,p_date:VF.date});
  if(!VF||VF.dseq!==my) return; const e=$('vfDocNo'); if(e) e.value=(error||!data)?'Assigned when posted':data;
}
function vfRedrawLines(){ const e=$('vfLines'); if(e) e.innerHTML=vfLinesHtml(); vfPaintBal(); }
const vfRpHint=()=>VF.type==='payment'?'Credit goes to the Cash / Bank account; the account heads are debited. To pay a vendor against its bills use Bills & on-account.':'Debit goes to the Cash / Bank account; the account heads are credited.';
function vfHeadRP(){
  const bus='<select id="vfBu">'+opt('','Company level (no business unit)',VF.bu)+coBus().filter(b=>b.active).map(b=>opt(b.id,b.name,VF.bu)).join('')+'</select>';
  const left=field('Business unit',bus)
    +field('Document no','<input id="vfDocNo" class="acx-ro" readonly value="…"><div class="h">The next number; it is final when you post</div>')
    +field('Cash / Bank','<select id="vfBank" onchange="acxVfBank()">'+cashBank().map(l=>opt(l.id,l.name+(l.is_cash?' (cash)':''),VF.bank)).join('')+'</select><div class="acx-bal" id="vfBankBal"></div>')
    +field('Narration','<textarea id="vfNarr" rows="3">'+esc(VF.narr)+'</textarea>');
  const right=field('Financial year','<input id="vfFy" class="acx-ro" readonly value="'+esc(fyLabel(VF.date))+'">')
    +field('Document date','<input type="date" id="vfDate" value="'+esc(VF.date)+'" max="'+today()+'" onchange="acxVfDate()">');
  return '<div class="acx-grid2"><div>'+left+'</div><div>'+right+'</div></div>';
}
function vfRpLower(){
  const tabs=[['main','Main Info'],['other','Other Info'],['dim','Dimension']];
  const strip='<div class="acx-subs" style="margin-bottom:12px">'+tabs.map(t=>'<span class="chip'+(VF.tab===t[0]?' active':'')+'" onclick="acxVfTab(\''+t[0]+'\')">'+t[1]+'</span>').join('')+'</div>';
  return '<div class="card" style="padding:14px 16px;margin-bottom:12px">'+strip+(VF.tab==='other'?vfRpOther():VF.tab==='dim'?vfRpDim():vfRpMain())+'</div>';
}
function vfRpMain(){
  const rows=VF.lines.map((l,i)=>{
    const led=l.ledger?ledgerById(parseInt(l.ledger,10)):null;
    const subs=led&&led.sub_ledger_type?(S.subCache[led.id]||[]):[];
    return '<tr><td style="min-width:230px"><select onchange="acxVfLed('+i+',this.value)">'+ledgerOpts(x=>!x.is_bank&&!x.is_cash,l.ledger,'Choose account head…')+'</select><div class="acx-bal" id="vfLB_'+i+'"></div></td>'
      +'<td style="min-width:190px">'+(led&&led.sub_ledger_type?'<select onchange="acxVfSub('+i+',this.value)">'+opt('','Choose '+led.sub_ledger_type+'…',l.sub)+subs.map(s=>opt(s.id,s.name,l.sub)).join('')+opt('__new','＋ New sub-ledger…',l.sub)+'</select>'
         +(l.sub==='__new'?'<input style="margin-top:4px" placeholder="New sub-ledger name" value="'+esc(l.subNew)+'" oninput="acxVfF('+i+',\'subNew\',this.value)">':''):'<span class="acx-dim">—</span>')+'</td>'
      +'<td style="min-width:140px"><input class="n" inputmode="decimal" value="'+esc(l.amt)+'" oninput="acxVfAmt('+i+',this.value)"><div class="acx-bal" id="vfLA_'+i+'"></div></td>'
      +'<td style="width:34px"><button class="btn btn-sm btn-ghost" title="Remove line" onclick="acxVfDel('+i+')"><i class="fa-solid fa-xmark"></i></button></td></tr>';}).join('');
  return '<div class="acx-lines-wrap"><table class="acx-lines" style="min-width:560px"><thead><tr><th>Account head</th><th>Sub-ledger</th><th>Amount</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'
    +'<div class="acx-sticky-foot"><button class="btn btn-sm" onclick="acxVfAdd()"><i class="fa-solid fa-plus"></i> Add line</button><span class="acx-right"></span><div class="acx-tot"><span>Total</span><b id="vfTotal">'+money(VF.lines.reduce((s,l)=>s+num(l.amt),0))+'</b></div></div>';
}
function vfRpOther(){
  const T=VT[VF.type];
  return '<div class="acx-grid2">'+field('Mode','<select id="vfMode" onchange="acxVfMode()">'+opts(MODES,VF.mode)+'</select>')
    +field((VF.type==='payment'?'Cheque no':'Cheque / DD / reference no')+(VF.type==='payment'?' <span class="acx-dim" style="text-transform:none">(leave blank to take the next from the cheque book)</span>':''),'<input id="vfInst" value="'+esc(VF.inst)+'">')
    +field('Instrument date','<input type="date" id="vfInstDate" value="'+esc(VF.instDate)+'">')
    +field(T.party,'<input id="vfParty" value="'+esc(VF.party)+'">')+'</div>';
}
function vfRpDim(){
  const rows=VF.lines.map((l,i)=>{
    const led=l.ledger?ledgerById(parseInt(l.ledger,10)):null;
    const cled=l.cost?ledgerById(parseInt(l.cost,10)):null;
    const csubs=cled&&cled.sub_ledger_type?(S.subCache[cled.id]||[]):[];
    return '<tr><td style="min-width:200px">'+(led?esc(led.name):'<span class="acx-dim">Choose the account head first</span>')+'</td>'
      +'<td style="min-width:220px"><select onchange="acxVfCost('+i+',this.value)">'+costOpts(l.cost,'—')+'</select></td>'
      +'<td style="min-width:200px">'+(cled&&cled.sub_ledger_type?'<select onchange="acxVfF('+i+',\'csub\',this.value)">'+opt('','Choose sub-ledger…',l.csub)+csubs.map(s=>opt(s.id,s.name,l.csub)).join('')+'</select>':'<span class="acx-dim">—</span>')+'</td></tr>';}).join('');
  return '<div class="acx-hint" style="margin-bottom:8px">Optional. Tag a line to a cost or custom ledger (and its sub-ledger) to follow the spend by block, activity or campaign. It does not change the trial balance.</div>'
    +'<div class="acx-lines-wrap"><table class="acx-lines" style="min-width:0"><thead><tr><th>Account head</th><th>Cost / custom ledger</th><th>Sub-ledger</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
window.acxVfTab=function(t){ vfSyncHead(); VF.tab=t; vfRedrawLines(); };
window.acxVfBank=function(){ vfSyncHead(); vfPaintBal(); };
window.acxVfDate=function(){
  vfSyncHead(); VF.bal={}; const fy=$('vfFy'); if(fy) fy.value=fyLabel(VF.date); vfLoadDocNo(); vfPaintBal();
};
function vfDrawRP(){
  const T=VT[VF.type];
  openModal('<div class="modal-head"><h3 id="vfTitle">New '+T.label.toLowerCase()+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body"><div id="vfHead">'+vfHeadRP()+'</div><div id="vfLines">'+vfLinesHtml()+'</div>'
    +'<div class="acx-hint" id="vfHint">'+esc(vfRpHint())+'</div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="vfPost" onclick="acxVfSave()">Post '+T.label.toLowerCase()+'</button></div>','lg');
  vfLoadDocNo(); vfPaintBal();
}
function vfDraw(){ if(VT[VF.type].kind==='lines') return vfDrawRP(); return vfDrawBasic(); }
function vfDrawBasic(){
  const T=VT[VF.type];
  openModal('<div class="modal-head"><h3>New '+T.label.toLowerCase()+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body"><div id="vfHead">'+vfHead()+'</div><div id="vfLines">'+vfLinesHtml()+'</div>'
    +'<div class="acx-hint">'+({receipt:'Debit goes to the bank / cash account; the lines below are credited.',payment:'Credit goes to the bank / cash account; the lines below are debited. To pay a vendor against its bills use “Pay a vendor”.',deposit:'Cash is taken to the bank.',withdrawal:'Cash is drawn from the bank.',contra:'Money moves between two cash / bank accounts.',journal:'A journal moves value between ledgers without touching bank or cash. Total debits must equal total credits. A credit to a vendor here does not create a bill to pay (bills come from Purchase and Engineering); a debit to a vendor appears under on-account and can be set against that vendor’s bills.'}[VF.type])+'</div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="acxVfSave()">Post '+T.label.toLowerCase()+'</button></div>','lg');
}
function vfSyncHead(){
  const g=(id,f)=>{ if($(id)) f(val(id)); };
  g('vfDate',v=>{VF.date=v||VF.date;}); g('vfBu',v=>{VF.bu=v;}); g('vfMode',v=>{VF.mode=v||VF.mode;}); g('vfInst',v=>{VF.inst=v;}); g('vfInstDate',v=>{VF.instDate=v;});
  g('vfBank',v=>{VF.bank=v;}); g('vfParty',v=>{VF.party=v;}); g('vfNarr',v=>{VF.narr=v;}); g('vfNarr2',v=>{VF.narr=v;});
  g('vfAmount',v=>{VF.amount=v;}); g('vfFrom',v=>{VF.from=v;}); g('vfTo',v=>{VF.to=v;});
}
window.acxVfMode=function(){ VF.mode=val('vfMode'); };
window.acxVfF=function(i,k,v){ VF.lines[i][k]=v; };
window.acxVfAmt=function(i,v){ VF.lines[i].amt=v; const t=$('vfTotal'); if(t) t.textContent=money(VF.lines.reduce((s,l)=>s+num(l.amt),0)); vfPaintAfter(i,VF.lines[i].cur); };;
window.acxVfAdd=function(){ vfSyncHead(); VF.lines.push(blankLine()); vfRedrawLines(); };
window.acxVfDel=function(i){ vfSyncHead(); const min=VF.type==='journal'?2:1; if(VF.lines.length>min) VF.lines.splice(i,1); else VF.lines[i]=blankLine(); vfRedrawLines(); };
window.acxVfLed=async function(i,v){
  vfSyncHead(); const l=VF.lines[i]; l.ledger=v; l.sub=''; l.subNew='';
  const led=v?ledgerById(parseInt(v,10)):null; if(led&&led.sub_ledger_type) await subsOf(led.id);
  vfRedrawLines();
};
window.acxVfSub=function(i,v){ vfSyncHead(); VF.lines[i].sub=v; vfRedrawLines(); };
window.acxVfCost=async function(i,v){
  vfSyncHead(); const l=VF.lines[i]; l.cost=v; l.csub='';
  const led=v?ledgerById(parseInt(v,10)):null; if(led&&led.sub_ledger_type) await subsOf(led.id);
  vfRedrawLines();
};
window.acxVfSave=async function(){
  vfSyncHead(); const T=VT[VF.type];
  let head={company_id:S.coId,business_unit_id:VF.bu||null,voucher_type:VF.type,voucher_date:VF.date,mode:VF.mode,instrument_no:VF.inst||null,instrument_date:VF.instDate||null,narration:VF.narr||null,payee:VF.party||null};
  let lines=[];
  if(T.kind==='journal'){
    head.mode=null; head.payee=null;
    const used=VF.lines.filter(l=>l.ledger||num(l.dr)||num(l.cr));
    if(used.length<2){ toast('A journal needs at least two lines','err'); return; }
    let td=0,tc=0;
    for(let i=0;i<used.length;i++){
      const l=used[i], d=r2(num(l.dr)), c=r2(num(l.cr));
      if(!l.ledger){ toast('Line '+(i+1)+': choose the ledger','err'); return; }
      if((d>0)===(c>0)){ toast('Line '+(i+1)+': enter either a debit or a credit amount','err'); return; }
      const led=ledgerById(parseInt(l.ledger,10)); let sub=l.sub||null;
      if(led.sub_ledger_type&&!sub){ toast('Line '+(i+1)+': choose the sub-ledger','err'); return; }
      if(sub==='__new'){
        const nm=(l.subNew||'').trim(); if(!nm){ toast('Line '+(i+1)+': enter the new sub-ledger name','err'); return; }
        const r=await AC().from('sub_ledgers').insert({ledger_id:led.id,name:nm}).select('id').single(); if(fail(r.error,'Could not add the sub-ledger')) return;
        sub=r.data.id; l.sub=String(sub); delete S.subCache[led.id];
      }
      const cl=l.cost?ledgerById(parseInt(l.cost,10)):null;
      if(cl&&cl.sub_ledger_type&&!l.csub){ toast('Line '+(i+1)+': choose the cost sub-ledger','err'); return; }
      td+=d; tc+=c;
      const row={ledger_id:led.id,sub_ledger_id:sub?parseInt(sub,10):null,cost_ledger_id:cl?cl.id:null,cost_sub_ledger_id:cl&&l.csub?parseInt(l.csub,10):null,narration:l.nar||null};
      if(d>0) row.dr=d; else row.cr=c; lines.push(row);
    }
    if(Math.abs(r2(td)-r2(tc))>=0.005){ toast('Debits '+money(td)+' and credits '+money(tc)+' must be equal','err'); return; }
    if(!(VF.narr||'').trim()){ toast('Write the narration — why is this entry being made?','err'); return; }
  }else if(T.kind==='lines'){
    if(!VF.bank){ toast('Choose the bank / cash account','err'); return; }
    if(VF.type==='receipt'&&(VF.mode==='cheque'||VF.mode==='dd')&&!VF.inst){ toast('Enter the cheque / DD number (Other Info tab)','err'); VF.tab='other'; vfRedrawLines(); return; }
    const used=VF.lines.filter(l=>l.ledger||num(l.amt));
    if(!used.length){ toast('Add at least one line','err'); return; }
    let total=0;
    for(let i=0;i<used.length;i++){
      const l=used[i]; if(!l.ledger){ toast('Line '+(i+1)+': choose the ledger','err'); return; } if(num(l.amt)<=0){ toast('Line '+(i+1)+': enter the amount','err'); return; }
      const led=ledgerById(parseInt(l.ledger,10)); let sub=l.sub||null;
      if(led.sub_ledger_type&&!sub){ toast('Line '+(i+1)+': choose the sub-ledger','err'); return; }
      if(sub==='__new'){
        const nm=(l.subNew||'').trim(); if(!nm){ toast('Line '+(i+1)+': enter the new sub-ledger name','err'); return; }
        const r=await AC().from('sub_ledgers').insert({ledger_id:led.id,name:nm}).select('id').single(); if(fail(r.error,'Could not add the sub-ledger')) return;
        sub=r.data.id; delete S.subCache[led.id];
      }
      const cl=l.cost?ledgerById(parseInt(l.cost,10)):null;
      if(cl&&cl.sub_ledger_type&&!l.csub){ toast('Line '+(i+1)+': choose the cost sub-ledger','err'); return; }
      const amt=r2(num(l.amt)); total+=amt;
      const row={ledger_id:led.id,sub_ledger_id:sub||null,cost_ledger_id:cl?cl.id:null,cost_sub_ledger_id:cl&&l.csub?parseInt(l.csub,10):null,narration:l.nar||null};
      row[VF.type==='receipt'?'cr':'dr']=amt; lines.push(row);
    }
    const bankLine={ledger_id:parseInt(VF.bank,10)}; bankLine[VF.type==='receipt'?'dr':'cr']=r2(total); lines.unshift(bankLine);
  }else{
    const amt=r2(num(VF.amount)); if(amt<=0){ toast('Enter the amount','err'); return; }
    if(!VF.from||!VF.to){ toast('Choose both accounts','err'); return; }
    if(VF.from===VF.to){ toast('The two accounts must be different','err'); return; }
    lines=[{ledger_id:parseInt(VF.to,10),dr:amt},{ledger_id:parseInt(VF.from,10),cr:amt}];
  }
  const {data,error}=await rpc('voucher_post',{p_head:head,p_lines:lines}); if(fail(error,'Could not post')) return;
  closeModal(); toast(T.label+' posted','ok'); route();
};

/* =================================================================== BILLS & ON-ACCOUNT */
const BL={rows:[],onacct:[],subs:{},filter:'out',vendor:'',q:'',pend:{}};
async function renderBills(host){
  let pq=AC().from('v_payables').select('*').eq('company_id',S.coId).eq('status','open').order('ref_date',{ascending:false}).limit(3000);
  let oq=AC().from('v_on_account').select('*').eq('company_id',S.coId).limit(3000);
  if(S.buId){ pq=pq.eq('business_unit_id',S.buId); oq=oq.eq('business_unit_id',S.buId); }
  const [p,o,pb,pr,rl]=await Promise.all([pq,oq,rpc('pending_postings',{p_source:'purchase_bill',p_company:S.coId,p_limit:1}),rpc('pending_postings',{p_source:'ra_bill',p_company:S.coId,p_limit:1}),rpc('retention_releases_view',{p_company:S.coId})]);
  if(p.error) throw p.error; if(o.error) throw o.error;
  BL.rel=rl.error?[]:(rl.data||[]);
  BL.rows=p.data||[]; BL.onacct=(o.data||[]).filter(x=>Number(x.amount)-Number(x.used)>0.004);
  BL.pend={bills:pb.data?pb.data.total:0,ra:pr.data?pr.data.total:0};
  const ids=[...new Set(BL.onacct.map(x=>x.sub_ledger_id))]; BL.subs={};
  if(ids.length){ const {data}=await AC().from('sub_ledgers').select('id,name').in('id',ids); (data||[]).forEach(s=>BL.subs[s.id]=s.name); }
  blDraw(host);
}
function blList(){
  const f=BL.filter, q=BL.q.toLowerCase();
  return BL.rows.filter(r=>{
    const out=Number(r.outstanding)>0.004;
    if(f==='out'&&!(out&&r.kind==='bill')) return false; if(f==='over'&&!(out&&r.kind==='bill'&&r.due_date&&r.due_date<today())) return false;
    if(f==='ret'&&!(out&&r.kind==='retention')) return false; if(f==='settled'&&out) return false;
    if(BL.vendor&&String(r.vendor_id)!==String(BL.vendor)) return false;
    return !q||((r.ref_no||'')+' '+vendorName(r.vendor_id)+' '+(r.voucher_no||'')).toLowerCase().includes(q);
  });
}
function blDraw(host){
  host=host||$('acxSec'); if(!host) return;
  const bills=BL.rows.filter(r=>r.kind==='bill'), ret=BL.rows.filter(r=>r.kind==='retention');
  const sum=l=>l.reduce((s,r)=>s+Number(r.outstanding),0);
  const overdue=bills.filter(r=>Number(r.outstanding)>0.004&&r.due_date&&r.due_date<today());
  const onTot=BL.onacct.reduce((s,x)=>s+Number(x.amount)-Number(x.used),0);
  const waiting=(BL.pend.bills||0)+(BL.pend.ra||0);
  const kpi=(k,v,s)=>'<div class="acx-kpi"><div class="k">'+k+'</div><div class="v">'+v+'</div>'+(s?'<div class="s">'+s+'</div>':'')+'</div>';
  const f=BL.filter, q=BL.q.toLowerCase();
  const list=blList();
  const vendorsHere=[...new Set(BL.rows.map(r=>r.vendor_id))].sort((a,b)=>vendorName(a).localeCompare(vendorName(b)));
  const chips=[['out','Outstanding bills'],['over','Overdue'],['ret','Retention held'],['settled','Settled'],['all','All']].map(c=>'<span class="chip'+(f===c[0]?' active':'')+'" onclick="acxBlFilter(\''+c[0]+'\')">'+c[1]+'</span>').join('');
  const rows=list.map(r=>{const out=Number(r.outstanding),od=out>0.004&&r.kind==='bill'&&r.due_date&&r.due_date<today();
    return '<tr><td><b>'+esc(vendorName(r.vendor_id))+'</b></td><td>'+esc(String(r.ref_no||'—').replace(/ retention$/,''))+(r.kind==='retention'?' <span class="acx-pill">retention</span>':'')+'<div class="acx-hint">'+esc(r.voucher_no)+'</div></td><td>'+esc(r.business_unit_id?buName(r.business_unit_id):'—')+'</td>'
      +'<td style="white-space:nowrap">'+dmy(r.ref_date)+'</td><td style="white-space:nowrap">'+(r.due_date?(od?'<span style="color:#b91c1c;font-weight:600">'+dmy(r.due_date)+'</span>':dmy(r.due_date)):'—')+'</td>'
      +'<td class="acx-num">'+money(r.amount)+'</td><td class="acx-num">'+money(r.settled)+'</td><td class="acx-num"><b>'+money(out)+'</b></td>'
      +'<td class="acx-act"><button class="btn btn-sm btn-ghost" title="History" onclick="acxBillHist('+r.id+')"><i class="fa-solid fa-clock-rotate-left"></i></button>'+(r.kind==='retention'?(out>0.004?'<span class="acx-hint" title="Retention is released only on Engineering’s certificate">via release</span>':''):(S.canPost&&out>0.004?'<button class="btn btn-sm" onclick="acxPayOpen('+r.vendor_id+','+r.id+')">Pay</button>':''))+'</td></tr>';}).join('');
  const RTAG={Requested:['Awaiting approval in Engineering','t-amber'],Approved:['Approved — ready to pay','t-blue'],Paid:['Paid','t-green'],Rejected:['Rejected','t-red'],Cancelled:['Cancelled','t-gray']};
  const relList=(BL.rel||[]).filter(r=>BL.relAll||(r.status!=='Rejected'&&r.status!=='Cancelled')).slice(0,80);
  const relRows=relList.map(r=>{const tg=RTAG[r.status]||[r.status,'t-gray'];
    return '<tr><td><span class="acx-code">'+esc(r.doc_no)+'</span></td><td><b>'+esc(r.vendor)+'</b><div class="acx-hint">'+esc(r.wo_no)+' · '+esc(r.project)+'</div></td>'
      +'<td class="acx-num"><b>'+money(r.amount)+'</b><div class="acx-hint">'+(r.lines||[]).map(l=>esc(String(l.bill_no).split('/').pop())+' '+money(l.amount)).join(' · ')+'</div></td><td style="max-width:260px;white-space:normal">'+esc(r.reason)+'</td>'
      +'<td><span class="tag '+tg[1]+'">'+tg[0]+'</span>'+(r.status==='Approved'?'<div class="acx-hint">by '+esc(String(r.decided_by||'').split('@')[0])+', '+dmy(r.decided_at)+'</div>':'')+(r.status==='Paid'?'<div class="acx-hint"><span class="acx-link" onclick="acxVoucherOpen('+r.paid_voucher_id+')">'+esc(r.paid_voucher_no||'')+'</span> · '+dmy(r.paid_at)+'</div>':'')+'</td>'
      +'<td class="acx-act">'+(r.status==='Approved'&&S.canPost?'<button class="btn btn-sm btn-primary" onclick="acxPayRelease('+r.id+')">Pay</button>':'')+'</td></tr>';}).join('');
  const relReady=(BL.rel||[]).filter(r=>r.status==='Approved');
  const orows=BL.onacct.map(x=>'<tr><td><b>'+esc(BL.subs[x.sub_ledger_id]||'Vendor')+'</b></td><td><span class="acx-code">'+esc(x.doc_no)+'</span> '+vtag(x.voucher_type)+'</td><td style="white-space:nowrap">'+dmy(x.voucher_date)+'</td>'
    +'<td>'+esc(x.narration||'')+'</td><td class="acx-num">'+money(x.amount)+'</td><td class="acx-num">'+money(x.used)+'</td><td class="acx-num"><b>'+money(Number(x.amount)-Number(x.used))+'</b></td>'
    +'<td class="acx-act">'+(S.canPost?'<button class="btn btn-sm" onclick="acxAdjOpen('+x.voucher_id+')">Adjust against bills</button>':'')+'</td></tr>').join('');
  host.innerHTML='<div class="toolbar"><div style="flex:1"><div class="sec-title" style="margin:0">Bills & on-account payments</div><div class="acx-hint" style="margin:0">Bills booked in Purchase and Engineering reach here once posted (Ledgers & postings › Bill postings). Pay them in full or in part, pay on account, and set earlier on-account payments against bills.</div></div>'
    +(S.canPost?'<button class="btn btn-primary" onclick="acxPayOpen()"><i class="fa-solid fa-truck"></i> Pay a vendor</button><button class="btn" onclick="acxAdjOpen()"><i class="fa-solid fa-link"></i> Adjust on-account</button>':'')+'</div>'
    +(waiting?'<div class="acx-warn"><b>'+waiting+' booked bill'+(waiting===1?'':'s')+'</b> ('+(BL.pend.bills||0)+' purchase, '+(BL.pend.ra||0)+' RA) waiting to be posted. <span class="acx-link" onclick="navTo(\'accounts/1/postings\')">Open Bill postings →</span></div>':'')
    +'<div class="acx-kpis">'+kpi('Outstanding bills',money(sum(bills)),bills.filter(r=>Number(r.outstanding)>0.004).length+' bills')+kpi('Overdue',money(sum(overdue)),overdue.length+' bills past their due date')+kpi('Retention held',money(sum(ret)),'RA bill retention not yet released')
      +kpi('On account (unadjusted)',money(onTot),BL.onacct.length+' payment'+(BL.onacct.length===1?'':'s')+' not set against bills')+'</div>'
    +'<div class="acx-top"><div class="acx-subs" style="margin:0">'+chips+'</div><select id="blVendor" onchange="acxBlVendor()">'+opt('','All vendors',BL.vendor)+vendorsHere.map(v=>opt(v,vendorName(v),BL.vendor)).join('')+'</select><input class="grow" id="blQ" placeholder="Search by vendor, invoice or voucher" value="'+esc(BL.q)+'" oninput="acxBlSearch()">'+dlBtns('acxBlDownload')+'</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Vendor</th><th>Invoice / bill</th><th>Business unit</th><th>Bill date</th><th>Due</th><th class="acx-num">Amount</th><th class="acx-num">Paid / adjusted</th><th class="acx-num">Outstanding</th><th></th></tr></thead><tbody>'
    +(rows||'<tr><td colspan="9"><div class="empty" style="padding:24px"><div>Nothing here</div></div></td></tr>')+'</tbody></table></div></div>'
    +'<div class="acx-sec-title" style="display:flex;align-items:center;gap:8px">Retention releases certified by Engineering'+(relReady.length?' <span class="tag t-blue" style="margin-left:6px">'+relReady.length+' ready to pay · '+money(relReady.reduce((s,r)=>s+Number(r.amount),0))+'</span>':'')+'<span style="flex:1"></span>'+dlBtns('acxRelDownload','','btn-sm')+'</div>'
    +'<div class="acx-hint" style="margin-bottom:8px">Retention held back from RA bills is paid only against a release that Engineering has requested and a second person has approved (Engineering › Retention). It is paid here, for exactly the approved amount.</div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Release</th><th>Contractor</th><th class="acx-num">Amount</th><th>Why</th><th>Status</th><th></th></tr></thead><tbody>'
    +(relRows||'<tr><td colspan="6"><div class="empty" style="padding:20px"><div>No retention release has been requested yet</div></div></td></tr>')+'</tbody></table></div></div>'
    +'<div class="acx-sec-title" style="display:flex;align-items:center;gap:8px">On-account payments not yet set against bills<span style="flex:1"></span>'+dlBtns('acxOaDownload','','btn-sm')+'</div><div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Vendor</th><th>Entry</th><th>Date</th><th>Narration</th><th class="acx-num">Amount</th><th class="acx-num">Adjusted</th><th class="acx-num">Available</th><th></th></tr></thead><tbody>'
    +(orows||'<tr><td colspan="8"><div class="empty" style="padding:20px"><div>No on-account balance</div></div></td></tr>')+'</tbody></table></div></div>';
}
window.acxBlFilter=function(f){ BL.filter=f; blDraw(); };
window.acxBlVendor=function(){ BL.vendor=val('blVendor'); blDraw(); };
window.acxBlSearch=function(){ BL.q=val('blQ'); blDraw(); const e=$('blQ'); if(e){ e.focus(); e.setSelectionRange(e.value.length,e.value.length); } };
const sumOf=(l,k)=>l.reduce((s,r)=>s+Number(r[k]||0),0);
window.acxBlDownload=function(fmt,btn){
  const list=blList(), lab={out:'Outstanding bills',over:'Overdue bills',ret:'Retention held',settled:'Settled bills',all:'All bills'}[BL.filter]||'Bills';
  X.download(fmt,{title:'Bills & payments - '+lab,file:'Bills_'+lab,
    sub:lab+(BL.vendor?' · Vendor: '+vendorName(Number(BL.vendor)):' · All vendors')+(S.buId?' · Business unit: '+buName(S.buId):' · All business units')+(BL.q?' · Search: "'+BL.q+'"':'')+' · as on '+dmy(today()),
    cols:[{h:'Vendor'},{h:'Invoice / bill'},{h:'Type'},{h:'Voucher'},{h:'Business unit'},{h:'Bill date',t:'d'},{h:'Due date',t:'d'},{h:'Amount',t:'n'},{h:'Paid / adjusted',t:'n'},{h:'Outstanding',t:'n'}],
    rows:list.map(r=>[vendorName(r.vendor_id),String(r.ref_no||'').replace(/ retention$/,''),r.kind==='retention'?'Retention':'Bill',r.voucher_no||'',r.business_unit_id?buName(r.business_unit_id):'',r.ref_date,r.due_date||'',r.amount,r.settled,r.outstanding]),
    foot:['Total ('+list.length+')','','','','','','',sumOf(list,'amount'),sumOf(list,'settled'),sumOf(list,'outstanding')]},btn);
};
window.acxOaDownload=function(fmt,btn){
  const l=BL.onacct;
  X.download(fmt,{title:'On-account payments not yet set against bills',file:'On-account_payments',
    sub:'Payments made to vendors that are not yet set against their bills'+(S.buId?' · Business unit: '+buName(S.buId):' · All business units')+' · as on '+dmy(today()),
    cols:[{h:'Vendor'},{h:'Entry'},{h:'Type'},{h:'Date',t:'d'},{h:'Narration'},{h:'Amount',t:'n'},{h:'Adjusted',t:'n'},{h:'Available',t:'n'}],
    rows:l.map(x=>[BL.subs[x.sub_ledger_id]||'Vendor',x.doc_no,(VTYPE[x.voucher_type]||[x.voucher_type])[0],x.voucher_date,x.narration||'',x.amount,x.used,Number(x.amount)-Number(x.used)]),
    foot:['Total ('+l.length+')','','','','',sumOf(l,'amount'),sumOf(l,'used'),l.reduce((s,x)=>s+Number(x.amount)-Number(x.used),0)]},btn);
};
window.acxRelDownload=function(fmt,btn){
  const l=(BL.rel||[]).filter(r=>BL.relAll||(r.status!=='Rejected'&&r.status!=='Cancelled'));
  X.download(fmt,{title:'Retention releases certified by Engineering',file:'Retention_releases',
    sub:'Retention held back from RA bills, released against Engineering approvals'+(BL.relAll?' · including rejected and cancelled':'')+' · as on '+dmy(today()),
    cols:[{h:'Release'},{h:'Contractor'},{h:'Work order'},{h:'Project'},{h:'Amount',t:'n'},{h:'Reason'},{h:'Status'},{h:'Paid by voucher'}],
    rows:l.map(r=>[r.doc_no,r.vendor,r.wo_no,r.project,r.amount,r.reason,r.status,r.paid_voucher_no||'']),
    foot:['Total ('+l.length+')','','','',sumOf(l,'amount'),'','','']},btn);
};
window.acxBillHist=async function(id){
  openModal('<div class="modal-body"><div class="loader"><div class="spin"></div></div></div>');
  const [p,a]=await Promise.all([AC().from('v_payables').select('*').eq('id',id).single(),AC().from('payable_allocations').select('*').eq('payable_id',id).order('id')]);
  if(p.error||a.error){ closeModal(); fail(p.error||a.error,'Could not load'); return; }
  const vids=[...new Set((a.data||[]).map(x=>x.from_voucher_id))]; const vm={};
  if(vids.length){ const {data}=await AC().from('vouchers').select('id,doc_no,voucher_type,voucher_date,mode,instrument_no').in('id',vids); (data||[]).forEach(v=>vm[v.id]=v); }
  const r=p.data;
  openModal('<div class="modal-head"><h3>'+esc(r.ref_no||'Bill')+' — '+esc(vendorName(r.vendor_id))+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body">'
    +'<div class="acx-grid4"><div class="acx-field"><label>Amount</label><b>'+money(r.amount)+'</b></div><div class="acx-field"><label>Settled</label><b>'+money(r.settled)+'</b></div><div class="acx-field"><label>Outstanding</label><b>'+money(r.outstanding)+'</b></div><div class="acx-field"><label>Posted as</label>'+esc(r.voucher_no)+'</div></div>'
    +'<div class="card" style="padding:0"><table class="tbl acx-mini"><thead><tr><th>Entry</th><th>How</th><th>Date</th><th class="acx-num">Amount</th><th>Status</th><th></th></tr></thead><tbody>'
    +((a.data||[]).map(x=>{const v=vm[x.from_voucher_id]||{};return '<tr><td><span class="acx-code acx-link" onclick="acxVoucherOpen('+x.from_voucher_id+')">'+esc(v.doc_no||'')+'</span> '+vtag(v.voucher_type)+(v.instrument_no?'<div class="acx-hint">'+esc(v.instrument_no)+'</div>':'')+'</td><td>'+({payment:'Payment',adjustment:'On-account adjustment',debit_note:'Debit note'}[x.kind]||x.kind)+'</td><td>'+dmy(x.alloc_date)+'</td><td class="acx-num">'+money(x.amount)+'</td><td>'+(x.status==='active'?'<span class="tag t-green">Active</span>':'<span class="tag t-gray">Cancelled</span>')+'</td>'
      +'<td class="acx-act">'+(S.canPost&&x.status==='active'&&x.kind==='adjustment'?'<button class="btn btn-sm btn-ghost" onclick="acxAllocUndo('+x.id+')">Undo</button>':'')+'</td></tr>';}).join('')||'<tr><td colspan="6"><div class="empty" style="padding:18px"><div>Nothing has been paid against this yet</div></div></td></tr>')
    +'</tbody></table></div></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>');
};
window.acxAllocUndo=async function(id){
  if(!await confirmDialog('Undo this on-account adjustment? The bill becomes outstanding again.',{okLabel:'Undo'})) return;
  const {error}=await rpc('cancel_allocation',{p_id:id}); if(fail(error,'Could not undo')) return; toast('Adjustment undone','ok'); route();
};

/* ---------------- pay a vendor ---------------- */
let PY=null;
window.acxPayOpen=async function(vendorId,payableId){
  if(!cashBank().length){ toast('Add a bank or cash ledger first (Ledgers & postings › Chart of accounts)','err'); return; }
  PY={vendor:vendorId||'',payables:[],onacct:0,alloc:{},on:'',date:today(),mode:'cheque',inst:'',instDate:'',payee:'',narr:'',bu:S.buId||'',bank:(cashBank().find(l=>l.is_bank)||cashBank()[0]).id,first:payableId||null,dues:{}};
  openModal('<div class="modal-body"><div class="loader"><div class="spin"></div></div></div>','lg');
  const {data}=await AC().from('v_payables').select('vendor_id,outstanding').eq('company_id',S.coId).eq('status','open').gt('outstanding',0).limit(5000);
  (data||[]).forEach(r=>{ PY.dues[r.vendor_id]=(PY.dues[r.vendor_id]||0)+Number(r.outstanding); });
  if(PY.vendor) await pyLoadVendor(); else pyDraw();
};
async function pyLoadVendor(){
  const v=S.vendors.find(x=>x.id===parseInt(PY.vendor,10)); PY.payee=v?v.legal_name:'';
  const [p,vc]=await Promise.all([AC().from('v_payables').select('*').eq('company_id',S.coId).eq('vendor_id',PY.vendor).eq('status','open').gt('outstanding',0).order('ref_date'),
    AC().from('ledgers').select('id').eq('company_id',S.coId).eq('system_key','vendor_control').maybeSingle()]);
  PY.payables=p.data||[]; PY.alloc={}; PY.onacct=0;
  if(PY.first){ const r=PY.payables.find(x=>x.id===PY.first); if(r&&r.kind==='bill') PY.alloc[r.id]=Number(r.outstanding); PY.first=null; }
  if(vc.data){ const {data:sl}=await AC().from('sub_ledgers').select('id').eq('ledger_id',vc.data.id).eq('party_type','vendor').eq('party_id',PY.vendor).maybeSingle();
    if(sl){ const {data:oa}=await AC().from('v_on_account').select('amount,used').eq('company_id',S.coId).eq('sub_ledger_id',sl.id); PY.onacct=(oa||[]).reduce((s,x)=>s+Number(x.amount)-Number(x.used),0); } }
  const b0=PY.payables.find(x=>PY.alloc[x.id]); if(b0&&b0.business_unit_id&&!PY.bu) PY.bu=b0.business_unit_id;
  pyDraw();
}
function pySync(){
  if(!$('pyDate')) return; PY.date=val('pyDate'); PY.mode=val('pyMode'); PY.inst=val('pyInst'); PY.instDate=val('pyInstDate'); PY.payee=val('pyPayee'); PY.narr=val('pyNarr'); PY.bu=val('pyBu'); PY.bank=val('pyBank'); PY.on=val('pyOn');
}
function pyTotal(){ return r2(Object.values(PY.alloc).reduce((s,x)=>s+num(x),0)+num(PY.on)); }
function pyDraw(){
  const withDues=S.vendors.filter(v=>PY.dues[v.id]).sort((a,b)=>(a.trade_name||a.legal_name).localeCompare(b.trade_name||b.legal_name));
  const others=S.vendors.filter(v=>!PY.dues[v.id]&&v.status==='approved');
  const rows=PY.payables.map(r=>'<tr><td>'+esc(String(r.ref_no||'—').replace(/ retention$/,''))+(r.kind==='retention'?' <span class="acx-pill">retention</span>':'')+'<div class="acx-hint">'+esc(r.voucher_no)+'</div></td><td style="white-space:nowrap">'+dmy(r.ref_date)+'</td><td style="white-space:nowrap">'+(r.due_date?dmy(r.due_date):'—')+'</td>'
    +'<td class="acx-num">'+money(r.outstanding)+'</td>'
    +(r.kind==='retention'?'<td colspan="2" class="acx-hint">Needs a release approved in Engineering — pay it from “Retention releases”</td>'
      :'<td style="width:150px"><input class="n" inputmode="decimal" style="width:100%;height:34px;border:1px solid var(--line);border-radius:6px;padding:0 8px;text-align:right" value="'+(PY.alloc[r.id]!=null?esc(PY.alloc[r.id]):'')+'" oninput="acxPyAlloc('+r.id+',this.value)"></td>'
        +'<td><button class="btn btn-sm btn-ghost" onclick="acxPyFull('+r.id+','+Number(r.outstanding)+')">Full</button></td>')+'</tr>').join('');
  openModal('<div class="modal-head"><h3>Pay a vendor</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body">'
    +'<div class="acx-grid2">'+field('Vendor / contractor','<select id="pyVendor" onchange="acxPyVendor()">'+opt('','Choose…',PY.vendor)+(withDues.length?'<optgroup label="With outstanding bills">'+withDues.map(v=>opt(v.id,(v.trade_name||v.legal_name)+' — '+money(PY.dues[v.id]),PY.vendor)).join('')+'</optgroup>':'')
      +'<optgroup label="Other approved vendors (pay on account)">'+others.map(v=>opt(v.id,(v.trade_name||v.legal_name),PY.vendor)).join('')+'</optgroup></select>')
      +field('Paid from','<select id="pyBank">'+cashBank().map(l=>opt(l.id,l.name+(l.is_cash?' (cash)':''),PY.bank)).join('')+'</select>')+'</div>'
    +(PY.vendor?'<div class="acx-grid4">'+field('Date','<input type="date" id="pyDate" value="'+esc(PY.date)+'" max="'+today()+'">')+field('Mode','<select id="pyMode">'+opts(MODES,PY.mode)+'</select>')
      +field('Cheque / reference no','<input id="pyInst" value="'+esc(PY.inst)+'"><div class="h">Blank = next number from the cheque book</div>')+field('Instrument date','<input type="date" id="pyInstDate" value="'+esc(PY.instDate)+'">')+'</div>'
      +'<div class="acx-grid3">'+field('Business unit','<select id="pyBu">'+opt('','Company level',PY.bu)+coBus().filter(b=>b.active).map(b=>opt(b.id,b.name,PY.bu)).join('')+'</select>')+field('Payee name (on the cheque)','<input id="pyPayee" value="'+esc(PY.payee)+'">')+field('Narration','<input id="pyNarr" value="'+esc(PY.narr)+'">')+'</div>'
      +'<div class="acx-sec-title" style="margin-top:0">Against bills</div><div class="card" style="padding:0;margin-bottom:12px"><div style="overflow-x:auto"><table class="tbl acx-mini"><thead><tr><th>Bill</th><th>Date</th><th>Due</th><th class="acx-num">Outstanding</th><th>Pay now</th><th></th></tr></thead><tbody>'
      +(rows||'<tr><td colspan="6"><div class="empty" style="padding:16px"><div>No outstanding bill for this vendor — you can still pay on account below.</div></div></td></tr>')+'</tbody></table></div></div>'
      +'<div class="acx-grid3">'+field('On account (not against any bill)','<input id="pyOn" class="n" inputmode="decimal" value="'+esc(PY.on)+'" oninput="acxPyOn()" style="text-align:right"><div class="h">'+(PY.onacct>0.004?'Already on account with this vendor: '+money(PY.onacct)+'. Set it against bills with “Adjust on-account”.':'Use this for advances before the bill arrives.')+'</div>')
      +'<div></div><div class="acx-tot" style="align-self:end;justify-content:flex-end"><span>Total payment</span><b id="pyTotal">'+money(pyTotal())+'</b></div></div>':'<div class="acx-hint">Choose a vendor to see its bills.</div>')
    +'</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>'+(PY.vendor?'<button class="btn btn-primary" onclick="acxPySave()">Post payment</button>':'')+'</div>','lg');
}
window.acxPyVendor=async function(){ pySync(); PY.vendor=val('pyVendor'); PY.first=null; if(PY.vendor) await pyLoadVendor(); else pyDraw(); };
window.acxPyAlloc=function(id,v){ PY.alloc[id]=v; const t=$('pyTotal'); if(t) t.textContent=money(pyTotal()); };
window.acxPyOn=function(){ PY.on=val('pyOn'); const t=$('pyTotal'); if(t) t.textContent=money(pyTotal()); };
window.acxPyFull=function(id,amt){ pySync(); PY.alloc[id]=amt; pyDraw(); };
window.acxPySave=async function(){
  pySync();
  const allocs=Object.keys(PY.alloc).map(k=>({payable_id:parseInt(k,10),amount:r2(num(PY.alloc[k]))})).filter(a=>a.amount>0);
  const on=r2(num(PY.on)); if(!allocs.length&&on<=0){ toast('Enter an amount to pay','err'); return; }
  if(!PY.bu){ const bus=[...new Set(PY.payables.filter(p=>num(PY.alloc[p.id])>0).map(p=>p.business_unit_id).filter(Boolean))]; if(bus.length===1) PY.bu=bus[0]; }
  const head={company_id:S.coId,business_unit_id:PY.bu||null,vendor_id:parseInt(PY.vendor,10),bank_ledger_id:parseInt(PY.bank,10),voucher_date:PY.date,mode:PY.mode,instrument_no:PY.inst||null,instrument_date:PY.instDate||null,payee:PY.payee||null,narration:PY.narr||null,on_account:on};
  const {data,error}=await rpc('vendor_payment',{p_head:head,p_allocs:allocs}); if(fail(error,'Could not post the payment')) return;
  closeModal(); toast('Payment posted','ok');
  if(PY.mode==='cheque'&&await confirmDialog('Payment posted. Print the cheque now?',{danger:false,okLabel:'Print cheque',title:'Payment posted'})){ await window.acxChequeFor(data); }
  route();
};

/* ---------------- pay a retention release approved in Engineering ---------------- */
let PR=null;
window.acxPayRelease=async function(relId){
  if(!cashBank().length){ toast('Add a bank or cash ledger first (Ledgers & postings › Chart of accounts)','err'); return; }
  openModal('<div class="modal-body"><div class="loader"><div class="spin"></div></div></div>','lg');
  const [rv,rr]=await Promise.all([rpc('retention_releases_view',{p_company:S.coId}),AC().from('retention_releases').select('business_unit_id').eq('id',relId).maybeSingle()]);
  const rel=(rv.data||[]).find(r=>r.id===relId);
  if(rv.error||!rel||rel.status!=='Approved'){ closeModal(); toast('That release is no longer waiting for payment','warn'); route(); return; }
  const v=S.vendors.find(x=>x.id===rel.vendor_id);
  PR={rel,bu:(rr.data&&rr.data.business_unit_id)||'',date:today(),mode:'cheque',inst:'',instDate:'',payee:v?v.legal_name:rel.vendor,narr:'',bank:(cashBank().find(l=>l.is_bank)||cashBank()[0]).id};
  prDraw();
};
function prSync(){ if(!$('prDate')) return; PR.date=val('prDate'); PR.mode=val('prMode'); PR.inst=val('prInst'); PR.instDate=val('prInstDate'); PR.payee=val('prPayee'); PR.narr=val('prNarr'); PR.bank=val('prBank'); }
function prDraw(){
  const r=PR.rel;
  openModal('<div class="modal-head"><h3>Pay retention release '+esc(r.doc_no)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body">'
    +'<div class="acx-grid3">'+field('Contractor','<b>'+esc(r.vendor)+'</b>')+field('Work order','<b>'+esc(r.wo_no)+'</b><div class="h">'+esc(r.project)+'</div>')+field('Approved','<b>'+esc(String(r.decided_by||'').split('@')[0])+'</b><div class="h">'+dmy(r.decided_at)+'</div>')+'</div>'
    +'<div class="acx-hint" style="margin:-4px 0 12px">Why: '+esc(r.reason)+'</div>'
    +'<div class="card" style="padding:0;margin-bottom:12px"><table class="tbl acx-mini"><thead><tr><th>RA bill</th><th class="acx-num">Retention released</th></tr></thead><tbody>'
    +(r.lines||[]).map(l=>'<tr><td>'+esc(l.bill_no)+'</td><td class="acx-num">'+money(l.amount)+'</td></tr>').join('')+'<tr><td><b>Total — exactly what was approved</b></td><td class="acx-num"><b>'+money(r.amount)+'</b></td></tr></tbody></table></div>'
    +'<div class="acx-grid4">'+field('Paid from','<select id="prBank">'+cashBank().map(l=>opt(l.id,l.name+(l.is_cash?' (cash)':''),PR.bank)).join('')+'</select>')+field('Date','<input type="date" id="prDate" value="'+esc(PR.date)+'" max="'+today()+'">')
      +field('Mode','<select id="prMode">'+opts(MODES,PR.mode)+'</select>')+field('Cheque / reference no','<input id="prInst" value="'+esc(PR.inst)+'"><div class="h">Blank = next number from the cheque book</div>')+'</div>'
    +'<div class="acx-grid3">'+field('Instrument date','<input type="date" id="prInstDate" value="'+esc(PR.instDate)+'">')+field('Payee name (on the cheque)','<input id="prPayee" value="'+esc(PR.payee)+'">')+field('Narration','<input id="prNarr" value="'+esc(PR.narr)+'" placeholder="Retention release '+esc(r.doc_no)+'">')+'</div>'
    +'</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="acxPrSave()">Post payment</button></div>','lg');
}
window.acxPrSave=async function(){
  prSync(); const r=PR.rel;
  const head={company_id:S.coId,business_unit_id:PR.bu||null,vendor_id:r.vendor_id,bank_ledger_id:parseInt(PR.bank,10),voucher_date:PR.date,mode:PR.mode,instrument_no:PR.inst||null,instrument_date:PR.instDate||null,payee:PR.payee||null,narration:PR.narr||null,release_id:r.id};
  const allocs=(r.lines||[]).map(l=>({payable_id:l.payable_id,amount:Number(l.amount)}));
  const {data,error}=await rpc('vendor_payment',{p_head:head,p_allocs:allocs}); if(fail(error,'Could not post the payment')) return;
  closeModal(); toast('Retention released and paid','ok');
  if(PR.mode==='cheque'&&await confirmDialog('Payment posted. Print the cheque now?',{danger:false,okLabel:'Print cheque',title:'Payment posted'})){ await window.acxChequeFor(data); }
  route();
};

/* ---------------- adjust an on-account payment against bills ---------------- */
let AJ=null;
window.acxAdjOpen=async function(voucherId){
  openModal('<div class="modal-body"><div class="loader"><div class="spin"></div></div></div>','lg');
  const {data:oa,error}=await AC().from('v_on_account').select('*').eq('company_id',S.coId).limit(3000); if(error){ closeModal(); fail(error,'Could not load'); return; }
  const items=(oa||[]).filter(x=>Number(x.amount)-Number(x.used)>0.004);
  if(!items.length){ closeModal(); toast('There is no on-account balance to adjust','warn'); return; }
  const ids=[...new Set(items.map(x=>x.sub_ledger_id))]; const names={};
  const {data:sl}=await AC().from('sub_ledgers').select('id,name,party_id').in('id',ids); (sl||[]).forEach(s=>names[s.id]=s);
  AJ={items,names,voucher:voucherId||items[0].voucher_id,alloc:{},date:today(),bills:[]};
  await ajLoadBills();
};
async function ajLoadBills(){
  const it=AJ.items.find(x=>x.voucher_id===AJ.voucher); AJ.alloc={};
  const {data}=await AC().from('v_payables').select('*').eq('company_id',S.coId).eq('sub_ledger_id',it.sub_ledger_id).eq('kind','bill').eq('status','open').gt('outstanding',0).order('ref_date');
  AJ.bills=data||[]; ajDraw();
}
function ajDraw(){
  const it=AJ.items.find(x=>x.voucher_id===AJ.voucher), avail=Number(it.amount)-Number(it.used);
  const used=r2(Object.values(AJ.alloc).reduce((s,x)=>s+num(x),0));
  openModal('<div class="modal-head"><h3>Adjust an on-account payment against bills</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body">'
    +field('On-account entry','<select id="ajV" onchange="acxAjVoucher()">'+AJ.items.map(x=>opt(x.voucher_id,(AJ.names[x.sub_ledger_id]||{}).name+' · '+x.doc_no+' · '+dmy(x.voucher_date)+' · available '+money(Number(x.amount)-Number(x.used)),AJ.voucher)).join('')+'</select>')
    +'<div class="acx-grid3">'+field('Available on account','<b>'+money(avail)+'</b>')+field('Adjustment date','<input type="date" id="ajDate" value="'+esc(AJ.date)+'" min="'+esc(it.voucher_date)+'" max="'+today()+'">')
    +'<div class="acx-tot" style="align-self:end;justify-content:flex-end"><span>Adjusting</span><b id="ajTotal">'+money(used)+'</b></div></div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto"><table class="tbl acx-mini"><thead><tr><th>Bill</th><th>Date</th><th>Due</th><th class="acx-num">Outstanding</th><th>Adjust</th><th></th></tr></thead><tbody>'
    +(AJ.bills.map(r=>'<tr><td>'+esc(r.ref_no||'—')+'<div class="acx-hint">'+esc(r.voucher_no)+'</div></td><td>'+dmy(r.ref_date)+'</td><td>'+(r.due_date?dmy(r.due_date):'—')+'</td><td class="acx-num">'+money(r.outstanding)+'</td>'
      +'<td style="width:150px"><input class="n" inputmode="decimal" style="width:100%;height:34px;border:1px solid var(--line);border-radius:6px;padding:0 8px;text-align:right" value="'+(AJ.alloc[r.id]!=null?esc(AJ.alloc[r.id]):'')+'" oninput="acxAjAlloc('+r.id+',this.value)"></td>'
      +'<td><button class="btn btn-sm btn-ghost" onclick="acxAjFull('+r.id+','+Number(r.outstanding)+')">Max</button></td></tr>').join('')||'<tr><td colspan="6"><div class="empty" style="padding:16px"><div>This vendor has no outstanding bill</div></div></td></tr>')
    +'</tbody></table></div></div><div class="acx-hint" style="margin-top:8px">No new entry is made in the ledgers: the vendor’s account already holds both the payment and the bill. The bills simply stop showing as outstanding.</div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="acxAjSave()">Adjust</button></div>','lg');
}
window.acxAjVoucher=async function(){ AJ.voucher=parseInt(val('ajV'),10); AJ.date=val('ajDate')||AJ.date; await ajLoadBills(); };
window.acxAjAlloc=function(id,v){ AJ.alloc[id]=v; const t=$('ajTotal'); if(t) t.textContent=money(r2(Object.values(AJ.alloc).reduce((s,x)=>s+num(x),0))); };
window.acxAjFull=function(id,amt){ AJ.date=val('ajDate')||AJ.date; const it=AJ.items.find(x=>x.voucher_id===AJ.voucher); const avail=Number(it.amount)-Number(it.used)-r2(Object.keys(AJ.alloc).filter(k=>+k!==id).reduce((s,k)=>s+num(AJ.alloc[k]),0)); AJ.alloc[id]=Math.max(0,Math.min(amt,r2(avail))); ajDraw(); };
window.acxAjSave=async function(){
  AJ.date=val('ajDate')||AJ.date;
  const allocs=Object.keys(AJ.alloc).map(k=>({payable_id:parseInt(k,10),amount:r2(num(AJ.alloc[k]))})).filter(a=>a.amount>0);
  if(!allocs.length){ toast('Enter the amount to adjust against at least one bill','err'); return; }
  const {error}=await rpc('on_account_adjust',{p_voucher_id:AJ.voucher,p_allocs:allocs,p_date:AJ.date}); if(fail(error,'Could not adjust')) return;
  closeModal(); toast('Adjusted','ok'); route();
};

/* ---------------- exports used by the other two files ---------------- */
Object.assign(X,{num,r2,money,drcr,dmy,dmyTime,today,val,chk,fail,rpc,opt,opts,field,errHtml,MODES,MODE_LABEL,VTYPE,vtag,SRC_LABEL,curCo,coBus,buName,ledgerById,ledName,vendorName,projName,cashBank,groupName,subsOf,fyStart});
})();
