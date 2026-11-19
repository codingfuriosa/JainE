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
const PD_CSS='<style>'
  +'#pdPage{position:fixed;inset:0;z-index:2100;background:#f4f5f7;display:flex;flex-direction:column}'
  +'#pdPage .pd-top{display:flex;align-items:center;gap:14px;padding:10px 22px;background:#fff;border-bottom:1px solid var(--line)}'
  +'#pdPage .pd-top h2{margin:0;font-size:18px}'
  +'#pdPage .pd-main{flex:1;overflow:auto;padding:16px 22px 24px}'
  +'#pdPage .pd-in{max-width:1180px;margin:0 auto;background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px 20px 20px}'
  +'#pdPage .pd-cols{column-count:2;column-gap:40px}@media(max-width:1000px){#pdPage .pd-cols{column-count:1}}'
  +'#pdPage .pd-cols>div{break-inside:avoid}'
  +'</style>';
window.pdClose=function(){ const p=document.getElementById('pdPage'); if(p) p.remove(); };
window.pdfOpen=async function(id){
  const old=document.getElementById('pdPage'); if(old) old.remove();
  const page=document.createElement('div'); page.id='pdPage';
  page.innerHTML=PD_CSS+'<div class="pd-top"><button class="btn" onclick="pdClose()"><i class="fa-solid fa-arrow-left"></i> Back</button><h2><i class="fa-regular fa-file-lines"></i> Digital Booking Form</h2></div>'
    +'<div class="pd-main"><div class="pd-in"><div id="pdfDetail"></div></div></div>';
  document.body.appendChild(page); pgFit(page);
  loader($('pdfDetail'));
  const {data,error}=await sb.schema('acc').from('digital_booking_forms').select('*').eq('id',id).maybeSingle();
  if(error||!data){ $('pdfDetail').innerHTML='<div class="empty"><div>Could not load this form'+(error?': '+esc(error.message):'')+'.</div></div>'; return; }
  const d=data.data||{}, apps=d.applicants||[], c=d.contact||{}, fl=d.flat||{}, pr=d.price||{}, py=d.pay||{}, pf=d.profession||{};
  const files=data.files||[];
  const fileBtns=(i)=>files.filter(f=>f.applicant===i+1&&f.kind!=='signature').map(f=>'<button class="btn" style="padding:4px 10px;margin:2px 6px 2px 0" onclick="s3OpenSigned(\''+esc(f.path)+'\')"><i class="fa-solid fa-paperclip"></i> '+({pan:'PAN',aadhaar:'Aadhaar',passport:'Passport',photo:'Photograph',payment:'Payment proof'}[f.kind]||f.kind)+' &middot; '+esc(f.name)+'</button>').join('');
  const sig=files.filter(f=>f.kind==='signature')[0];
  const html='<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b style="font-size:16px">'+esc(data.ref_no||'')+'</b>'+pdfChip(data.status)
      +'<span style="color:var(--slate);font-size:13px">Received '+esc(pdfWhen(data.submitted_at))+(data.seen_by?' &middot; first opened by '+esc(data.seen_by)+', '+esc(pdfWhen(data.seen_at)):'')+'</span></div>'
    +apps.map((a,i)=>pdfSec(i?'Joint applicant '+(i+1):'First applicant',[
        pdfRow('Name',[a.title,a.full_name].filter(Boolean).join(' ')),pdfRow(a.relation||'S/o',a.relation_name),pdfRow('Date of birth',pdfD(a.dob)),pdfRow('Occupation',a.occupation),
        pdfRow('Nationality',a.nationality),pdfRow('PAN',(a.pan||'').toUpperCase()),pdfRow('Aadhaar',a.aadhaar),pdfRow('Passport',a.passport),pdfRow('Bank details',a.bank_details),
        pdfRow('Spouse',a.spouse),pdfRow('Anniversary',pdfD(a.anniversary)),
        '<tr><td style="padding:6px 0;color:var(--slate);vertical-align:top">Documents</td><td style="padding:6px 0">'+(fileBtns(i)||'<span style="color:var(--slate)">None attached</span>')+'</td></tr>'])).join('')
    +pdfSec('Contact & address',[pdfRow('Mobile',((c.cc||'')+' '+(c.mobile||'')).trim()),pdfRow('Email',c.email),pdfRow('Primary contact person',c.contact_person),pdfRow('Residential address',pdfAddr(d.res)),
        pdfRow('Office address',d.off&&d.off.on?pdfAddr(d.off):''),pdfRow('Letters to',d.mailing==='Other'?'Other: '+(d.mailing_other||''):d.mailing),pdfRow('Permanent address',d.permanent==='Other'?'Other: '+(d.permanent_other||''):d.permanent)])
    +pdfSec('About',[pdfRow('Profession',pf.kind),pdfRow('Company',pf.company),pdfRow('Designation',pf.designation),pdfRow('Gross income',pf.income),pdfRow('Community',pf.community),
        pdfRow('Heard about us from',d.heard==='Other'?d.heard_other:d.heard),pdfRow('Why this project',(d.why||[]).filter(Boolean).map((w,i)=>(i+1)+'. '+w).join('   '))])
    +pdfSec('Flat',[pdfRow('Block',fl.block),pdfRow('Floor',fl.floor),pdfRow('Flat',(fl.flat_no||'').toUpperCase()),pdfRow('Bedrooms',fl.bhk),pdfRow('Car park',(Array.isArray(fl.parkings)&&fl.parkings.length?fl.parkings:[fl.parking]).filter(Boolean).join(', ')),
        pdfRow('Super built-up area',pr.sba?pr.sba+' sq.ft.':''),pdfRow('Rate per sq.ft.',[pr.basic&&'Basic '+pr.basic,pr.plc&&'PLC '+pr.plc,pr.flc&&'FLC '+pr.flc].filter(Boolean).join(' + ')),
        pdfRow('Total sale price',pr.total?'₹'+Number(pr.total).toLocaleString('en-IN'):''),pdfRow('Booking price',pr.booking?'₹'+Number(pr.booking).toLocaleString('en-IN'):''),pdfRow('Home loan',pr.loan==='Yes'?'Yes'+(pr.bank?' - '+pr.bank:''):pr.loan)])
    +pdfSec('Booking amount',[pdfRow('Booking amount',py.amount?'₹'+Number(py.amount).toLocaleString('en-IN'):''),pdfRow('Paid by',py.mode),pdfRow('Reference',py.ref),pdfRow('Bank / branch',[py.bank,py.branch].filter(Boolean).join(', ')),
        pdfRow('Date',pdfD(py.date)),pdfRow('Purpose',d.purpose),pdfRow('Booked through',(d.sales||'')+(d.sales_name?' - '+d.sales_name:'')),pdfRow('Lead ID',d.lead_id)])
    +'<div style="margin-top:16px"><div style="font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--slate);margin-bottom:6px">Signature</div>'
      +(sig?'<button class="btn" style="padding:4px 10px" onclick="s3OpenSigned(\''+esc(sig.path)+'\')"><i class="fa-solid fa-signature"></i> Open signature</button>':'<span style="color:var(--slate)">Not found</span>')
      +'<span style="color:var(--slate);font-size:12.5px;margin-left:10px">Terms accepted: '+esc(data.terms_version||'')+'</span></div>'
    +'<div style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px"><label style="font-size:12.5px;font-weight:600;color:var(--slate)">Note (staff only)</label>'
      +'<textarea class="inp" id="pdfNote" rows="2" style="width:100%;margin-top:4px">'+esc(data.note||'')+'</textarea></div>';
  $('pdfDetail').innerHTML='<div class="pd-cols">'+html+'</div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">'
    +['seen','used','rejected'].map(s=>'<button class="btn'+(data.status===s?' btn-primary':'')+'" onclick="pdfSetStatus(\''+id+'\',\''+s+'\')">Mark as '+PDF_ST[s][0]+'</button>').join('')
    +'<button class="btn" style="margin-left:auto" onclick="pdClose()">Back</button></div>';
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
  toast('Marked as '+PDF_ST[s][0],'ok'); pdClose(); pdfDraw(); if(typeof pdfGenList==='function'&&document.getElementById('pgList')) pdfGenList();
};


