/* Post Sales > Digital Forms (6 Nov 2026): the Digital Booking Form (booking-form.html) that customers fill from
   anywhere lands in acc.digital_booking_forms through the booking-form-public edge function. This tab is where staff
   see those forms: a list (newest first), and for each one every answer, the PAN / Aadhaar photos and the signature.
   Nothing here creates a booking - a form only lands in the table (the user's choice, 2 Nov 2026). */
const PDF={rows:[],f:{q:'',st:'all'}};
const PDF_ST={new:['New','#b3171d'],seen:['Seen','#6b7280'],used:['Used','#15803d'],rejected:['Rejected','#92400e']};
async function pdfRender(host){
  loader(host);
  const {data,error}=await sb.schema('acc').from('digital_booking_forms')
    .select('id,ref_no,project,status,applicants,first_name,mobile,email,submitted_at,seen_by,seen_at,note')
    .order('submitted_at',{ascending:false}).limit(500);
  if(error){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load the forms: '+esc(error.message)+'</div></div>'; return; }
  PDF.rows=data||[];
  if(pdfCanGenerate()) await pdfLoadLinks();
  pdfDraw(host);
}
function pdfWhen(t){ return t?new Date(t).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—'; }
function pdfChip(s){ const c=PDF_ST[s]||[s,'#6b7280']; return '<span style="font-size:11.5px;font-weight:600;color:'+c[1]+';border:1px solid '+c[1]+'33;background:'+c[1]+'12;border-radius:999px;padding:2px 9px">'+esc(c[0])+'</span>'; }
function pdfDraw(host){
  host=host||$('pdfBody'); if(!host) return;
  pdfDraw0(host);
  // Generate Form + the links made so far (Sales / the Administrator only)
  if(pdfCanGenerate()){
    const bar=host.firstElementChild;
    if(bar) bar.insertAdjacentHTML('afterbegin','<button class="btn btn-primary" onclick="pdfGenOpen()"><i class="fa-solid fa-link"></i> Generate Form</button>');
    host.insertAdjacentHTML('beforeend',pdfLinksHtml());
  }
}
function pdfDraw0(host){
  const rows=PDF.rows, n=s=>rows.filter(r=>r.status===s).length;
  const q=PDF.f.q.trim().toLowerCase();
  const list=rows.filter(r=>(PDF.f.st==='all'||r.status===PDF.f.st)&&(!q||[r.ref_no,r.first_name,r.mobile,r.email].join(' ').toLowerCase().indexOf(q)>=0));
  const tab=(k,l,c)=>'<button class="btn'+(PDF.f.st===k?' btn-primary':'')+'" style="padding:6px 12px" onclick="PDF.f.st=\''+k+'\';pdfDraw()">'+l+' <b>'+c+'</b></button>';
  host.innerHTML='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">'
      +tab('all','All',rows.length)+tab('new','New',n('new'))+tab('seen','Seen',n('seen'))+tab('used','Used',n('used'))+tab('rejected','Rejected',n('rejected'))
      +'<input class="inp" style="margin-left:auto;max-width:260px" placeholder="Search name, mobile, email, ref" value="'+esc(PDF.f.q)+'" oninput="PDF.f.q=this.value;pdfDraw();var i=document.querySelector(\'#pdfBody input\');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}">'
    +'</div>'
    +'<div class="card" style="padding:0;overflow:auto">'
    +(list.length?'<table style="width:100%;border-collapse:collapse;font-size:13.5px"><thead><tr style="text-align:left;color:var(--slate);font-size:12px;border-bottom:1px solid var(--line)">'
      +'<th style="padding:10px 14px">Reference</th><th style="padding:10px 8px">Received</th><th style="padding:10px 8px">First applicant</th><th style="padding:10px 8px">Mobile</th><th style="padding:10px 8px">Email</th><th style="padding:10px 8px">Status</th><th></th></tr></thead><tbody>'
      +list.map(r=>'<tr style="border-bottom:1px solid var(--line);cursor:pointer" onclick="pdfOpen(\''+r.id+'\')">'
        +'<td style="padding:10px 14px;font-weight:600">'+esc(r.ref_no||'—')+'</td><td style="padding:10px 8px;white-space:nowrap">'+esc(pdfWhen(r.submitted_at))+'</td>'
        +'<td style="padding:10px 8px">'+esc(r.first_name||'—')+(r.applicants>1?' <span style="color:var(--slate)">+ '+(r.applicants-1)+' more</span>':'')+'</td>'
        +'<td style="padding:10px 8px;white-space:nowrap">'+esc(r.mobile||'—')+'</td><td style="padding:10px 8px">'+esc(r.email||'—')+'</td>'
        +'<td style="padding:10px 8px">'+pdfChip(r.status)+'</td><td style="padding:10px 14px;text-align:right;color:var(--slate)"><i class="fa-solid fa-chevron-right"></i></td></tr>').join('')
      +'</tbody></table>'
     :'<div class="empty" style="padding:38px 20px"><i class="fa-regular fa-file-lines"></i><div>'+(rows.length?'No form matches.':'No digital booking form has been submitted yet. When a customer submits one, it appears here.')+'</div></div>')
    +'</div>';
}
function pdfRow(k,v){ return (v===''||v==null)?'':'<tr><td style="padding:6px 0;color:var(--slate);width:38%;vertical-align:top">'+esc(k)+'</td><td style="padding:6px 0">'+esc(v)+'</td></tr>'; }
function pdfD(d){ return d?new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):''; }
function pdfAddr(x){ return x?[x.line,x.city,x.pin].filter(Boolean).join(', '):''; }
function pdfSec(t,rows){ const b=rows.join(''); return b?'<div style="margin-top:16px"><div style="font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--slate);margin-bottom:4px">'+esc(t)+'</div><table style="width:100%;border-collapse:collapse;font-size:13.5px">'+b+'</table></div>':''; }
window.pdfOpen=async function(id){
  openModal('<div class="modal-head"><h3><i class="fa-regular fa-file-lines"></i> Digital Booking Form</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body"><div id="pdfDetail"></div></div>','lg');
  loader($('pdfDetail'));
  const {data,error}=await sb.schema('acc').from('digital_booking_forms').select('*').eq('id',id).maybeSingle();
  if(error||!data){ $('pdfDetail').innerHTML='<div class="empty"><div>Could not load this form'+(error?': '+esc(error.message):'')+'.</div></div>'; return; }
  const d=data.data||{}, apps=d.applicants||[], c=d.contact||{}, fl=d.flat||{}, pr=d.price||{}, py=d.pay||{}, pf=d.profession||{};
  const files=data.files||[];
  const fileBtns=(i)=>files.filter(f=>f.applicant===i+1&&f.kind!=='signature').map(f=>'<button class="btn" style="padding:4px 10px;margin:2px 6px 2px 0" onclick="s3OpenSigned(\''+esc(f.path)+'\')"><i class="fa-solid fa-paperclip"></i> '+(f.kind==='pan'?'PAN':'Aadhaar')+' &middot; '+esc(f.name)+'</button>').join('');
  const sig=files.filter(f=>f.kind==='signature')[0];
  const html='<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b style="font-size:16px">'+esc(data.ref_no||'')+'</b>'+pdfChip(data.status)
      +'<span style="color:var(--slate);font-size:13px">Received '+esc(pdfWhen(data.submitted_at))+(data.seen_by?' &middot; first opened by '+esc(data.seen_by)+', '+esc(pdfWhen(data.seen_at)):'')+'</span></div>'
    +apps.map((a,i)=>pdfSec(i?'Joint applicant '+(i+1):'First applicant',[
        pdfRow('Name',[a.title,a.full_name].filter(Boolean).join(' ')),pdfRow(a.relation||'S/o',a.relation_name),pdfRow('Date of birth',pdfD(a.dob)),pdfRow('Occupation',a.occupation),
        pdfRow('Nationality',a.nationality),pdfRow('PAN',(a.pan||'').toUpperCase()),pdfRow('Aadhaar',a.aadhaar),pdfRow('Passport',a.passport),pdfRow('Bank details',a.bank_details),
        pdfRow('Spouse',a.spouse),pdfRow('Anniversary',pdfD(a.anniversary)),
        '<tr><td style="padding:6px 0;color:var(--slate);vertical-align:top">Documents</td><td style="padding:6px 0">'+(fileBtns(i)||'<span style="color:var(--slate)">None attached</span>')+'</td></tr>'])).join('')
    +pdfSec('Contact & address',[pdfRow('Mobile',((c.cc||'')+' '+(c.mobile||'')).trim()),pdfRow('Email',c.email),pdfRow('Contact person',c.contact_person),pdfRow('Residential address',pdfAddr(d.res)),
        pdfRow('Office address',d.off&&d.off.on?pdfAddr(d.off):''),pdfRow('Letters to',d.mailing==='Other'?'Other: '+(d.mailing_other||''):d.mailing),pdfRow('Permanent address',d.permanent==='Other'?'Other: '+(d.permanent_other||''):d.permanent)])
    +pdfSec('About',[pdfRow('Profession',pf.kind),pdfRow('Company',pf.company),pdfRow('Designation',pf.designation),pdfRow('Gross income',pf.income),pdfRow('Community',pf.community),
        pdfRow('Heard about us from',d.heard==='Other'?d.heard_other:d.heard),pdfRow('Why this project',(d.why||[]).filter(Boolean).map((w,i)=>(i+1)+'. '+w).join('   '))])
    +pdfSec('Flat',[pdfRow('Block',fl.block),pdfRow('Floor',fl.floor),pdfRow('Flat',(fl.flat_no||'').toUpperCase()),pdfRow('Bedrooms',fl.bhk),pdfRow('Car park',fl.parking),
        pdfRow('Super built-up area',pr.sba?pr.sba+' sq.ft.':''),pdfRow('Rate per sq.ft.',[pr.basic&&'Basic '+pr.basic,pr.plc&&'PLC '+pr.plc,pr.flc&&'FLC '+pr.flc].filter(Boolean).join(' + ')),
        pdfRow('Total sale price',pr.total?'₹'+Number(pr.total).toLocaleString('en-IN'):''),pdfRow('Payment plan',pr.plan),pdfRow('Home loan',pr.loan==='Yes'?'Yes'+(pr.bank?' - '+pr.bank:''):pr.loan)])
    +pdfSec('Application payment',[pdfRow('Amount',py.amount?'₹'+Number(py.amount).toLocaleString('en-IN'):''),pdfRow('Paid by',py.mode),pdfRow('Reference',py.ref),pdfRow('Bank / branch',[py.bank,py.branch].filter(Boolean).join(', ')),
        pdfRow('Date',pdfD(py.date)),pdfRow('Purpose',d.purpose),pdfRow('Booked through',(d.sales||'')+(d.sales_name?' - '+d.sales_name:'')),pdfRow('Lead ID',d.lead_id)])
    +'<div style="margin-top:16px"><div style="font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--slate);margin-bottom:6px">Signature</div>'
      +(sig?'<button class="btn" style="padding:4px 10px" onclick="s3OpenSigned(\''+esc(sig.path)+'\')"><i class="fa-solid fa-signature"></i> Open signature</button>':'<span style="color:var(--slate)">Not found</span>')
      +'<span style="color:var(--slate);font-size:12.5px;margin-left:10px">Terms accepted: '+esc(data.terms_version||'')+'</span></div>'
    +'<div style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px"><label style="font-size:12.5px;font-weight:600;color:var(--slate)">Note (staff only)</label>'
      +'<textarea class="inp" id="pdfNote" rows="2" style="width:100%;margin-top:4px">'+esc(data.note||'')+'</textarea></div>';
  $('pdfDetail').innerHTML=html
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">'
    +['seen','used','rejected'].map(s=>'<button class="btn'+(data.status===s?' btn-primary':'')+'" onclick="pdfSetStatus(\''+id+'\',\''+s+'\')">Mark as '+PDF_ST[s][0]+'</button>').join('')
    +'<button class="btn" style="margin-left:auto" onclick="closeModal()">Close</button></div>';
  // Opening a new form marks it Seen, once, and keeps who and when.
  if(data.status==='new'){
    const me=(typeof state!=='undefined'&&state.email)||'';
    const {error:e2}=await sb.schema('acc').from('digital_booking_forms').update({status:'seen',seen_by:me,seen_at:new Date().toISOString()}).eq('id',id).eq('status','new');
    if(!e2){ const r=PDF.rows.find(x=>x.id===id); if(r){ r.status='seen'; r.seen_by=me; r.seen_at=new Date().toISOString(); } pdfDraw(); }
  }
};
window.pdfSetStatus=async function(id,s){
  const note=($('pdfNote')||{}).value||null;
  const {error}=await sb.schema('acc').from('digital_booking_forms').update({status:s,note:note}).eq('id',id);
  if(error){ toast('Could not save: '+error.message,'err'); return; }
  const r=PDF.rows.find(x=>x.id===id); if(r){ r.status=s; r.note=note; }
  toast('Marked as '+PDF_ST[s][0],'ok'); closeModal(); pdfDraw();
};


/* 11 Nov 2026: the Digital Forms tab of Post Sales was removed. Generate Form is now a button on the Booking Form workflow page
   (Accountability, flow 41, next to New Booking Form) for the Administrator and the Sales department; its window also lists the links made. */
/* GENERATE FORM (7 Nov 2026). Sales and the Administrator make a link for one customer: they fill in what the customer must
   not change (name, title, nationality, date of birth, mobile, email, contact person, block, floor, flat, flat number, car park,
   bedrooms, built-up area, total sale price) and give the customer the link. It is the same booking-form.html for everybody
   (booking-form.html?t=<token>); the customer's answers are saved on our server as they type, so reopening the link carries on
   at the same step; when they submit, the answers land in the list above like any other digital form. No booking is started.
   TEMPORARY, on the Administrator's word: only the Administrator and the Sales department see the button and the links (the
   database says the same - acc.can_generate_booking_form()). Widen it when asked. */
function pdfCanGenerate(){
  if(typeof state==='undefined'||!state||state.isCustomer||state.impersonating) return false;
  const me=String(state.email||'').trim().toLowerCase(), d=state.profile&&state.profile.department, depts=Array.isArray(d)?d:(d?[d]:[]);
  return me==='ayushruia1@gmail.com'||depts.indexOf('Sales')!==-1;
}
const PDF_LINKS={rows:[],ok:false};
const PDF_COUNTRIES=[['India','+91'],['United Arab Emirates','+971'],['United States','+1'],['United Kingdom','+44'],['Canada','+1'],['Australia','+61'],['Singapore','+65'],
  ['Saudi Arabia','+966'],['Qatar','+974'],['Kuwait','+965'],['Oman','+968'],['Bahrain','+973'],['Bangladesh','+880'],['Nepal','+977'],['Bhutan','+975'],['Germany','+49'],
  ['France','+33'],['Netherlands','+31'],['Ireland','+353'],['New Zealand','+64'],['Malaysia','+60'],['Japan','+81'],['Hong Kong','+852'],['South Africa','+27'],['Kenya','+254'],
  ['Nigeria','+234'],['Sri Lanka','+94'],['Thailand','+66'],['Italy','+39'],['Switzerland','+41']];
function pdfLinkUrl(token){ return location.origin+'/booking-form.html?t='+token; }
async function pdfLoadLinks(){
  const {data,error}=await sb.schema('acc').from('digital_booking_links')
    .select('id,token,status,prefill,customer_name,created_by,created_at,opened_at,draft_step,draft_saved_at,completed_at,form_id,ref_no')
    .order('created_at',{ascending:false}).limit(300);
  PDF_LINKS.ok=!error; PDF_LINKS.rows=error?[]:(data||[]);
}
function pdfLinkStatus(r){
  if(r.status==='completed') return '<span style="color:#15803d;font-weight:600">Submitted</span>'+(r.ref_no?' <span style="color:var(--slate)">'+esc(r.ref_no)+'</span>':'');
  if(r.status==='cancelled') return '<span style="color:var(--slate)">Cancelled</span>';
  if(!r.opened_at) return '<span style="color:var(--slate)">Not opened yet</span>';
  return '<span style="color:#92400e;font-weight:600">Filling in</span> <span style="color:var(--slate)">step '+((r.draft_step||0)+1)+' of 8'+(r.draft_saved_at?', saved '+esc(pdfWhen(r.draft_saved_at)):'')+'</span>';
}
function pdfLinksHtml(){
  const rows=PDF_LINKS.rows;
  if(!PDF_LINKS.ok) return '<div class="card" style="margin-top:18px;padding:14px 16px;color:var(--slate);font-size:13px">Generated forms are not available yet.</div>';
  return '<div class="pss-hint" style="margin:0 0 10px">Each link opens the same form for one customer, with the details you set already filled in and locked. Their answers are saved as they type.</div>'
    +'<div class="card" style="padding:0;overflow:auto">'
    +(rows.length?'<table style="width:100%;border-collapse:collapse;font-size:13.5px"><thead><tr style="text-align:left;color:var(--slate);font-size:12px;border-bottom:1px solid var(--line)">'
      +'<th style="padding:10px 14px">Customer</th><th style="padding:10px 8px">Flat</th><th style="padding:10px 8px">Made</th><th style="padding:10px 8px">Progress</th><th style="padding:10px 14px"></th></tr></thead><tbody>'
      +rows.map(r=>{ const v=(r.prefill&&r.prefill.values)||{}, f=v.flat||{};
        return '<tr style="border-bottom:1px solid var(--line)"><td style="padding:10px 14px;font-weight:600">'+esc(r.customer_name||'—')+'</td>'
          +'<td style="padding:10px 8px;white-space:nowrap">'+esc([f.block,f.floor?'Floor '+f.floor:'',f.flat_no].filter(Boolean).join(' · ')||'—')+'</td>'
          +'<td style="padding:10px 8px;white-space:nowrap">'+esc(pdfWhen(r.created_at))+'<div style="color:var(--slate);font-size:12px">'+esc(r.created_by||'')+'</div></td>'
          +'<td style="padding:10px 8px">'+pdfLinkStatus(r)+'</td>'
          +'<td style="padding:10px 14px;text-align:right;white-space:nowrap">'
          +(r.status==='open'?'<button class="btn" style="padding:4px 10px" onclick="pdfCopyLink(\''+r.token+'\',this)"><i class="fa-regular fa-copy"></i> Copy link</button>'
            :(r.form_id?'<button class="btn" style="padding:4px 10px" onclick="pdfOpen(\''+r.form_id+'\')">Open form</button>':''))
          +'</td></tr>'; }).join('')
      +'</tbody></table>'
     :'<div class="empty" style="padding:28px 20px"><i class="fa-solid fa-link"></i><div>No form has been generated yet. Press Generate Form to make the first one.</div></div>')
    +'</div>';
}
window.pdfCopyLink=async function(token,btn){
  const url=pdfLinkUrl(token);
  try{ await navigator.clipboard.writeText(url); if(btn){ const t=btn.innerHTML; btn.innerHTML='<i class="fa-solid fa-check"></i> Copied'; setTimeout(function(){ btn.innerHTML=t; },1600); } toast('Link copied','ok'); }
  catch(e){ window.prompt('Copy this link',url); }
};
/* The Generate Form window (rebuilt 11 Nov 2026 - "looks so bad and is not user friendly"): two tabs, New form and Generated forms; the
   new form is four short cards (Customer, Contact, Unit, Area & price), choices are tap buttons, the price shows commas and words,
   every mistake is shown under its own box, and when the link is ready it can be copied, opened as the customer, or another made. */
const PG_CSS='<style>'
  +'.pg{padding:0!important}'
  +'.pg-tabs{display:flex;gap:4px;padding:10px 22px 0;border-bottom:1px solid var(--line)}'
  +'.pg-tabs button{background:none;border:0;border-bottom:3px solid transparent;padding:10px 14px;font:inherit;font-size:14px;font-weight:600;color:var(--slate);cursor:pointer;margin-bottom:-1px}'
  +'.pg-tabs button.on{color:var(--ink,#111827);border-bottom-color:#1d4ed8}'
  +'.pg-tabs .pg-n{display:inline-block;min-width:20px;padding:0 6px;margin-left:6px;border-radius:999px;background:#eef0f4;color:var(--slate);font-size:12px;text-align:center}'
  +'.pg-pane{padding:18px 22px 20px;max-height:calc(100vh - 230px);overflow:auto}'
  +'.pg-intro{margin:0 0 14px;color:var(--slate);font-size:13.5px;line-height:1.5}'
  +'.pg-card{border:1px solid var(--line);border-radius:10px;padding:14px 16px 16px;margin-bottom:14px;background:#fff}'
  +'.pg-card>h4{margin:0 0 12px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--slate);font-weight:700}'
  +'.pg-g{display:grid;gap:14px 16px}.pg-g.c2{grid-template-columns:repeat(2,minmax(0,1fr))}.pg-g.c3{grid-template-columns:repeat(3,minmax(0,1fr))}'
  +'@media(max-width:700px){.pg-g.c2,.pg-g.c3{grid-template-columns:1fr}}'
  +'.pg-f label{display:block;font-size:13px;font-weight:600;color:var(--ink,#111827);margin-bottom:6px}'
  +'.pg-f label .o{font-weight:400;color:var(--slate)}.pg-f label .r{color:#b3171d}'
  +'.pg-in{width:100%;box-sizing:border-box;height:42px;padding:0 12px;border:1px solid #cfd4dc;border-radius:8px;background:#fff;font:inherit;font-size:15px;color:var(--ink,#111827)}'
  +'select.pg-in{padding-right:8px}.pg-in:focus{outline:none;border-color:#1d4ed8;box-shadow:0 0 0 3px rgba(29,78,216,.15)}'
  +'.pg-f.bad .pg-in,.pg-f.bad .pg-seg{border-color:#b3171d}'
  +'.pg-help{margin-top:5px;font-size:12.5px;color:var(--slate);min-height:0}'
  +'.pg-e{margin-top:5px;font-size:12.5px;color:#b3171d;font-weight:600}'
  +'.pg-row{display:flex;gap:8px}.pg-row .cc{width:112px;flex:none}'
  +'.pg-pre{display:flex;align-items:stretch}.pg-pre>span{display:flex;align-items:center;padding:0 12px;border:1px solid #cfd4dc;border-right:0;border-radius:8px 0 0 8px;background:#f3f4f6;color:var(--slate);font-size:15px}'
  +'.pg-pre>.pg-in{border-radius:0 8px 8px 0}.pg-suf{display:flex;align-items:stretch}.pg-suf>.pg-in{border-radius:8px 0 0 8px}'
  +'.pg-suf>span{display:flex;align-items:center;padding:0 12px;border:1px solid #cfd4dc;border-left:0;border-radius:0 8px 8px 0;background:#f3f4f6;color:var(--slate);font-size:13.5px}'
  +'.pg-seg{display:flex;flex-wrap:wrap;gap:8px;padding:0;border:0}'
  +'.pg-seg button{min-width:44px;height:42px;padding:0 14px;border:1px solid #cfd4dc;border-radius:8px;background:#fff;font:inherit;font-size:14.5px;color:var(--ink,#111827);cursor:pointer}'
  +'.pg-seg button:hover{border-color:#9aa1ab}.pg-seg button.on{background:#e8efff;border-color:#1d4ed8;color:#1d4ed8;font-weight:700}'
  +'.pg-foot{display:flex;gap:10px;justify-content:flex-end;align-items:center;padding-top:4px}'
  +'.pg-foot .msg{margin-right:auto;color:#b3171d;font-size:13.5px;font-weight:600}'
  +'.pg-done{text-align:center;padding:8px 4px 4px}.pg-done .ok{width:54px;height:54px;border-radius:50%;background:#e7f6ec;color:#15803d;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:24px}'
  +'.pg-done h3{margin:0 0 4px;font-size:18px}.pg-done p{margin:0 0 14px;color:var(--slate);font-size:13.5px}'
  +'.pg-link{display:flex;gap:8px;margin:0 auto 14px;max-width:680px}.pg-link .pg-in{font-size:13px}'
  +'.pg-acts{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}'
  +'</style>';
function pdfWords(n){
  n=Math.floor(Number(n)); if(!n||n<0) return '';
  const a=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const b=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const two=function(x){ return x<20?a[x]:b[Math.floor(x/10)]+(x%10?' '+a[x%10]:''); };
  const three=function(x){ return (x>=100?a[Math.floor(x/100)]+' Hundred'+(x%100?' ':''):'')+(x%100?two(x%100):''); };
  const out=[]; const cr=Math.floor(n/1e7); n%=1e7; const lk=Math.floor(n/1e5); n%=1e5; const th=Math.floor(n/1e3); n%=1e3;
  if(cr) out.push(three(cr)+' Crore'); if(lk) out.push(two(lk)+' Lakh'); if(th) out.push(two(th)+' Thousand'); if(n) out.push(three(n));
  return 'Rupees '+out.join(' ')+' only';
}
window.pdfGenOpen=function(){
  if(!pdfCanGenerate()) return;
  const f=(id,label,ctl,o)=>{ o=o||{}; return '<div class="pg-f" id="pgF_'+id+'"><label for="'+id+'">'+label+(o.req?' <span class="r">*</span>':'')+(o.opt?' <span class="o">(optional)</span>':'')+'</label>'+ctl
    +(o.help?'<div class="pg-help" id="pgH_'+id+'">'+o.help+'</div>':'')+'<div class="pg-e" id="pgE_'+id+'"></div></div>'; };
  const sel=(id,opts,def,cls)=>'<select class="pg-in'+(cls?' '+cls:'')+'" id="'+id+'">'+opts.map(o=>{ const v=Array.isArray(o)?o[0]:o, t=Array.isArray(o)?o[1]:o; return '<option value="'+esc(v)+'"'+(v===def?' selected':'')+'>'+esc(t)+'</option>'; }).join('')+'</select>';
  const seg=(id,opts,def)=>'<input type="hidden" id="'+id+'" value="'+esc(def)+'"><div class="pg-seg" role="radiogroup">'+opts.map(o=>'<button type="button" class="'+(o===def?'on':'')+'" onclick="pgSeg(this,\''+id+'\')">'+esc(o)+'</button>').join('')+'</div>';
  const floors=['1','2','3','4','5','6','7','8'];
  const codes=PDF_COUNTRIES.map(c=>c[1]).filter((x,i,a)=>a.indexOf(x)===i);
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-link"></i> Generate Form <span style="font-weight:400;color:var(--slate)">&middot; Dream Ananta</span></h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body pg">'+PG_CSS
    +'<div class="pg-tabs"><button class="on" id="pgT_new" onclick="pgTab(\'new\')">New form</button><button id="pgT_list" onclick="pgTab(\'list\')">Generated forms <span class="pg-n" id="pgCount">…</span></button></div>'
    +'<div class="pg-pane" id="pgNew"><div id="pgBody"><p class="pg-intro">Fill in what the customer must not change - it is shown to them but locked. They fill in the rest (PAN, Aadhaar, address, payment) themselves.</p>'
    +'<div class="pg-card"><h4>Customer</h4><div class="pg-g c3">'
      +f('pgTitle','Title',sel('pgTitle',['Mr.','Ms.','Mrs.','Mast.','M/s.'],'Mr.'))
      +'<div style="grid-column:span 2">'+f('pgName','Customer name',"<input class=\"pg-in\" id=\"pgName\" style=\"text-transform:uppercase\" autocomplete=\"off\" placeholder=\"As on the PAN card\" oninput=\"pgNameSync()\">",{req:1})+'</div>'
      +f('pgNat','Nationality',sel('pgNat',PDF_COUNTRIES.map(c=>c[0]),'India').replace('<select ','<select onchange="pgNatSync()" '))
      +f('pgDob','Date of birth','<input class="pg-in" type="date" id="pgDob">',{req:1})
    +'</div></div>'
    +'<div class="pg-card"><h4>Contact</h4><div class="pg-g c2">'
      +f('pgMobile','Mobile number','<div class="pg-row">'+sel('pgCc',codes,'+91','cc')+'<input class="pg-in" id="pgMobile" inputmode="tel" autocomplete="off" placeholder="98300 12345"></div>',{req:1})
      +f('pgEmail','Email','<input class="pg-in" type="email" id="pgEmail" autocomplete="off" placeholder="name@example.com">',{req:1})
      +f('pgContact','Contact person','<input class="pg-in" id="pgContact" style="text-transform:uppercase" autocomplete="off" oninput="this.dataset.touched=1">',{opt:1,help:'Same as the customer name unless you change it.'})
    +'</div></div>'
    +'<div class="pg-card"><h4>Unit</h4><div class="pg-g c2">'
      +f('pgBlock','Block',seg('pgBlock',['Block D','Block E'],'Block D'))
      +f('pgBhk','Bedrooms',seg('pgBhk',['2 BHK','3 BHK','4 BHK'],'3 BHK'))
      +'<div style="grid-column:1/-1">'+f('pgFloor','Floor',seg('pgFloor',floors,'1'))+'</div>'
      +f('pgFlat','Flat number','<input class="pg-in" id="pgFlat" maxlength="8" style="text-transform:uppercase" autocomplete="off" placeholder="e.g. 5A">',{opt:1,help:'Leave blank if not allotted yet - the customer will see it locked as empty.'})
      +f('pgPark','Right to use car park',seg('pgPark',['Covered','Open'],'Covered'))
    +'</div></div>'
    +'<div class="pg-card"><h4>Area &amp; price</h4><div class="pg-g c2">'
      +f('pgSba','Super built-up area','<div class="pg-suf"><input class="pg-in" id="pgSba" inputmode="decimal" autocomplete="off" placeholder="1325"><span>sq.ft.</span></div>',{req:1})
      +f('pgTotal','Total sale price','<div class="pg-pre"><span>&#8377;</span><input class="pg-in" id="pgTotal" inputmode="numeric" autocomplete="off" placeholder="72,00,000" oninput="pgMoney(this)"></div>',{req:1,help:'&nbsp;'})
    +'</div></div>'
    +'<div class="pg-foot"><span class="msg" id="pgErr"></span><button class="btn" onclick="closeModal()">Close</button><button class="btn btn-primary" id="pgGo" onclick="pdfGenerate()"><i class="fa-solid fa-link"></i> Generate link</button></div>'
    +'</div></div>'
    +'<div class="pg-pane" id="pgListWrap" style="display:none"><div id="pgList"></div></div>'
    +'</div>','lg');
  pdfGenList();
};
window.pgTab=function(t){ const n=t==='new'; $('pgNew').style.display=n?'':'none'; $('pgListWrap').style.display=n?'none':''; $('pgT_new').className=n?'on':''; $('pgT_list').className=n?'':'on'; };
window.pgSeg=function(btn,id){ btn.parentNode.querySelectorAll('button').forEach(function(x){ x.classList.remove('on'); }); btn.classList.add('on'); $(id).value=btn.textContent.trim(); };
// Contact person follows the customer's name until someone changes it by hand.
window.pgNameSync=function(){ const c=$('pgContact'); if(c&&!c.dataset.touched) c.value=($('pgName').value||''); };
window.pgNatSync=function(){ const n=PDF_COUNTRIES.filter(c=>c[0]===$('pgNat').value)[0]; if(n&&$('pgCc')) $('pgCc').value=n[1]; };
// The price as it is typed: Indian commas, and the words under it.
window.pgMoney=function(inp){ const d=inp.value.replace(/[^\d]/g,''); inp.value=d?Number(d).toLocaleString('en-IN'):''; const h=$('pgH_pgTotal'); if(h) h.textContent=pdfWords(d); else { const e=$('pgF_pgTotal'); if(e){ const x=document.createElement('div'); x.className='pg-help'; x.id='pgH_pgTotal'; x.textContent=pdfWords(d); e.insertBefore(x,$('pgE_pgTotal')); } } };
window.pdfGenerate=async function(){
  const g=id=>($(id)||{}).value||'';
  const fails=[]; const bad=(id,m)=>fails.push([id,m]);
  const name=g('pgName').trim().toUpperCase(), mobile=g('pgMobile').replace(/[^\d]/g,''), email=g('pgEmail').trim().toLowerCase(), cc=g('pgCc');
  const sba=g('pgSba').replace(/[^\d.]/g,''), total=g('pgTotal').replace(/[^\d]/g,'');
  if(!name) bad('pgName','Please write the customer name.');
  if(!g('pgDob')) bad('pgDob','Please choose the date of birth.');
  if(cc==='+91'?!/^[6-9]\d{9}$/.test(mobile):mobile.length<6) bad('pgMobile','Please write a complete mobile number'+(cc==='+91'?' (10 digits).':'.'));
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) bad('pgEmail','Please write a complete email address.');
  if(!(Number(sba)>0)) bad('pgSba','Please write the super built-up area.');
  if(!(Number(total)>0)) bad('pgTotal','Please write the total sale price.');
  ['pgName','pgDob','pgMobile','pgEmail','pgSba','pgTotal'].forEach(function(id){ const e=$('pgE_'+id), fb=$('pgF_'+id); if(e) e.textContent=''; if(fb&&fb.classList) fb.classList.remove('bad'); });
  if(fails.length){
    fails.forEach(function(x){ const e=$('pgE_'+x[0]), fb=$('pgF_'+x[0]); if(e) e.textContent=x[1]; if(fb&&fb.classList) fb.classList.add('bad'); });
    const m=$('pgErr'); if(m) m.textContent=fails.length===1?'One thing to fix':fails.length+' things to fix';
    const first=$('pgF_'+fails[0][0]); if(first&&first.scrollIntoView) first.scrollIntoView({block:'center',behavior:'smooth'});
    return;
  }
  const m0=$('pgErr'); if(m0) m0.textContent='';
  const values={applicants:[{title:g('pgTitle'),full_name:name,nationality:g('pgNat'),dob:g('pgDob')}],
    contact:{cc:cc,mobile:mobile,email:email,contact_person:(g('pgContact').trim()||name).toUpperCase()},
    flat:{block:g('pgBlock'),floor:g('pgFloor'),flat_no:g('pgFlat').trim().toUpperCase(),bhk:g('pgBhk'),parking:g('pgPark')},
    price:{sba:sba,total:total}};
  const locked=['applicants.0.title','applicants.0.full_name','applicants.0.nationality','applicants.0.dob','contact.cc','contact.mobile','contact.email','contact.contact_person',
    'flat.block','flat.floor','flat.flat_no','flat.bhk','flat.parking','price.sba','price.total'];
  const btn=$('pgGo'); btn.disabled=true; btn.textContent='Generating…';
  const {data,error}=await sb.schema('acc').rpc('generate_booking_link',{p_project:'ananta',p_prefill:{values:values,locked:locked}});
  if(error||!data){ btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-link"></i> Generate link'; const m=$('pgErr'); if(m) m.textContent='Could not generate the link: '+((error&&error.message)||'no link returned'); return; }
  const url=pdfLinkUrl(data);
  $('pgBody').innerHTML='<div class="pg-done"><div class="ok"><i class="fa-solid fa-check"></i></div><h3>The link for '+esc(name)+' is ready</h3>'
    +'<p>Give it only to this customer - anyone who has the link can open the form. Their answers are saved as they type.</p>'
    +'<div class="pg-link"><input class="pg-in" id="pgUrl" readonly value="'+esc(url)+'" onclick="this.select()"></div>'
    +'<div class="pg-acts"><button class="btn btn-primary" onclick="pdfCopyLink(\''+data+'\',this)"><i class="fa-regular fa-copy"></i> Copy link</button>'
    +'<a class="btn" href="'+esc(url)+'" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open as the customer</a>'
    +'<button class="btn" onclick="pdfGenOpen()"><i class="fa-solid fa-plus"></i> Generate another</button></div></div>';
  await pdfGenList();
};
window.pdfGenList=async function(){ await pdfLoadLinks(); const h=$('pgList'); if(h) h.innerHTML=pdfLinksHtml(); const c=$('pgCount'); if(c) c.textContent=PDF_LINKS.ok?PDF_LINKS.rows.length:'-'; };
window.pdfCanGenerate=pdfCanGenerate;
