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
  pdfDraw(host);
}
function pdfWhen(t){ return t?new Date(t).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—'; }
function pdfChip(s){ const c=PDF_ST[s]||[s,'#6b7280']; return '<span style="font-size:11.5px;font-weight:600;color:'+c[1]+';border:1px solid '+c[1]+'33;background:'+c[1]+'12;border-radius:999px;padding:2px 9px">'+esc(c[0])+'</span>'; }
function pdfDraw(host){
  host=host||$('pdfBody'); if(!host) return;
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