/* 11 Nov 2026: the Digital Forms tab of Post Sales was removed. Generate Form is now a button on the Booking Form workflow page
   (Accountability, flow 41, next to New Booking Form) for the Administrator and the Sales department; its window also lists the links made. */
/* GENERATE FORM (7 Nov 2026). Sales and the Administrator make a link for one customer: they fill in what is pre-filled for the customer (since 13 Nov 2026 the customer can change it:
   name, title, nationality, date of birth, mobile, email, contact person, block, floor, flat, flat number, car park,
   bedrooms, built-up area, total sale price) and give the customer the link. It is the same booking-form.html for everybody
   (booking-form.html?t=<token>); the customer's answers are saved on our server as they type, so reopening the link carries on
   at the same step; when they submit, the answers land in the list above like any other digital form. No booking is started.
   TEMPORARY, on the Administrator's word (since 13 Nov 2026 ONLY the Administrator - Sales is switched off for now; before that the Sales department too): only the Administrator sees the button and the links (the
   database says the same - acc.can_generate_booking_form()). Widen it when asked. */
function pdfCanGenerate(){
  if(typeof state==='undefined'||!state||state.isCustomer||state.impersonating) return false;
  const me=String(state.email||'').trim().toLowerCase(), d=state.profile&&state.profile.department, depts=Array.isArray(d)?d:(d?[d]:[]);
  // 13 Nov 2026, on the Administrator's word: Sales is switched off for now. To give Sales back, change this line to
  //   return me==='ayushruia1@gmail.com'||depts.indexOf('Sales')!==-1;   (and see supabase/functions/booking-form-public staffUser + acc.can_generate_booking_form)
  return me==='ayushruia1@gmail.com';
}
const PDF_LINKS={rows:[],ok:false};
const PDF_COUNTRIES=[['India','+91'],['United Arab Emirates','+971'],['United States','+1'],['United Kingdom','+44'],['Canada','+1'],['Australia','+61'],['Singapore','+65'],
  ['Saudi Arabia','+966'],['Qatar','+974'],['Kuwait','+965'],['Oman','+968'],['Bahrain','+973'],['Bangladesh','+880'],['Nepal','+977'],['Bhutan','+975'],['Germany','+49'],
  ['France','+33'],['Netherlands','+31'],['Ireland','+353'],['New Zealand','+64'],['Malaysia','+60'],['Japan','+81'],['Hong Kong','+852'],['South Africa','+27'],['Kenya','+254'],
  ['Nigeria','+234'],['Sri Lanka','+94'],['Thailand','+66'],['Italy','+39'],['Switzerland','+41']];
