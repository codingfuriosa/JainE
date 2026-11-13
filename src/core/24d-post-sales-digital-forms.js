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
  document.body.appendChild(page);
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
/* GENERATE FORM AS A PAGE (11 Nov 2026: "not a popup, a page would be better ... very easy for Sales ... optimize space"). It fills the screen
   over the Booking Form workflow (Back returns to it): on a computer the form is on the left in a two-column layout, and the links made so far are
   on the right - copy one again, see how far the customer got, or EDIT it (an open link's details can be changed; the customer sees the new ones
   the next time the form loads, what they already typed stays). On a phone the list sits under the form. Four short cards, tap buttons for choices,
   a price with commas and words, every mistake under its own box, and a link-ready screen with Copy / Open as the customer / Generate another. */
const PG_CSS='<style>'
  +'#pgPage{--pg-h:clamp(36px,5.8vh,56px);--pg-gap:clamp(12px,2.7vh,30px);position:fixed;inset:0;z-index:2000;background:#f4f5f7;display:flex;flex-direction:column;font-family:inherit}'
  +'#pgPage .pg-top{display:flex;align-items:center;gap:14px;padding:10px 22px;background:#fff}'
  +'#pgPage .pg-top h2{margin:0;font-size:18px}#pgPage .pg-top h2 span{font-weight:400;color:var(--slate)}'
  +'#pgPage .pg-tabs{display:flex;gap:4px;padding:0 22px;background:#fff;border-bottom:1px solid var(--line)}'
  +'#pgPage .pg-tabs button{background:none;border:0;border-bottom:3px solid transparent;padding:10px 16px;font:inherit;font-size:14px;font-weight:700;letter-spacing:.03em;color:var(--slate);cursor:pointer;margin-bottom:-1px}'
  +'#pgPage .pg-tabs button.on{color:#1d4ed8;border-bottom-color:#1d4ed8}'
  +'#pgPage .pg-tabs .pg-n{display:inline-block;min-width:20px;padding:0 6px;margin-left:6px;border-radius:999px;background:#eef0f4;color:var(--slate);font-size:12px;font-weight:600;text-align:center}'
  +'#pgPage .pg-main{flex:1;overflow:auto;padding:14px 22px 16px}'
  +'#pgNew{display:flex;flex-direction:column}#pgBody{flex:1;display:flex;flex-direction:column;min-height:0}'
  +'.pg-edit{margin:0 0 10px;padding:8px 12px;border-radius:8px;background:#fff7e6;border:1px solid #f0d9a8;color:#92400e;font-size:13px}'
  +'.pg-cards{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.55fr) minmax(0,1fr);gap:12px;align-items:stretch;flex:1;min-height:0}'
  +'@media(max-width:1250px),(min-height:860px) and (min-width:1000px){.pg-cards{grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:1fr}}'
  +'@media(max-width:1250px) and (max-height:859px){.pg-cards{grid-auto-rows:auto}}@media(max-width:700px){.pg-cards{grid-template-columns:1fr}}'
  +'.pg-card{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:10px;padding:clamp(12px,2vh,22px) 16px clamp(14px,2.4vh,26px);background:#fff}'
  +'.pg-card>h4{margin:0 0 10px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--slate);font-weight:700}'
  +'.pg-g{display:grid;gap:var(--pg-gap) 10px;align-content:start}.pg-g.c2{grid-template-columns:repeat(2,minmax(0,1fr))}'
  +'.pg-f label{display:block;font-size:clamp(12.5px,1.9vh,14.5px);font-weight:600;color:var(--ink,#111827);margin-bottom:4px}'
  +'.pg-f label .o{font-weight:400;color:var(--slate)}.pg-f label .r{color:#b3171d}'
  +'.pg-in{width:100%;box-sizing:border-box;height:var(--pg-h);padding:0 11px;border:1px solid #cfd4dc;border-radius:8px;background:#fff;font:inherit;font-size:clamp(14px,2.1vh,16px);color:var(--ink,#111827)}'
  +'select.pg-in{padding-right:4px}.pg-in:focus{outline:none;border-color:#1d4ed8;box-shadow:0 0 0 3px rgba(29,78,216,.15)}'
  +'.pg-f.bad .pg-in,.pg-f.bad .pg-seg button{border-color:#b3171d}'
  +'.pg-help{margin-top:3px;font-size:12px;color:var(--slate)}.pg-e{margin-top:3px;font-size:12px;color:#b3171d;font-weight:600}.pg-e:empty{display:none}'
  +'.pg-row{display:flex;gap:6px}.pg-row .cc{width:92px;flex:none}'
  +'.pg-pre{display:flex}.pg-pre>span{display:flex;align-items:center;padding:0 10px;border:1px solid #cfd4dc;border-right:0;border-radius:8px 0 0 8px;background:#f3f4f6;color:var(--slate)}.pg-pre>.pg-in{border-radius:0 8px 8px 0}'
  +'.pg-suf{display:flex}.pg-suf>.pg-in{border-radius:8px 0 0 8px}.pg-suf>span{display:flex;align-items:center;padding:0 10px;border:1px solid #cfd4dc;border-left:0;border-radius:0 8px 8px 0;background:#f3f4f6;color:var(--slate);font-size:12.5px}'
  +'.pg-seg{display:flex;flex-wrap:wrap;gap:6px}'
  +'.pg-seg button{min-width:var(--pg-h);height:var(--pg-h);padding:0 12px;border:1px solid #cfd4dc;border-radius:8px;background:#fff;font:inherit;font-size:13.5px;color:var(--ink,#111827);cursor:pointer}'
  +'.pg-seg button:hover{border-color:#9aa1ab}.pg-seg button.on{background:#e8efff;border-color:#1d4ed8;color:#1d4ed8;font-weight:700}'
  +'.pg-bar{display:flex;gap:10px;justify-content:flex-end;align-items:center;margin-top:12px;padding:10px 14px;background:#fff;border:1px solid var(--line);border-radius:10px}'
  +'.pg-bar .msg{margin-right:auto;color:#b3171d;font-size:13.5px;font-weight:600}'
  +'.pg-done{margin:auto;background:#fff;border:1px solid var(--line);border-radius:10px;text-align:center;padding:22px 18px;max-width:760px;margin:0 auto}.pg-done .ok{width:50px;height:50px;border-radius:50%;background:#e7f6ec;color:#15803d;display:flex;align-items:center;justify-content:center;margin:0 auto 10px;font-size:22px}'
  +'.pg-done h3{margin:0 0 4px;font-size:18px}.pg-done p{margin:0 0 12px;color:var(--slate);font-size:13.5px}.pg-link{max-width:680px;margin:0 auto 12px}'
  +'.pg-acts{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}'
  +'.pg-t{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:14px}'
  +'.pg-t th{text-align:left;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--slate);font-weight:700;padding:10px 14px;background:#f7f8fa;border-bottom:1px solid var(--line)}'
  +'.pg-t td{padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:middle}.pg-t tr:last-child td{border-bottom:0}.pg-t tbody tr:hover{background:#fafbfc}'
  +'.pg-t td.a{text-align:right;white-space:nowrap}.pg-t td.a .btn{padding:4px 10px;margin-left:6px}.pg-t .sub{color:var(--slate);font-size:12.5px}'
  +'.pg-empty{padding:34px 16px;text-align:center;color:var(--slate);background:#fff;border:1px solid var(--line);border-radius:10px}'
  +'.pg-l{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px}.pg-l b{font-size:14.5px}.pg-l .m{color:var(--slate);font-size:12.5px;margin:3px 0 6px}'
  +'.pg-l .a{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.pg-l .a .btn{padding:4px 10px}'
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
const PG={editId:null,editToken:null,draftId:null};
const PG_DRAFTS={rows:[],ok:false};
window.pdfGenOpen=function(editRow){
  if(!pdfCanGenerate()) return;
  PG.editId=editRow&&editRow.id||null; PG.editToken=editRow&&editRow.token||null; PG.draftId=null;
  const old=document.getElementById('pgPage'); if(old) old.remove();
  const f=(id,label,ctl,o)=>{ o=o||{}; return '<div class="pg-f" id="pgF_'+id+'"><label for="'+id+'">'+label+(o.req?' <span class="r">*</span>':'')+(o.opt?' <span class="o">(optional)</span>':'')+'</label>'+ctl
    +(o.help?'<div class="pg-help" id="pgH_'+id+'">'+o.help+'</div>':'')+'<div class="pg-e" id="pgE_'+id+'"></div></div>'; };
  const sel=(id,opts,def,cls)=>'<select class="pg-in'+(cls?' '+cls:'')+'" id="'+id+'">'+opts.map(o=>{ const v=Array.isArray(o)?o[0]:o, t=Array.isArray(o)?o[1]:o; return '<option value="'+esc(v)+'"'+(v===def?' selected':'')+'>'+esc(t)+'</option>'; }).join('')+'</select>';
  const seg=(id,opts,def)=>'<input type="hidden" id="'+id+'" value="'+esc(def)+'"><div class="pg-seg" role="radiogroup">'+opts.map(o=>'<button type="button" class="'+(o===def?'on':'')+'" onclick="pgSeg(this,\''+id+'\')">'+esc(o)+'</button>').join('')+'</div>';
  const floors=['1','2','3','4','5','6','7','8'], codes=PDF_COUNTRIES.map(c=>c[1]).filter((x,i,a)=>a.indexOf(x)===i);
  const page=document.createElement('div'); page.id='pgPage';
  page.innerHTML=PG_CSS
    +'<div class="pg-top"><button class="btn" onclick="pgClose()"><i class="fa-solid fa-arrow-left"></i> Back</button><h2><i class="fa-solid fa-link"></i> Generate Form <span>&middot; Dream Ananta</span></h2></div>'
    +'<div class="pg-tabs"><button class="on" id="pgT_new" onclick="pgTab(\'new\')">NEW</button><button id="pgT_drafts" onclick="pgTab(\'drafts\')">DRAFTS <span class="pg-n" id="pgDCount">…</span></button><button id="pgT_list" onclick="pgTab(\'list\')">Generated forms <span class="pg-n" id="pgCount">…</span></button></div>'
    +'<div class="pg-main" id="pgNew"><div id="pgBody"><div id="pgEditNote"></div>'
    +'<div class="pg-cards">'
      +'<div class="pg-card"><h4>Customer</h4><div class="pg-g c2">'
        +f('pgTitle','Title',sel('pgTitle',['Mr.','Ms.','Mrs.','Mast.','M/s.'],'Mr.'))
        +f('pgNat','Nationality',sel('pgNat',PDF_COUNTRIES.map(c=>c[0]),'India').replace('<select ','<select onchange="pgNatSync()" '))
        +'<div style="grid-column:1/-1">'+f('pgName','Customer name','<input class="pg-in" id="pgName" style="text-transform:uppercase" autocomplete="off" placeholder="As on the PAN card" oninput="pgNameSync()">',{req:1})+'</div>'
        +'<div style="grid-column:1/-1">'+f('pgDob','Date of birth','<input class="pg-in" type="date" id="pgDob">',{req:1})+'</div>'
      +'</div></div>'
      +'<div class="pg-card"><h4>Contact</h4><div class="pg-g">'
        +f('pgMobile','Mobile number','<div class="pg-row">'+sel('pgCc',codes,'+91','cc')+'<input class="pg-in" id="pgMobile" inputmode="tel" autocomplete="off" placeholder="98300 12345"></div>',{req:1})
        +f('pgEmail','Email','<input class="pg-in" type="email" id="pgEmail" autocomplete="off" placeholder="name@example.com">',{req:1})
        +f('pgContact','Contact person','<input class="pg-in" id="pgContact" style="text-transform:uppercase" autocomplete="off" placeholder="Same as the customer name" oninput="this.dataset.touched=1">',{opt:1})
      +'</div></div>'
      +'<div class="pg-card"><h4>Unit</h4><div class="pg-g c2">'
        +f('pgBlock','Block',seg('pgBlock',['Block D','Block E'],'Block D'))
        +f('pgPark','Car park',seg('pgPark',['Covered','Open'],'Covered'))
        +'<div style="grid-column:1/-1">'+f('pgFloor','Floor',seg('pgFloor',floors,'1'))+'</div>'
        +f('pgBhk','Bedrooms',seg('pgBhk',['2 BHK','3 BHK','4 BHK'],'3 BHK'))
        +f('pgFlat','Flat number','<input class="pg-in" id="pgFlat" maxlength="8" style="text-transform:uppercase" autocomplete="off" placeholder="e.g. 5A">',{opt:1})
      +'</div></div>'
      +'<div class="pg-card"><h4>Area &amp; price</h4><div class="pg-g">'
        +f('pgSba','Super built-up area','<div class="pg-suf"><input class="pg-in" id="pgSba" inputmode="decimal" autocomplete="off" placeholder="1325"><span>sq.ft.</span></div>',{req:1})
        +f('pgTotal','Total sale price','<div class="pg-pre"><span>&#8377;</span><input class="pg-in" id="pgTotal" inputmode="numeric" autocomplete="off" placeholder="72,00,000" oninput="pgMoney(this)"></div>',{req:1,help:'&nbsp;'})
      +'</div></div>'
    +'</div>'
    +'<div class="pg-bar"><span class="msg" id="pgErr" style="color:var(--slate);font-weight:400">What you fill in is shown to the customer but locked. They fill in the rest (PAN, Aadhaar, address, payment).</span><button class="btn" onclick="pgClose()">Cancel</button><button class="btn" id="pgDraftBtn" onclick="pgSaveDraft()"><i class="fa-regular fa-floppy-disk"></i> Save draft</button><button class="btn btn-primary" id="pgGo" onclick="pdfGenerate()"><i class="fa-solid fa-link"></i> Generate link</button></div>'
    +'</div></div>'
    +'<div class="pg-main" id="pgDraftsWrap" style="display:none"><div id="pgDrafts"></div></div>'
    +'<div class="pg-main" id="pgListWrap" style="display:none"><div id="pgList"></div></div>';
  document.body.appendChild(page); document.body.style.overflow='hidden';
  if(editRow) pgFill(editRow);
  pdfGenList();
};
window.pgTab=function(t){ [['new','pgNew','pgT_new'],['drafts','pgDraftsWrap','pgT_drafts'],['list','pgListWrap','pgT_list']].forEach(function(x){ const on=x[0]===t; $(x[1]).style.display=on?'':'none'; $(x[2]).className=on?'on':''; }); };
window.pgClose=function(){ const p=document.getElementById('pgPage'); if(p) p.remove(); document.body.style.overflow=''; };
window.pgSeg=function(btn,id){ btn.parentNode.querySelectorAll('button').forEach(function(x){ x.classList.remove('on'); }); btn.classList.add('on'); $(id).value=btn.textContent.trim(); };
window.pgNameSync=function(){ const c=$('pgContact'); if(c&&!c.dataset.touched) c.value=($('pgName').value||''); };
window.pgNatSync=function(){ const n=PDF_COUNTRIES.filter(c=>c[0]===$('pgNat').value)[0]; if(n&&$('pgCc')) $('pgCc').value=n[1]; };
window.pgMoney=function(inp){ const d=inp.value.replace(/[^\d]/g,''); inp.value=d?Number(d).toLocaleString('en-IN'):''; const h=$('pgH_pgTotal'); if(h) h.textContent=pdfWords(d); };
// Editing a link: its details go back into the boxes.
// The boxes as they are now (a draft keeps them exactly like this, even half empty).
function pgRaw(){ const g=id=>($(id)||{}).value||''; const c=$('pgContact');
  return {title:g('pgTitle'),nat:g('pgNat'),name:g('pgName'),dob:g('pgDob'),cc:g('pgCc'),mobile:g('pgMobile'),email:g('pgEmail'),contact:g('pgContact'),contactTouched:!!(c&&c.dataset&&c.dataset.touched),
    block:g('pgBlock'),floor:g('pgFloor'),bhk:g('pgBhk'),park:g('pgPark'),flat:g('pgFlat'),sba:g('pgSba'),total:g('pgTotal')}; }
