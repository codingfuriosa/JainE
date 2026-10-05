/* Public vendor self-registration form -- no Supabase client, no key, ever, in this file.
   Everything goes through the vendor-register edge function (action 'get' | 'submit', plus a multipart
   upload for each document), which is the actual security boundary. This file only renders the form and
   posts back what the vendor typed. The link's token (?t=) is the only credential. */
(function(){
  const SB='https://rkxsgtauigjrpcjkmccu.supabase.co';
  const URL_FN=SB+'/functions/v1/vendor-register';
  const token=new URLSearchParams(location.search).get('t');
  const app=document.getElementById('app');
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const PAN_RE=/^[A-Z]{5}[0-9]{4}[A-Z]$/, GST_RE=/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, IFSC_RE=/^[A-Z]{4}0[A-Z0-9]{6}$/;
  const DOCS=[['pan','PAN card','Required if you gave a PAN'],['gst_certificate','GST registration certificate','Required if you gave a GSTIN'],
    ['cancelled_cheque','Cancelled cheque','Required if you give a bank account (or first page of a bank statement)'],['msme_certificate','MSME / Udyam certificate','Optional'],['other','Any other document','Optional']];
  const uploaded={};   // doc_type -> {storage_path,file_name}
  let groups=[];

  if(!token){ app.innerHTML='<p class="err">This link is missing its registration reference. Please use the exact link we emailed you.</p>'; return; }

  async function call(body){
    try{
      const res=await fetch(URL_FN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({token},body))});
      const out=await res.json().catch(()=>({error:'Unexpected response'}));
      if(!res.ok&&!out.error) out.error='Something went wrong (status '+res.status+')';
      return out;
    }catch(e){ return {error:'Could not reach the server. Please check your connection and try again.'}; }
  }

  function groupTree(){
    const out=[];
    (function walk(parent,depth){ groups.filter(g=>(g.parent_id||null)===parent).forEach(g=>{ out.push({g,depth}); walk(g.id,depth+1); }); })(null,0);
    return out;
  }
  const contactRow=(primary)=>'<div class="row contact"><button type="button" class="rm" title="Remove" onclick="this.parentNode.remove()">&times;</button><div class="grid">'
    +'<div><label class="fld">Name <span class="req">*</span></label><input type="text" class="c-name"></div>'
    +'<div><label class="fld">Designation</label><input type="text" class="c-role"></div>'
    +'<div><label class="fld">Email</label><input type="email" class="c-email"></div>'
    +'<div><label class="fld">Phone</label><input type="tel" class="c-phone"></div></div>'
    +'<div class="inl"><label class="ck"><input type="radio" name="cprim" class="c-prim"'+(primary?' checked':'')+'> Main contact</label>'
    +'<label class="ck"><input type="checkbox" class="c-rfq" checked> Send enquiries (RFQs) to this email</label></div></div>';
  const bankRow=()=>'<div class="row bank"><button type="button" class="rm" title="Remove" onclick="this.parentNode.remove()">&times;</button><div class="grid">'
    +'<div><label class="fld">Bank <span class="req">*</span></label><input type="text" class="b-bank"></div>'
    +'<div><label class="fld">Account holder</label><input type="text" class="b-name"></div>'
    +'<div><label class="fld">Account number <span class="req">*</span></label><input type="text" class="b-no" inputmode="numeric"></div>'
    +'<div><label class="fld">IFSC</label><input type="text" class="b-ifsc up" maxlength="11"></div></div>'
    +'<div class="grid" style="margin-top:12px"><div><label class="fld">Branch</label><input type="text" class="b-branch"></div></div></div>';

  function render(inv){
    groups=inv.groups||[];
    app.innerHTML='<h1>Register as a vendor</h1><p class="sub">Please complete this form so we can enlist you with The Jain Group. Fields marked <span style="color:var(--brand)">*</span> are required. Your details are reviewed by our purchase team before you are approved.</p>'
      +'<h2>Business</h2><div class="grid">'
      +'<div class="full"><label class="fld">Registered (legal) name <span class="req">*</span></label><input type="text" id="legal" value="'+esc(inv.vendor_name||'')+'"></div>'
      +'<div><label class="fld">Trade name</label><input type="text" id="trade"></div>'
      +'<div><label class="fld">We supply</label><select id="vtype"><option value="supplier">Materials (supplier)</option><option value="service">Services</option><option value="both">Both materials and services</option></select></div>'
      +'<div><label class="fld">GSTIN</label><input type="text" id="gst" class="up" maxlength="15"></div>'
      +'<div><label class="fld">PAN</label><input type="text" id="pan" class="up" maxlength="10"></div>'
      +'<div><label class="fld">MSME / Udyam number</label><input type="text" id="msme"></div>'
      +'<div><label class="fld">Usual payment terms</label><input type="text" id="terms" placeholder="e.g. 30 days from invoice"></div></div>'
      +'<h2>Address</h2><div class="grid"><div class="full"><label class="fld">Address</label><input type="text" id="addr"></div>'
      +'<div><label class="fld">City</label><input type="text" id="city"></div><div><label class="fld">State</label><input type="text" id="state"></div>'
      +'<div><label class="fld">PIN code</label><input type="text" id="pin" maxlength="6" inputmode="numeric"></div></div>'
      +'<h2>Contacts</h2><div id="contacts">'+contactRow(true)+'</div><button type="button" class="add" onclick="vrAddContact()">+ Add a contact</button>'
      +'<h2>Bank account</h2><div id="banks"></div><button type="button" class="add" onclick="vrAddBank()">+ Add a bank account</button>'
      +(groups.length?'<h2>What you supply</h2><div class="groups">'+groupTree().map(x=>'<label style="padding-left:'+(x.depth*16)+'px"><input type="checkbox" class="g" value="'+x.g.id+'"> '+esc(x.g.name)+'</label>').join('')+'</div>':'')
      +'<h2>Documents</h2><p class="hint" style="margin:-4px 0 12px">PDF, JPG or PNG, up to 8 MB each.</p>'
      +DOCS.map(d=>'<div class="doc"><div class="t">'+d[1]+'<small>'+d[2]+'</small></div><div><input type="file" accept=".pdf,.jpg,.jpeg,.png" onchange="vrUpload(\''+d[0]+'\',this)"><div class="st" id="st_'+d[0]+'"></div></div></div>').join('')
      +'<div class="hp" aria-hidden="true"><label>Website <input type="text" id="website" tabindex="-1" autocomplete="off"></label></div>'
      +'<div id="msg" class="err" style="display:none"></div>'
      +'<div style="margin-top:26px"><button class="btn" id="go" onclick="vrSubmit()">Submit registration</button></div>';
  }

  window.vrAddContact=function(){ document.getElementById('contacts').insertAdjacentHTML('beforeend',contactRow(false)); };
  window.vrAddBank=function(){ document.getElementById('banks').insertAdjacentHTML('beforeend',bankRow()); };

  window.vrUpload=async function(type,input){
    const st=document.getElementById('st_'+type), f=input.files&&input.files[0];
    if(!f) return;
    if(f.size>8*1024*1024){ st.className='st bad'; st.textContent='That file is larger than 8 MB.'; input.value=''; delete uploaded[type]; return; }
    st.className='st'; st.textContent='Uploading…';
    const fd=new FormData(); fd.append('token',token); fd.append('doc_type',type); fd.append('file',f);
    let out;
    try{ const res=await fetch(URL_FN,{method:'POST',body:fd}); out=await res.json().catch(()=>({error:'Unexpected response'})); if(!res.ok&&!out.error) out.error='Upload failed (status '+res.status+')'; }
    catch(e){ out={error:'Could not reach the server.'}; }
    if(out.error||!out.storage_path){ st.className='st bad'; st.textContent=out.error||'Upload failed.'; input.value=''; delete uploaded[type]; return; }
    uploaded[type]={doc_type:type,storage_path:out.storage_path,file_name:out.file_name};
    st.className='st ok'; st.textContent='✓ '+out.file_name;
  };

  const v=id=>{const e=document.getElementById(id);return e?e.value.trim():'';};
  function fail(m){ const e=document.getElementById('msg'); e.textContent=m; e.style.display='block'; e.scrollIntoView({behavior:'smooth',block:'center'}); return false; }

  window.vrSubmit=async function(){
    document.getElementById('msg').style.display='none';
    const gst=v('gst').toUpperCase(), pan=v('pan').toUpperCase(), pin=v('pin');
    if(!v('legal')) return fail('Please give your registered (legal) name.');
    if(gst&&!GST_RE.test(gst)) return fail('That GSTIN does not look right (15 characters).');
    if(pan&&!PAN_RE.test(pan)) return fail('That PAN does not look right (e.g. ABCDE1234F).');
    if(gst&&pan&&gst.slice(2,12)!==pan) return fail('The PAN inside your GSTIN does not match the PAN you entered.');
    if(pin&&!/^\d{6}$/.test(pin)) return fail('PIN code is 6 digits.');
    const contacts=[...document.querySelectorAll('.contact')].map(d=>({name:d.querySelector('.c-name').value.trim(),designation:d.querySelector('.c-role').value.trim(),
      email:d.querySelector('.c-email').value.trim().toLowerCase(),phone:d.querySelector('.c-phone').value.trim(),is_primary:d.querySelector('.c-prim').checked,gets_rfq:d.querySelector('.c-rfq').checked}))
      .filter(c=>c.name||c.email||c.phone);
    if(!contacts.length||contacts.some(c=>!c.name)) return fail('Please add at least one contact, each with a name.');
    if(!contacts.some(c=>c.email)) return fail('At least one contact needs an email address.');
    if(contacts.some(c=>c.email&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email))) return fail('One of the email addresses does not look right.');
    const banks=[...document.querySelectorAll('.bank')].map(d=>({bank_name:d.querySelector('.b-bank').value.trim(),account_name:d.querySelector('.b-name').value.trim(),
      account_no:d.querySelector('.b-no').value.trim(),ifsc:d.querySelector('.b-ifsc').value.trim().toUpperCase(),branch:d.querySelector('.b-branch').value.trim(),is_default:false}))
      .filter(b=>b.bank_name||b.account_no||b.ifsc);
    if(banks.some(b=>!b.bank_name||!b.account_no)) return fail('Each bank account needs the bank name and the account number.');
    if(banks.some(b=>b.ifsc&&!IFSC_RE.test(b.ifsc))) return fail('An IFSC code does not look right (e.g. HDFC0001234).');
    if(banks.length) banks[0].is_default=true;
    if(pan&&!uploaded.pan) return fail('Please upload a copy of your PAN card.');
    if(gst&&!uploaded.gst_certificate) return fail('Please upload your GST registration certificate.');
    if(banks.length&&!uploaded.cancelled_cheque) return fail('Please upload a cancelled cheque for your bank account.');
    const btn=document.getElementById('go'); btn.disabled=true; btn.textContent='Submitting…';
    const out=await call({action:'submit',website:v('website'),legal_name:v('legal'),trade_name:v('trade'),vendor_type:v('vtype'),gstin:gst,pan,msme_no:v('msme'),
      address:v('addr'),city:v('city'),state:v('state'),pincode:pin,payment_terms:v('terms'),contacts,banks,
      group_ids:[...document.querySelectorAll('.g:checked')].map(c=>parseInt(c.value,10)),documents:Object.values(uploaded)});
    if(out.error){ btn.disabled=false; btn.textContent='Submit registration'; return fail(out.error); }
    app.innerHTML='<div class="center"><div class="ok-check">✓</div><h1>Thank you</h1><p class="sub" style="margin-bottom:0">'+esc(out.message||'Your registration has reached us.')+'</p></div>';
  };

  (async function(){
    const out=await call({action:'get'});
    if(out.error){ app.innerHTML='<h1>Registration link</h1><p class="sub" style="margin-bottom:0">'+esc(out.error)+'</p>'; return; }
    render(out);
  })();
})();