function pdfLinkUrl(token){ return location.origin+'/booking-form.html?t='+token; }
async function pdfLoadLinks(){
  const {data,error}=await sb.schema('acc').from('digital_booking_links')
    .select('id,token,status,project,prefill,customer_name,created_by,created_at,opened_at,draft_step,draft_saved_at,completed_at,form_id,ref_no')
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
  return '<div class="pss-hint" style="margin:0 0 10px">Each link opens the same form for one customer, with the details you set already filled in (the customer can change them). Their answers are saved as they type.</div>'
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
/* GENERATE FORM AS A PAGE (11 Nov 2026: "not a popup, a page would be better ... very easy for Sales ... optimize space"). It fills the screen
   over the Booking Form workflow (Back returns to it): on a computer the form is on the left in a two-column layout, and the links made so far are
   on the right - copy one again, see how far the customer got, or EDIT it (an open link's details can be changed; the customer sees the new ones
   the next time the form loads, what they already typed stays). On a phone the list sits under the form. Four short cards, tap buttons for choices,
   a price with commas and words, every mistake under its own box, and a link-ready screen with Copy / Open as the customer / Generate another. */
const PG_CSS='<style>'
  +'#pgPage{--pgl:#e7e9ee;--pgm:#6b7280;--pgi:#1f2937;position:fixed;inset:0;z-index:2000;background:#f6f7f9;display:flex;flex-direction:column;font-family:inherit;color:var(--pgi)}'
  +'#pgPage .pg-top{display:flex;align-items:center;gap:14px;padding:10px 24px;background:#fff}'
  +'#pgPage .pg-top h2{margin:0;font-size:18px;font-weight:700}#pgPage .pg-top h2 span{font-weight:400;color:var(--pgm)}'
  +'#pgPage .pg-tabs{display:flex;gap:2px;padding:0 24px;background:#fff;border-bottom:1px solid var(--pgl)}'
  +'#pgPage .pg-tabs button{background:none;border:0;border-bottom:2px solid transparent;padding:10px 16px;font:inherit;font-size:13.5px;font-weight:600;color:var(--pgm);cursor:pointer;margin-bottom:-1px}'
  +'#pgPage .pg-tabs button:hover{color:var(--pgi)}#pgPage .pg-tabs button.on{color:#1d4ed8;border-bottom-color:#1d4ed8}'
  +'#pgPage .pg-tabs .pg-n{display:inline-block;min-width:20px;padding:0 6px;margin-left:6px;border-radius:999px;background:#eef0f4;color:var(--pgm);font-size:12px;font-weight:600;text-align:center}'
  +'#pgPage .pg-main{flex:1;overflow:auto;padding:18px 24px 22px}'
  +'.pg-edit{margin:0 0 12px;padding:9px 14px;border-radius:8px;background:#fff8e8;border:1px solid #f3e1b5;color:#8a5a0b;font-size:13px}'
  +'.pg-wrap{max-width:1180px}'
  +'.pg-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:stretch}'
  +'@media(max-width:1100px){.pg-cards{grid-template-columns:minmax(0,1fr)}}'
  +'.pg-card{background:#fff;border:1px solid var(--pgl);border-radius:12px;box-shadow:0 1px 2px rgba(16,24,40,.04);padding:16px 20px 20px}'
  +'.pg-card>h4{margin:0 0 12px;font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:#9aa1ad;font-weight:700}'
  +'.pg-bf{display:grid;gap:12px 18px;grid-template-columns:var(--c);align-items:start}.pg-bf+.pg-bf{margin-top:14px}'
  +'@media(max-width:640px){.pg-bf{grid-template-columns:1fr}.pg-card{padding:14px 16px 16px}}'
  +'.pg-f label{display:block;font-size:12.5px;font-weight:500;color:#4b5563;margin-bottom:5px}'
  +'.pg-f label .o{font-weight:400;color:#9aa1ad}.pg-f label .r{color:#d9534f;font-weight:600}'
  +'.pg-in{width:100%;box-sizing:border-box;height:40px;padding:0 12px;border:1px solid #d7dbe2;border-radius:8px;background:#fff;font:inherit;font-size:14px;color:var(--pgi);transition:border-color .12s,box-shadow .12s}'
  +'.pg-in:hover{border-color:#bfc5ce}select.pg-in{padding-right:6px}.pg-in::placeholder{color:#a3a9b5}'
  +'.pg-in:focus{outline:none;border-color:#3b6fe0;box-shadow:0 0 0 3px rgba(59,111,224,.14)}'
  +'.pg-f.bad .pg-in,.pg-f.bad .pg-seg{border-color:#d9534f}'
  +'.pg-help{margin-top:4px;font-size:12px;color:var(--pgm)}.pg-e{margin-top:4px;font-size:12px;color:#d9534f;font-weight:600}.pg-e:empty{display:none}'
  +'.pg-row{display:flex;gap:8px}.pg-row .cc{width:96px;flex:none}'
  +'.pg-pre{display:flex}.pg-pre>span{display:flex;align-items:center;padding:0 12px;border:1px solid #d7dbe2;border-right:0;border-radius:8px 0 0 8px;background:#f6f7f9;color:var(--pgm)}.pg-pre>.pg-in{border-radius:0 8px 8px 0}'
  +'.pg-suf{display:flex}.pg-suf>.pg-in{border-radius:8px 0 0 8px}.pg-suf>span{display:flex;align-items:center;padding:0 12px;border:1px solid #d7dbe2;border-left:0;border-radius:0 8px 8px 0;background:#f6f7f9;color:var(--pgm);font-size:12.5px}'
  +'.pg-seg{display:inline-flex;gap:2px;padding:3px;border:1px solid transparent;border-radius:10px;background:#eff1f4}'
  +'.pg-seg button{min-width:38px;height:34px;padding:0 13px;border:0;border-radius:8px;background:transparent;font:inherit;font-size:13.5px;color:#4b5563;cursor:pointer;white-space:nowrap}'
  +'.pg-seg button:hover{color:var(--pgi);background:rgba(255,255,255,.6)}'
  +'.pg-seg button.on{background:#fff;color:#1d4ed8;font-weight:700;box-shadow:0 1px 3px rgba(16,24,40,.14)}'
  +'.pg-bar{display:flex;gap:10px;justify-content:flex-end;align-items:center;margin-top:16px}'
  +'.pg-bar .msg{margin-right:auto;font-size:13px}'
  +'.pg-done{margin:auto;background:#fff;border:1px solid var(--pgl);border-radius:12px;text-align:center;padding:26px 20px;max-width:760px}.pg-done .ok{width:50px;height:50px;border-radius:50%;background:#e7f6ec;color:#15803d;display:flex;align-items:center;justify-content:center;margin:0 auto 10px;font-size:22px}'
  +'.pg-done h3{margin:0 0 4px;font-size:18px}.pg-done p{margin:0 0 12px;color:var(--pgm);font-size:13.5px}.pg-link{max-width:680px;margin:0 auto 12px}'
  +'.pg-acts{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}'
  +'.pg-t{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--pgl);border-radius:12px;overflow:hidden;font-size:14px}'
  +'.pg-t th{text-align:left;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:#9aa1ad;font-weight:700;padding:11px 16px;background:#fafbfc;border-bottom:1px solid var(--pgl)}'
  +'.pg-t td{padding:12px 16px;border-bottom:1px solid var(--pgl);vertical-align:middle}.pg-t tr:last-child td{border-bottom:0}.pg-t tbody tr:hover{background:#fafbfc}'
  +'.pg-t td.a{text-align:right;white-space:nowrap}.pg-t td.a .btn{padding:4px 10px;margin-left:6px}.pg-t .sub{color:var(--pgm);font-size:12.5px}'
  +'.pg-empty{padding:36px 16px;text-align:center;color:var(--pgm);background:#fff;border:1px solid var(--pgl);border-radius:12px}'
  +'.pg-card .pg-seg button{min-width:34px;padding:0 11px}'
  +'@media(max-height:820px){.pg-cards{gap:12px}.pg-card{padding:12px 18px 15px}.pg-card>h4{margin-bottom:8px}.pg-in{height:38px}.pg-seg button{height:32px}.pg-bar{margin-top:12px}.pg-main{padding-top:12px!important}}'
  +'@media(min-height:880px){.pg-in{height:44px;font-size:15px}.pg-seg button{height:38px}.pg-card{padding:20px 24px 24px}.pg-f label{font-size:13px}.pg-bf{gap:14px 20px}.pg-cards{gap:20px}}'
  +'.pg-seg{flex-wrap:wrap;max-width:100%}'
  +'.pg-card.pg-slim{display:flex;align-items:center;gap:16px;padding:8px 20px}'
  +'.pg-card.pg-slim>label{display:block;margin:0;white-space:nowrap;width:130px;flex:none;font-size:12.5px;font-weight:500;color:#4b5563}'
  +'.pg-slim .ctl{flex:0 1 420px;min-width:0}.pg-slim .ctl.w{flex:0 1 700px}.pg-slim .pg-e{margin:0;flex:1 1 auto}'
  +'.pg-wrap>.pg-slim:first-child{margin-bottom:16px}.pg-cards+.pg-slim{margin-top:16px}'
  +'.pg-cost{display:flex;align-items:center;gap:10px;min-height:40px;min-width:0}.pg-cost .nm{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}'
  +'.pg-cost .sz{color:var(--pgm);font-size:13px;white-space:nowrap}.pg-cost .btn{flex:none}.pg-cost .pdf{color:#d9534f}.pg-cost .up{color:var(--pgm);font-size:13.5px}'
  +'@media(max-width:640px){.pg-card.pg-slim{flex-wrap:wrap;gap:6px}.pg-card.pg-slim>label{width:auto}.pg-slim .ctl,.pg-slim .ctl.w{flex:1 1 100%}}'
  +'@media(max-height:820px){.pg-wrap>.pg-slim:first-child{margin-bottom:12px}.pg-cards+.pg-slim{margin-top:12px}.pg-card.pg-slim{padding:6px 18px}.pg-cost{min-height:38px}}'
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
/* The Generate Form page fills the content area only - the menu on the left and the top bar of JainE stay where they are. It follows the window size,
   and goes away when another menu item is chosen. */
function pgFit(el){ const v=document.getElementById('view'); if(!v||!el||!el.style) return; const r=v.getBoundingClientRect(), t=document.querySelector('.topbar'), tb=t?t.getBoundingClientRect().bottom:Math.max(0,r.top);
  el.style.top=Math.max(0,tb)+'px'; el.style.left=Math.max(0,r.left)+'px'; el.style.right='0px'; el.style.bottom='0px'; el.style.zIndex=50; }
window.addEventListener('resize',function(){ pgFit(document.getElementById('pgPage')); pgFit(document.getElementById('pdPage')); });
window.addEventListener('hashchange',function(){ if(typeof pgClose==='function') pgClose(); if(typeof pdClose==='function') pdClose(); });
const PG={editId:null,editToken:null,draftId:null,project:null,projReady:false,cost:null,uploading:false,openSeq:0};
const PG_DRAFTS={rows:[],ok:false};
/* PROJECTS and COST SHEET (13 Nov 2026). Sales picks the project (the list comes from the public edge function, fetched once and kept) and attaches the
   cost sheet PDF (compulsory; uploaded at once through the same function, the answer {path,name,size} is kept in PG.cost and travels in the prefill as cost_sheet). */
const PG_FN='https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/booking-form-public';
const PG_PROJ={list:null};
function pgProjName(key){ const p=(PG_PROJ.list||[]).filter(x=>x.key===key)[0]; return p?p.name:(key||'—'); }
function pgSegH(id,opts,def){ return '<input type="hidden" id="'+id+'" value="'+esc(def)+'"><div class="pg-seg" role="radiogroup">'+opts.map(o=>'<button type="button" class="'+(o===def?'on':'')+'" onclick="pgSeg(this,\''+id+'\')">'+esc(o)+'</button>').join('')+'</div>'; }
function pgSize(n){ n=Number(n)||0; return n<1024?n+' B':(n<1048576?Math.round(n/1024)+' KB':(n/1048576).toFixed(1)+' MB'); }
async function pgFetchProjects(){
  const r=await fetch(PG_FN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'projects'})});
  const j=await r.json().catch(function(){ return null; });
  if(!r.ok||!j||!j.ok||!Array.isArray(j.projects)||!j.projects.length) throw new Error((j&&j.error)||'no projects came back');
  return j.projects;
}
// The Generate button waits while the project list loads or a cost sheet is uploading.
function pgSyncGo(){ const b=$('pgGo'); if(b) b.disabled=!PG.projReady||PG.uploading; }
// A project was chosen: its blocks, floors and bedroom choices replace the old ones, and the choices go back to the first / default.
function pgProjApply(p){
  PG.project=p; if(!p) return;
  const nm=$('pgProjName'); if(nm) nm.textContent='· '+p.name;
  const blocks=Array.isArray(p.blocks)?p.blocks.map(String):[], bhk=Array.isArray(p.bhk)?p.bhk.map(String):[];
  const nf=Math.max(1,Math.floor(Number(p.floors))||8), bd=bhk.indexOf(p.bhkDefault)>=0?p.bhkDefault:(bhk[0]||'');
  const b=$('pgC_pgBlock'); if(b) b.innerHTML=pgSegH('pgBlock',blocks,blocks[0]||'');
  const h=$('pgC_pgBhk'); if(h) h.innerHTML=pgSegH('pgBhk',bhk,bd);
  const fl=$('pgC_pgFloor');
  if(fl){
    const fs=[]; for(let i=1;i<=nf;i++) fs.push(String(i));
    fl.innerHTML=nf>12?'<select class="pg-in" id="pgFloor" style="min-width:96px">'+fs.map(x=>'<option value="'+x+'">'+x+'</option>').join('')+'</select>':pgSegH('pgFloor',fs,'1');
  }
}
window.pgProjChange=function(){ const k=($('pgProject')||{}).value, p=(PG_PROJ.list||[]).filter(x=>x.key===k)[0]; if(p) pgProjApply(p); };
async function pgProjInit(editRow){
  const seq=PG.openSeq, sel=$('pgProject');
  if(!sel) return;
  if(!PG_PROJ.list){
    try{ PG_PROJ.list=await pgFetchProjects(); }
    catch(e){
      if(seq!==PG.openSeq||!$('pgProject')) return;
      sel.innerHTML='<option value="">Projects not available</option>'; sel.disabled=true;
      const er=$('pgE_pgProject'); if(er) er.textContent='Could not load the projects ('+((e&&e.message)||'error')+'). Close this page and open it again.';
      const fb=$('pgF_pgProject'); if(fb) fb.classList.add('bad');
      return;
    }
  }
  if(seq!==PG.openSeq||!$('pgProject')) return;
  const list=PG_PROJ.list;
  let key=editRow?(editRow.project||'ananta'):(list.some(x=>x.key==='ananta')?'ananta':list[0].key);
  let p=list.filter(x=>x.key===key)[0];
  let opts=list.map(x=>'<option value="'+esc(x.key)+'">'+esc(x.name)+'</option>').join('');
  if(!p){   // an old link whose project is no longer in the list: its own flat details keep the page usable
    const fl=(editRow&&editRow.prefill&&editRow.prefill.values&&editRow.prefill.values.flat)||{};
    p={key:key,name:key,blocks:[fl.block].filter(Boolean),floors:Math.max(8,Number(fl.floor)||0),bhk:[fl.bhk].filter(Boolean),bhkDefault:fl.bhk};
    opts+='<option value="'+esc(key)+'">'+esc(key)+'</option>';
  }
  sel.innerHTML=opts; sel.value=key; sel.disabled=!!editRow;   // editing: the project is fixed
  const fb=$('pgF_pgProject'); if(fb) fb.classList.remove('bad'); const er=$('pgE_pgProject'); if(er) er.textContent='';
  pgProjApply(p);
  PG.projReady=true; pgSyncGo();
  const l=$('pgList'); if(l&&PDF_LINKS.ok) l.innerHTML=pdfGenListHtml();
  if(editRow) pgFill(editRow);
}
// The cost sheet row: Choose PDF, or the file name and size with Replace, or Uploading.
function pgCostDraw(){
  const h=$('pgCostBox'); if(!h) return;
  if(PG.uploading){ h.innerHTML='<span class="up"><i class="fa-solid fa-spinner fa-spin"></i> Uploading...</span>'; return; }
  const c=PG.cost;
  h.innerHTML=(c&&c.path)?'<i class="fa-regular '+(/^image\//.test(c.type||'')?'fa-file-image':'fa-file-pdf')+' pdf"></i><span class="nm" title="'+esc(c.name||'')+'">'+esc(c.name||'Cost sheet.pdf')+'</span><span class="sz">&middot; '+esc(pgSize(c.size))+'</span><button type="button" class="btn" style="padding:4px 12px" onclick="pgCostChoose()">Replace</button>'
    :'<button type="button" class="btn" onclick="pgCostChoose()"><i class="fa-solid fa-file-arrow-up"></i> Choose file</button><span class="sz">PDF or picture (JPG, PNG), up to 10 MB</span>';
}
/* CAR PARKS (19 Nov 2026, Ayush: "maybe customer is taking more than 1 ... one more option along with Covered and Open, NA"). PG.parks is the list, one entry per car
   park, each Covered or Open; the first can be NA (no car park), which leaves just that. */
function pgParkDraw(){
  const h=$('pgParkBox'); if(!h) return;
  const P=PG.parks&&PG.parks.length?PG.parks:['Covered'];
  h.innerHTML=P.map(function(v,i){
    const opts=i?['Covered','Open']:['Covered','Open','NA'];
    return '<div style="display:flex;align-items:center;gap:8px;margin:0 0 6px"><span style="min-width:20px;font-size:12px;color:var(--slate);font-weight:600">'+(P[0]==='NA'?'':(i+1)+'.')+'</span><div class="pg-seg" role="radiogroup">'
      +opts.map(function(o){ return '<button type="button" class="'+(o===v?'on':'')+'" onclick="pgParkSet('+i+',\''+o+'\')">'+o+'</button>'; }).join('')+'</div>'
      +(i?'<button type="button" class="btn" style="padding:2px 9px" title="Remove this car park" onclick="pgParkRm('+i+')">&times;</button>':'')+'</div>'; }).join('')
    +(P[0]!=='NA'&&P.length<6?'<button type="button" class="btn" style="padding:4px 12px;margin-top:2px" onclick="pgParkAdd()"><i class="fa-solid fa-plus"></i> Add another car park</button>':'');
}
window.pgParkSet=function(i,o){ PG.parks=(PG.parks&&PG.parks.length?PG.parks:['Covered']).slice(); PG.parks[i]=o; if(i===0&&o==='NA') PG.parks=['NA']; pgParkDraw(); };
window.pgParkAdd=function(){ PG.parks=(PG.parks||['Covered']).concat(['Covered']); pgParkDraw(); };
window.pgParkRm=function(i){ PG.parks.splice(i,1); pgParkDraw(); };
function pgCostMsg(m){ const e=$('pgE_pgCost'), fb=$('pgF_pgCost'); if(e) e.textContent=m||''; if(fb&&fb.classList) fb.classList.toggle('bad',!!m); }
window.pgCostChoose=function(){ const i=$('pgCostFile'); if(i&&!PG.uploading) i.click(); };
window.pgCostPick=async function(inp){
  const file=inp.files&&inp.files[0]; inp.value='';
  if(!file) return;
  pgCostMsg('');
  if(!(file.type==='application/pdf'||/^image\/(jpeg|png|webp)$/.test(file.type)||/\.(pdf|jpe?g|png|webp)$/i.test(file.name))){ pgCostMsg('The cost sheet must be a PDF or a picture (JPG, PNG).'); return; }
  if(file.size>10*1048576){ pgCostMsg('This file is '+pgSize(file.size)+'. The cost sheet can be 10 MB at most.'); return; }
  if(!file.size){ pgCostMsg('This file is empty. Please choose the cost sheet.'); return; }
  const seq=PG.openSeq;
  PG.uploading=true; pgCostDraw(); pgSyncGo();
  let cost=null, msg='';
  try{
    const ss=await sb.auth.getSession(), tok=ss&&ss.data&&ss.data.session&&ss.data.session.access_token;
    if(!tok) throw new Error('please sign in again');
    const fd=new FormData(); fd.append('action','staff_cost_upload'); fd.append('file',file,file.name);
    const r=await fetch(PG_FN,{method:'POST',headers:{Authorization:'Bearer '+tok},body:fd});
    const j=await r.json().catch(function(){ return null; });
    if(!r.ok||!j||!j.ok||!j.cost||!j.cost.path) throw new Error((j&&j.error)||'the upload did not go through');
    cost=j.cost;
  }catch(e){ msg='Could not upload the cost sheet: '+((e&&e.message)||'error'); }
  if(seq!==PG.openSeq) return;   // the page was reopened meanwhile
  PG.uploading=false; if(cost) PG.cost=cost;
  pgCostDraw(); pgSyncGo(); pgCostMsg(msg);
};
window.pdfGenOpen=function(editRow){
  if(!pdfCanGenerate()) return;
  PG.editId=editRow&&editRow.id||null; PG.editToken=editRow&&editRow.token||null; PG.draftId=null;
  PG.project=null; PG.projReady=false; PG.cost=null; PG.uploading=false; PG.openSeq++; PG.parks=['Covered'];
  const old=document.getElementById('pgPage'); if(old) old.remove();
  const f=(id,label,ctl,o)=>{ o=o||{}; return '<div class="pg-f" id="pgF_'+id+'"><label for="'+id+'">'+label+(o.req?' <span class="r">*</span>':'')+(o.opt?' <span class="o">(optional)</span>':'')+'</label>'+ctl
    +(o.help?'<div class="pg-help" id="pgH_'+id+'">'+o.help+'</div>':'')+'<div class="pg-e" id="pgE_'+id+'"></div></div>'; };
  const sel=(id,opts,def,cls)=>'<select class="pg-in'+(cls?' '+cls:'')+'" id="'+id+'">'+opts.map(o=>{ const v=Array.isArray(o)?o[0]:o, t=Array.isArray(o)?o[1]:o; return '<option value="'+esc(v)+'"'+(v===def?' selected':'')+'>'+esc(t)+'</option>'; }).join('')+'</select>';
  const seg=pgSegH;   // Block, Floor and Bedrooms are put in by pgProjApply once the project list is here
  const codes=PDF_COUNTRIES.map(c=>c[1]).filter((x,i,a)=>a.indexOf(x)===i);
  const page=document.createElement('div'); page.id='pgPage';
  page.innerHTML=PG_CSS
    +'<div class="pg-top"><button class="btn" onclick="pgClose()"><i class="fa-solid fa-arrow-left"></i> Back</button><h2><i class="fa-solid fa-link"></i> Generate Form <span id="pgProjName"></span></h2></div>'
    +'<div class="pg-tabs"><button class="on" id="pgT_new" onclick="pgTab(\'new\')">NEW</button><button id="pgT_drafts" onclick="pgTab(\'drafts\')">DRAFTS <span class="pg-n" id="pgDCount">…</span></button><button id="pgT_list" onclick="pgTab(\'list\')">Generated forms <span class="pg-n" id="pgCount">…</span></button></div>'
    +'<div class="pg-main" id="pgNew"><div id="pgBody"><div id="pgEditNote"></div>'
    +'<div class="pg-wrap">'
    +'<div class="pg-card pg-slim pg-f" id="pgF_pgProject"><label for="pgProject">Project <span class="r">*</span></label><div class="ctl"><select class="pg-in" id="pgProject" onchange="pgProjChange()" disabled><option value="">Loading projects...</option></select></div><div class="pg-e" id="pgE_pgProject"></div></div>'
    +'<div class="pg-cards">'
    +'<div class="pg-card"><h4>Customer</h4><div class="pg-bf" style="--c:100px minmax(0,1fr)">'
      +f('pgTitle','Title',sel('pgTitle',['Mr.','Ms.','Mrs.','Mast.','M/s.'],'Mr.'))
      +f('pgName','Customer name','<input class="pg-in" id="pgName" style="text-transform:uppercase" autocomplete="off" placeholder="As on the PAN card" oninput="pgNameSync()">',{req:1})
    +'</div><div class="pg-bf" style="--c:minmax(0,1fr) minmax(0,1fr)">'
      +f('pgNat','Nationality',sel('pgNat',PDF_COUNTRIES.map(c=>c[0]),'India').replace('<select ','<select onchange="pgNatSync()" '))
      +f('pgDob','Date of birth','<input class="pg-in" type="date" id="pgDob">',{opt:1})
    +'</div></div>'
    +'<div class="pg-card"><h4>Contact</h4><div class="pg-bf" style="--c:minmax(0,1fr) minmax(0,1fr)">'
      +f('pgMobile','Mobile number','<div class="pg-row">'+sel('pgCc',codes,'+91','cc')+'<input class="pg-in" id="pgMobile" inputmode="tel" autocomplete="off" placeholder="98300 12345"></div>',{req:1})
      +f('pgEmail','Email','<input class="pg-in" type="email" id="pgEmail" autocomplete="off" placeholder="name@example.com">',{req:1})
    +'</div><div class="pg-bf" style="--c:minmax(0,1fr)">'
      +f('pgContact','Primary contact person','<input class="pg-in" id="pgContact" style="text-transform:uppercase" autocomplete="off" placeholder="Same as the customer name" oninput="this.dataset.touched=1">',{opt:1})
    +'</div></div>'
    +'<div class="pg-card"><h4>Flat</h4><div class="pg-bf" style="--c:minmax(0,1fr)">'
      +f('pgBlock','Block','<div id="pgC_pgBlock">'+seg('pgBlock',[],'')+'</div>')
    +'</div><div class="pg-bf" style="--c:auto minmax(0,1fr)">'
      +f('pgFloor','Floor','<div id="pgC_pgFloor">'+seg('pgFloor',[],'')+'</div>')
      +f('pgFlat','Flat number','<input class="pg-in" id="pgFlat" maxlength="8" style="text-transform:uppercase" autocomplete="off" placeholder="e.g. 5A">',{req:1})
    +'</div></div>'
    /* 19 Nov 2026 (Ayush): the Flat and Size & price cards are compulsory and are LOCKED for the customer (they see them, cannot change them); car parks
       can be more than one, each Covered or Open, or NA for none; Booking amount is new - what the customer pays now, shown to them as the Booking Amount. */
    +'<div class="pg-card"><h4>Size &amp; price</h4><div class="pg-bf" style="--c:minmax(0,1fr)">'
      +f('pgBhk','Bedrooms','<div id="pgC_pgBhk">'+seg('pgBhk',[],'')+'</div>')
    +'</div><div class="pg-bf" style="--c:minmax(0,1fr)">'
      +f('pgPark','Car park','<div id="pgParkBox"></div>',{req:1})
    +'</div><div class="pg-bf" style="--c:minmax(0,1fr) minmax(0,1fr)">'
      +f('pgSba','Super built-up area','<div class="pg-suf"><input class="pg-in" id="pgSba" inputmode="decimal" autocomplete="off" placeholder="1325"><span>sq.ft.</span></div>',{req:1})
      +f('pgTotal','Total sale price','<div class="pg-pre"><span>&#8377;</span><input class="pg-in" id="pgTotal" inputmode="numeric" autocomplete="off" placeholder="72,00,000" oninput="pgMoney(this)"></div>',{req:1,help:'&nbsp;'})
    +'</div><div class="pg-bf" style="--c:minmax(0,1fr) minmax(0,1fr)">'
      +f('pgBook','Booking amount','<div class="pg-pre"><span>&#8377;</span><input class="pg-in" id="pgBook" inputmode="numeric" autocomplete="off" placeholder="1,00,000" oninput="pgMoney(this)"></div>',{req:1,help:'&nbsp;'})
    +'</div></div>'
    +'</div>'
    +'<div class="pg-card pg-slim pg-f" id="pgF_pgCost"><label>Cost sheet &amp; payment plan (PDF or picture) <span class="r">*</span></label><div class="ctl w"><div class="pg-cost" id="pgCostBox"></div><input type="file" id="pgCostFile" accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" style="display:none" onchange="pgCostPick(this)"></div><div class="pg-e" id="pgE_pgCost"></div></div>'
    +'</div>'
    +'<div class="pg-wrap"><div class="pg-bar"><span class="msg" id="pgErr" style="color:var(--slate);font-weight:400">Name, mobile and email are pre-filled - the customer can correct them. Flat, size, price and booking amount are fixed for the customer. They fill in the rest (Aadhaar, PAN, address, payment proof).</span><button class="btn" onclick="pgClose()">Cancel</button><button class="btn" id="pgDraftBtn" onclick="pgSaveDraft()"><i class="fa-regular fa-floppy-disk"></i> Save draft</button><button class="btn btn-primary" id="pgGo" onclick="pdfGenerate()"><i class="fa-solid fa-link"></i> Generate link</button></div></div>'
    +'</div></div>'
    +'<div class="pg-main" id="pgDraftsWrap" style="display:none"><div id="pgDrafts"></div></div>'
    +'<div class="pg-main" id="pgListWrap" style="display:none"><div id="pgList"></div></div>';
  document.body.appendChild(page); pgFit(page);
  pgCostDraw(); pgParkDraw(); pgSyncGo();
  pgProjInit(editRow||null);   // fills the project list, then (when editing) the boxes
  pdfGenList();
};
window.pgTab=function(t){ [['new','pgNew','pgT_new'],['drafts','pgDraftsWrap','pgT_drafts'],['list','pgListWrap','pgT_list']].forEach(function(x){ const on=x[0]===t; $(x[1]).style.display=on?'':'none'; $(x[2]).className=on?'on':''; }); };
window.pgClose=function(){ const p=document.getElementById('pgPage'); if(p) p.remove(); };
window.pgSeg=function(btn,id){ btn.parentNode.querySelectorAll('button').forEach(function(x){ x.classList.remove('on'); }); btn.classList.add('on'); $(id).value=btn.textContent.trim(); };
window.pgNameSync=function(){ const c=$('pgContact'); if(c&&!c.dataset.touched) c.value=($('pgName').value||''); };
window.pgNatSync=function(){ const n=PDF_COUNTRIES.filter(c=>c[0]===$('pgNat').value)[0]; if(n&&$('pgCc')) $('pgCc').value=n[1]; };
window.pgMoney=function(inp){ const d=inp.value.replace(/[^\d]/g,''); inp.value=d?Number(d).toLocaleString('en-IN'):''; const h=$('pgH_'+inp.id); if(h) h.textContent=pdfWords(d); };
// Editing a link: its details go back into the boxes.
// The boxes as they are now (a draft keeps them exactly like this, even half empty).
function pgRaw(){ const g=id=>($(id)||{}).value||''; const c=$('pgContact');
  return {title:g('pgTitle'),nat:g('pgNat'),name:g('pgName'),dob:g('pgDob'),cc:g('pgCc'),mobile:g('pgMobile'),email:g('pgEmail'),contact:g('pgContact'),contactTouched:!!(c&&c.dataset&&c.dataset.touched),
    block:g('pgBlock'),floor:g('pgFloor'),bhk:g('pgBhk'),park:(PG.parks||[])[0]||'',parks:(PG.parks||[]).slice(),flat:g('pgFlat'),sba:g('pgSba'),total:g('pgTotal'),book:g('pgBook'),
    project:g('pgProject'),cost:PG.cost||null}; }
function pgFillRaw(r){
  const set=(id,val)=>{ const e=$(id); if(e&&val!=null) e.value=val; };
  // a draft of another project: the project is chosen first so its blocks / floors / bedrooms are the ones on the page (not while editing a link - its project is fixed)
  const ps=$('pgProject');
  if(r.project&&ps&&!ps.disabled&&ps.value!==r.project){ const p=(PG_PROJ.list||[]).filter(x=>x.key===r.project)[0]; if(p){ ps.value=r.project; pgProjApply(p); } }
  // only a choice that exists on the page is taken (the buttons, or the options of the floor list)
  const seg=(id,val)=>{ const e=$(id); if(!e||val==null||val==='') return; const v=String(val);
    if(e.tagName==='SELECT'){ if([].some.call(e.options,function(o){ return o.value===v; })) e.value=v; return; }
    const bs=[].slice.call(e.parentNode.querySelectorAll('.pg-seg button')); if(!bs.some(function(b){ return b.textContent.trim()===v; })) return;
    e.value=v; bs.forEach(function(b){ b.classList.toggle('on',b.textContent.trim()===v); }); };
  if('cost' in r){ PG.cost=(r.cost&&r.cost.path)?r.cost:null; pgCostDraw(); pgCostMsg(''); }
  set('pgTitle',r.title); set('pgNat',r.nat); set('pgName',r.name); set('pgDob',r.dob); set('pgCc',r.cc); set('pgMobile',r.mobile); set('pgEmail',r.email); set('pgContact',r.contact);
  if(r.contactTouched&&$('pgContact')) $('pgContact').dataset.touched=1;
  seg('pgBlock',r.block); seg('pgFloor',r.floor); seg('pgBhk',r.bhk); set('pgFlat',r.flat); set('pgSba',r.sba); set('pgTotal',r.total); set('pgBook',r.book);
  const pk=Array.isArray(r.parks)&&r.parks.length?r.parks:(r.park?[r.park]:null); if(pk){ PG.parks=pk.map(String); pgParkDraw(); }
  const h=$('pgH_pgTotal'); if(h) h.textContent=pdfWords(String(r.total||'').replace(/[^\d]/g,''));
  const hb=$('pgH_pgBook'); if(hb) hb.textContent=pdfWords(String(r.book||'').replace(/[^\d]/g,''));
}
// Editing a link: its details go back into the boxes.
function pgFill(row){
  const v=(row.prefill&&row.prefill.values)||{}, a=(v.applicants&&v.applicants[0])||{}, c=v.contact||{}, fl=v.flat||{}, pr=v.price||{};
  pgFillRaw({title:a.title,nat:a.nationality,name:a.full_name,dob:a.dob,cc:c.cc,mobile:c.mobile,email:c.email,contact:c.contact_person,contactTouched:!!(c.contact_person&&c.contact_person!==a.full_name),
    block:fl.block,floor:fl.floor,bhk:fl.bhk,park:fl.parking,parks:fl.parkings,flat:fl.flat_no,sba:pr.sba,total:pr.total?Number(pr.total).toLocaleString('en-IN'):'',book:pr.booking?Number(pr.booking).toLocaleString('en-IN'):'',
    cost:row.prefill&&row.prefill.cost_sheet});
  const n=$('pgEditNote'); if(n) n.innerHTML='<div class="pg-edit"><b>Editing the link for '+esc(a.full_name||'this customer')+'.</b> The link stays the same. The customer sees the new details the next time they open or refresh the form; what they have already typed stays.</div>';
  const g=$('pgGo'); if(g) g.innerHTML='<i class="fa-solid fa-floppy-disk"></i> Save changes';
  const d=$('pgDraftBtn'); if(d) d.style.display='none';
}
window.pdfGenerate=async function(){
  const g=id=>($(id)||{}).value||'';
  const fails=[]; const bad=(id,m)=>fails.push([id,m]);
  const name=g('pgName').trim().toUpperCase(), mobile=g('pgMobile').replace(/[^\d]/g,''), email=g('pgEmail').trim().toLowerCase(), cc=g('pgCc');
  const sba=g('pgSba').replace(/[^\d.]/g,''), total=g('pgTotal').replace(/[^\d]/g,''), book=g('pgBook').replace(/[^\d]/g,'');
  const parks=(PG.parks&&PG.parks.length?PG.parks:['Covered']).slice();
  if(!name) bad('pgName','Please write the customer name.');
  // 19 Nov 2026: date of birth and nationality are optional for Sales (the customer must give them); the flat number and the booking amount are compulsory
  if(!g('pgFlat').trim()) bad('pgFlat','Please write the flat number.');
  if(!(Number(book)>0)) bad('pgBook','Please write the booking amount.');
  else if(Number(total)>0&&Number(book)>Number(total)) bad('pgBook','The booking amount cannot be more than the total sale price.');
  if(cc==='+91'?!/^[6-9]\d{9}$/.test(mobile):mobile.length<6) bad('pgMobile','Please write a complete mobile number'+(cc==='+91'?' (10 digits).':'.'));
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) bad('pgEmail','Please write a complete email address.');
  if(!(Number(sba)>0)) bad('pgSba','Please write the super built-up area.');
  if(!(Number(total)>0)) bad('pgTotal','Please write the total sale price.');
  if(!PG.project) bad('pgProject','Please choose the project.');
  if(!PG.cost||!PG.cost.path) bad('pgCost','Please attach the cost sheet (PDF or picture).');
  ['pgName','pgDob','pgMobile','pgEmail','pgFlat','pgSba','pgTotal','pgBook','pgProject','pgCost'].forEach(function(id){ const e=$('pgE_'+id), fb=$('pgF_'+id); if(e) e.textContent=''; if(fb&&fb.classList) fb.classList.remove('bad'); });
  if(fails.length){
    fails.forEach(function(x){ const e=$('pgE_'+x[0]), fb=$('pgF_'+x[0]); if(e) e.textContent=x[1]; if(fb&&fb.classList) fb.classList.add('bad'); });
    const m=$('pgErr'); if(m){ m.textContent=fails.length===1?'One thing to fix':fails.length+' things to fix'; m.style.color='#b3171d'; m.style.fontWeight='600'; }
    const first=$('pgF_'+fails[0][0]); if(first&&first.scrollIntoView) first.scrollIntoView({block:'center',behavior:'smooth'});
    return;
  }
  const m0=$('pgErr'); if(m0) m0.textContent='';
  const values={applicants:[{title:g('pgTitle'),full_name:name,nationality:g('pgNat'),dob:g('pgDob')}],
    contact:{cc:cc,mobile:mobile,email:email,contact_person:(g('pgContact').trim()||name).toUpperCase()},
    flat:{block:g('pgBlock'),floor:g('pgFloor'),flat_no:g('pgFlat').trim().toUpperCase(),bhk:g('pgBhk'),parking:parks[0],parkings:parks},
    price:{sba:sba,total:total,booking:book},pay:{amount:book}};
  const fields=['applicants.0.title','applicants.0.full_name','applicants.0.nationality','applicants.0.dob','contact.cc','contact.mobile','contact.email','contact.contact_person',
    'flat.block','flat.floor','flat.flat_no','flat.bhk','flat.parking','flat.parkings','price.sba','price.total','price.booking','pay.amount'];
  const btn=$('pgGo'); btn.disabled=true; btn.textContent=PG.editId?'Saving…':'Generating…';
  /* 19 Nov 2026 (Ayush): the unit, size, price and booking amount are LOCKED for the customer again (the server puts them back on every save and on submit);
     name, mobile, email and the rest stay pre-filled only. version 2 = a link made by this page (the server's stricter checks apply to these). */
  const locked=['flat.block','flat.floor','flat.flat_no','flat.bhk','flat.parking','flat.parkings','price.sba','price.total','price.booking','pay.amount'];
  const prefill={values:values,locked:locked,fields:fields,cost_sheet:PG.cost,version:2};
  const editing=!!PG.editId;
  const res=editing?await sb.schema('acc').rpc('update_booking_link',{p_id:PG.editId,p_prefill:prefill})
                   :await sb.schema('acc').rpc('generate_booking_link',{p_project:PG.project.key,p_prefill:prefill});
  if(res.error||!res.data){ pgSyncGo(); btn.innerHTML=editing?'<i class="fa-solid fa-floppy-disk"></i> Save changes':'<i class="fa-solid fa-link"></i> Generate link'; const m=$('pgErr'); if(m) m.textContent=(editing?'Could not save the changes: ':'Could not generate the link: ')+((res.error&&res.error.message)||'nothing came back'); return; }
  const token=editing?PG.editToken:res.data, url=pdfLinkUrl(token);
  if(!editing&&PG.draftId){ try{ await sb.schema('acc').from('digital_booking_drafts').delete().eq('id',PG.draftId); }catch(e){} PG.draftId=null; }
  $('pgBody').innerHTML='<div class="pg-done"><div class="ok"><i class="fa-solid fa-check"></i></div><h3>'+(editing?'Changes saved for ':'The link for ')+esc(name)+(editing?'':' is ready')+'</h3>'
    +'<p>'+(editing?'The link is the same as before.':'Give it only to this customer - anyone who has the link can open the form. Their answers are saved as they type.')+'</p>'
    +'<div class="pg-link"><input class="pg-in" id="pgUrl" readonly value="'+esc(url)+'" onclick="this.select()"></div>'
    +'<div class="pg-acts"><button class="btn btn-primary" onclick="pdfCopyLink(\''+token+'\',this)"><i class="fa-regular fa-copy"></i> Copy link</button>'
    +'<a class="btn" href="'+esc(url)+'" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open as the customer</a>'
    +'<button class="btn" onclick="pdfGenOpen()"><i class="fa-solid fa-plus"></i> Generate another</button></div></div>';
  await pdfGenList();
};
window.pdfEditLink=function(id){ const r=PDF_LINKS.rows.filter(x=>x.id===id)[0]; if(r) pdfGenOpen(r); };
// The links made so far, as rows.
function pdfGenListHtml(){
  const rows=PDF_LINKS.rows;
  if(!PDF_LINKS.ok) return '<div class="pg-empty">Generated forms are not available yet.</div>';
  if(!rows.length) return '<div class="pg-empty">Nothing generated yet. Your first link will appear here.</div>';
  return '<table class="pg-t"><thead><tr><th>Customer</th><th>Project</th><th>Flat</th><th>Made</th><th>Progress</th><th></th></tr></thead><tbody>'+rows.map(function(r){
    const v=(r.prefill&&r.prefill.values)||{}, f=v.flat||{};
    return '<tr><td><b>'+esc(r.customer_name||'—')+'</b></td>'
      +'<td>'+esc(pgProjName(r.project))+'</td>'
      +'<td>'+esc([f.block,f.floor?'Floor '+f.floor:'',f.flat_no].filter(Boolean).join(' · ')||'—')+'</td>'
      +'<td>'+esc(pdfWhen(r.created_at))+'<div class="sub">'+esc(String(r.created_by||'').split('@')[0])+'</div></td>'
      +'<td>'+pdfLinkStatus(r)+'</td>'
      +'<td class="a">'+(r.status==='open'?'<button class="btn" onclick="pdfCopyLink(\''+r.token+'\',this)"><i class="fa-regular fa-copy"></i> Copy link</button><button class="btn" onclick="pdfEditLink(\''+r.id+'\')"><i class="fa-solid fa-pen"></i> Edit</button>'
        :('<a class="btn" href="'+esc(pdfLinkUrl(r.token))+'" target="_blank" rel="noopener" title="Opens the form in a new page, exactly as the customer sees it - nothing in it can be changed"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open form</a>'))+'</td></tr>'; }).join('')+'</tbody></table>';
}
window.pdfGenList=async function(){ await pdfLoadLinks(); const h=$('pgList'); if(h) h.innerHTML=pdfGenListHtml(); const c=$('pgCount'); if(c) c.textContent=PDF_LINKS.ok?PDF_LINKS.rows.length:'-'; await pgLoadDrafts(); };