function pgFillRaw(r){
  const set=(id,val)=>{ const e=$(id); if(e&&val!=null) e.value=val; };
  const seg=(id,val)=>{ const e=$(id); if(!e||val==null||val==='') return; e.value=val; e.parentNode.querySelectorAll('.pg-seg button').forEach(function(b){ b.classList.toggle('on',b.textContent.trim()===String(val)); }); };
  set('pgTitle',r.title); set('pgNat',r.nat); set('pgName',r.name); set('pgDob',r.dob); set('pgCc',r.cc); set('pgMobile',r.mobile); set('pgEmail',r.email); set('pgContact',r.contact);
  if(r.contactTouched&&$('pgContact')) $('pgContact').dataset.touched=1;
  seg('pgBlock',r.block); seg('pgFloor',r.floor); seg('pgBhk',r.bhk); seg('pgPark',r.park); set('pgFlat',r.flat); set('pgSba',r.sba); set('pgTotal',r.total);
  const h=$('pgH_pgTotal'); if(h) h.textContent=pdfWords(String(r.total||'').replace(/[^\d]/g,''));
}
// Editing a link: its details go back into the boxes.
function pgFill(row){
  const v=(row.prefill&&row.prefill.values)||{}, a=(v.applicants&&v.applicants[0])||{}, c=v.contact||{}, fl=v.flat||{}, pr=v.price||{};
  pgFillRaw({title:a.title,nat:a.nationality,name:a.full_name,dob:a.dob,cc:c.cc,mobile:c.mobile,email:c.email,contact:c.contact_person,contactTouched:!!(c.contact_person&&c.contact_person!==a.full_name),
    block:fl.block,floor:fl.floor,bhk:fl.bhk,park:fl.parking,flat:fl.flat_no,sba:pr.sba,total:pr.total?Number(pr.total).toLocaleString('en-IN'):''});
  const n=$('pgEditNote'); if(n) n.innerHTML='<div class="pg-edit"><b>Editing the link for '+esc(a.full_name||'this customer')+'.</b> The link stays the same. The customer sees the new details the next time they open or refresh the form; what they have already typed stays.</div>';
  const g=$('pgGo'); if(g) g.innerHTML='<i class="fa-solid fa-floppy-disk"></i> Save changes';
  const d=$('pgDraftBtn'); if(d) d.style.display='none';
}
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
    const m=$('pgErr'); if(m){ m.textContent=fails.length===1?'One thing to fix':fails.length+' things to fix'; m.style.color='#b3171d'; m.style.fontWeight='600'; }
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
  const btn=$('pgGo'); btn.disabled=true; btn.textContent=PG.editId?'Saving…':'Generating…';
  const prefill={values:values,locked:locked};
  const editing=!!PG.editId;
  const res=editing?await sb.schema('acc').rpc('update_booking_link',{p_id:PG.editId,p_prefill:prefill})
                   :await sb.schema('acc').rpc('generate_booking_link',{p_project:'ananta',p_prefill:prefill});
  if(res.error||!res.data){ btn.disabled=false; btn.innerHTML=editing?'<i class="fa-solid fa-floppy-disk"></i> Save changes':'<i class="fa-solid fa-link"></i> Generate link'; const m=$('pgErr'); if(m) m.textContent=(editing?'Could not save the changes: ':'Could not generate the link: ')+((res.error&&res.error.message)||'nothing came back'); return; }
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
  return '<table class="pg-t"><thead><tr><th>Customer</th><th>Flat</th><th>Made</th><th>Progress</th><th></th></tr></thead><tbody>'+rows.map(function(r){
    const v=(r.prefill&&r.prefill.values)||{}, f=v.flat||{};
    return '<tr><td><b>'+esc(r.customer_name||'—')+'</b></td>'
      +'<td>'+esc([f.block,f.floor?'Floor '+f.floor:'',f.flat_no].filter(Boolean).join(' · ')||'—')+'</td>'
      +'<td>'+esc(pdfWhen(r.created_at))+'<div class="sub">'+esc(String(r.created_by||'').split('@')[0])+'</div></td>'
      +'<td>'+pdfLinkStatus(r)+'</td>'
      +'<td class="a">'+(r.status==='open'?'<button class="btn" onclick="pdfCopyLink(\''+r.token+'\',this)"><i class="fa-regular fa-copy"></i> Copy link</button><button class="btn" onclick="pdfEditLink(\''+r.id+'\')"><i class="fa-solid fa-pen"></i> Edit</button>'
        :('<a class="btn" href="'+esc(pdfLinkUrl(r.token))+'" target="_blank" rel="noopener" title="Opens the form in a new page, exactly as the customer sees it - nothing in it can be changed"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open form</a>'
          +(r.form_id?'<button class="btn" title="The uploaded KYC photos, the signature, the status and a staff note" onclick="pdfOpen(\''+r.form_id+'\')">KYC &amp; status</button>':'')))+'</td></tr>'; }).join('')+'</tbody></table>';
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