/* DRAFTS (11 Nov 2026): half-filled forms kept for the person who started them. Each person sees only their own (the database says the same: acc.digital_booking_drafts
   is readable and writable by its owner only). A draft is edited and saved again as often as needed; making the link from it uses it up. */
async function pgLoadDrafts(){
  const me=String((typeof state!=='undefined'&&state.email)||'').trim().toLowerCase();
  const {data,error}=await sb.schema('acc').from('digital_booking_drafts').select('id,name,values,updated_at').eq('owner',me).order('updated_at',{ascending:false}).limit(200);
  PG_DRAFTS.ok=!error; PG_DRAFTS.rows=error?[]:(data||[]);
  const h=$('pgDrafts'); if(h) h.innerHTML=pgDraftsHtml(); const c=$('pgDCount'); if(c) c.textContent=PG_DRAFTS.ok?PG_DRAFTS.rows.length:'-';
}
function pgDraftsHtml(){
  if(!PG_DRAFTS.ok) return '<div class="pg-empty">Drafts are not available yet.</div>';
  if(!PG_DRAFTS.rows.length) return '<div class="pg-empty">No drafts. Fill in part of a form in NEW and press Save draft - it is kept here, only for you.</div>';
  return '<table class="pg-t"><thead><tr><th>Draft</th><th>Flat</th><th>Last saved</th><th></th></tr></thead><tbody>'+PG_DRAFTS.rows.map(function(r){
    const v=r.values||{};
    return '<tr><td><b>'+esc(r.name||'Untitled draft')+'</b></td>'
      +'<td>'+esc([v.block,v.floor?'Floor '+v.floor:'',v.flat].filter(Boolean).join(' · ')||'—')+'</td>'
      +'<td>'+esc(pdfWhen(r.updated_at))+'</td>'
      +'<td class="a"><button class="btn" onclick="pgOpenDraft(\''+r.id+'\')"><i class="fa-solid fa-pen"></i> Edit</button><button class="btn" onclick="pgDeleteDraft(\''+r.id+'\')"><i class="fa-regular fa-trash-can"></i> Delete</button></td></tr>'; }).join('')+'</tbody></table>';
}
window.pgSaveDraft=async function(){
  const me=String((typeof state!=='undefined'&&state.email)||'').trim().toLowerCase(), raw=pgRaw();
  const name=(raw.name||'').trim().toUpperCase()||'Untitled draft';
  const b=$('pgDraftBtn'); if(b) b.disabled=true;
  let res;
  if(PG.draftId) res=await sb.schema('acc').from('digital_booking_drafts').update({name:name,values:raw,updated_at:new Date().toISOString()}).eq('id',PG.draftId).select('id');
  else res=await sb.schema('acc').from('digital_booking_drafts').insert({owner:me,name:name,values:raw}).select('id');
  if(b) b.disabled=false;
  if(res.error||!res.data||!res.data.length){ toast('Could not save the draft: '+((res.error&&res.error.message)||'not saved'),'err'); return; }
  PG.draftId=res.data[0].id;
  toast('Draft saved','ok'); await pgLoadDrafts();
};
window.pgOpenDraft=function(id){
  const r=PG_DRAFTS.rows.filter(x=>x.id===id)[0]; if(!r) return;
  if(!PG.projReady){ toast('The projects are still loading - try again in a moment','err'); return; }
  pgFillRaw(r.values||{}); PG.draftId=id; pgTab('new');
};
window.pgDeleteDraft=async function(id){
  if(typeof confirmDialog==='function'&&!(await confirmDialog('Delete this draft? It cannot be brought back.'))) return;
  const {error}=await sb.schema('acc').from('digital_booking_drafts').delete().eq('id',id);
  if(error){ toast('Could not delete: '+error.message,'err'); return; }
  if(PG.draftId===id) PG.draftId=null;
  await pgLoadDrafts();
};
window.pdfCanGenerate=pdfCanGenerate;
