/* Digital Booking Form - Dream Ananta (2 Nov 2026).
   The paper Ananta booking form (Page 1 of 6 + Terms, Declaration, Special Conditions), made for a
   customer filling it alone on a phone, anywhere. Shaped with the user's review (2 Nov 2026):
     - eight short steps, one subject at a time, each in its own card with its own heading
     - any number of applicants (up to 6); joint applicants are asked less (no date of birth); only
       the first applicant signs
     - fixed answers are tap-to-choose buttons with the most common answer already chosen (from the
       Ananta forms received so far: Mr., S/o, Salaried, Facebook, Construction Linked, 3 BHK, Covered)
     - Nationality is a country list with round flags, India first; passport and bank details are
       always shown (required only for NRIs / foreigners)
     - PAN must look like a PAN, Aadhaar is spaced 1234 5678 9012 as it is typed, and no two
       applicants may give the same PAN or Aadhaar
     - addresses are just address, city and PIN, with suggestions while typing (OpenStreetMap's
       Photon service)
     - every required box still empty is tinted; pressing Continue too early lists what is missing
     - PAN and Aadhaar are attached as photos or PDFs, straight from the phone camera
     - the signature is drawn smoothly, and only inside its box
     - answers (not files or signatures) are kept on the customer's own phone until they submit
   Submitting posts everything to the booking-form-public edge function, which checks it all again
   and saves it (acc.digital_booking_forms). This page never talks to the database. */
(function(){
'use strict';
const FN='https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/booking-form-public';
const PROJECT=(new URLSearchParams(location.search).get('p')||'ananta').toLowerCase();
const CONF={ananta:{name:'Dream Ananta',company:'Dream Gateway Hotels Ltd.',blocks:['Block D','Block E'],floors:8,
  bhk:['2 BHK','3 BHK','4 BHK'],bhkDefault:'3 BHK'}}[PROJECT];
const DRAFT_KEY='jg-booking-form-'+PROJECT+'-v2';
const MAX_APPS=6, MAX_REASONS=5;
const STEPS=[['Applicants','👥'],['Contact & address','🏠'],['About you','💼'],['Your flat','🏢'],['Payment','💳'],['PAN & Aadhaar','📄'],['Terms & signature','✍️'],['Check & submit','✅']];

// [name, ISO code for the flag, dialling code]
const COUNTRIES=[['India','in','+91'],['United Arab Emirates','ae','+971'],['United States','us','+1'],['United Kingdom','gb','+44'],
  ['Canada','ca','+1'],['Australia','au','+61'],['Singapore','sg','+65'],['Saudi Arabia','sa','+966'],['Qatar','qa','+974'],
  ['Kuwait','kw','+965'],['Oman','om','+968'],['Bahrain','bh','+973'],['Bangladesh','bd','+880'],['Nepal','np','+977'],
  ['Bhutan','bt','+975'],['Germany','de','+49'],['France','fr','+33'],['Netherlands','nl','+31'],['Ireland','ie','+353'],
  ['New Zealand','nz','+64'],['Malaysia','my','+60'],['Japan','jp','+81'],['Hong Kong','hk','+852'],['South Africa','za','+27'],
  ['Kenya','ke','+254'],['Nigeria','ng','+234'],['Sri Lanka','lk','+94'],['Thailand','th','+66'],['Italy','it','+39'],['Switzerland','ch','+41']];
const flagUrl=function(code){ return 'https://flagcdn.com/w80/'+code+'.png'; };
const byName=function(n){ return COUNTRIES.filter(function(c){ return c[0]===n; })[0]; };
const byDial=function(d){ return COUNTRIES.filter(function(c){ return c[2]===d; })[0]; };

// ---------------------------------------------------------------- state
function newApp(){ return {title:'Mr.',full_name:'',relation:'S/o',relation_name:'',dob:'',occupation:'Salaried',nationality:'India',
  pan:'',aadhaar:'',passport:'',bank_details:'',spouse:'',anniversary:''}; }
function fresh(){ return {project:PROJECT,step:0,applicants:[newApp()],
  contact:{cc:'+91',mobile:'',email:'',contact_person:''},
  res:{line:'',city:'',pin:''},off:{on:false,line:'',city:'',pin:''},
  mailing:'Residential',permanent:'Residential',
  profession:{kind:'Salaried',company:'',designation:''},
  heard:'Facebook',heard_other:'',why:[''],
  flat:{block:'',floor:'',flat_no:'',bhk:CONF?CONF.bhkDefault:'',parking:'Covered'},
  price:{total:'',rate:'',loan:'No',bank:'',plan:'Construction Linked'},
  pay:{mode:'UPI / NEFT / RTGS',amount:'',ref:'',bank:'',branch:'',date:''},
  purpose:'Residential',sales:'Direct',sales_name:'',lead_id:'',terms_accepted:false}; }
let S; try{ S=Object.assign(fresh(),JSON.parse(localStorage.getItem(DRAFT_KEY)||'null')||{}); }catch(e){ S=fresh(); }
if(!Array.isArray(S.applicants)||!S.applicants.length) S.applicants=[newApp()];
if(!Array.isArray(S.why)||!S.why.length) S.why=[''];
// Files and the signature live only in this page (too big for the draft).
let FILES=S.applicants.map(function(){ return {pan:[],aadhaar:[]}; });
let SIG=null;
let ERR={}, MISSING=[];
const $=function(id){ return document.getElementById(id); };
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function save(){ try{ localStorage.setItem(DRAFT_KEY,JSON.stringify(S)); }catch(e){} }
function get(path){ return path.split('.').reduce(function(o,k){ return o==null?o:o[k]; },S); }
function set(path,v){ const ks=path.split('.'); let o=S; for(let i=0;i<ks.length-1;i++) o=o[ks[i]]; o[ks[ks.length-1]]=v; save(); }
function toast(m){ const t=document.createElement('div'); t.className='toast'; t.textContent=m; document.body.appendChild(t); setTimeout(function(){ t.remove(); },2600); }
const fid=function(path){ return 'f-'+path.replace(/\./g,'-'); };

// ---------------------------------------------------------------- building blocks
function card(icon,color,title,hint,body){
  return '<div class="sec"><div class="sh"><div class="ic" style="background:'+color+'1f;color:'+color+'">'+icon+'</div><div><h2>'+title+'</h2>'+(hint?'<p>'+hint+'</p>':'')+'</div></div><div class="sb">'+body+'</div></div>';
}
function wrapF(path,label,o,inner){
  return '<div class="f'+(o.full?' full':'')+(o.req?' need':'')+(ERR[path]?' bad':'')+'" id="'+fid(path)+'"><label>'+esc(label)
    +(o.req?' <span class="req">*</span>':(o.optional?' <span class="opt">(optional)</span>':''))+(o.note?' <span class="opt">'+esc(o.note)+'</span>':'')+'</label>'
    +inner+'<div class="err">'+esc(ERR[path]||'')+'</div></div>';
}
function field(path,label,o){
  o=o||{}; const v=get(path);
  const ph=' placeholder="'+esc(o.ph||' ')+'"';
  const ctl=o.type==='area'?'<textarea data-k="'+path+'"'+ph+'>'+esc(v)+'</textarea>'
    :'<input type="'+(o.type||'text')+'" data-k="'+path+'" value="'+esc(v)+'"'+ph+(o.cls?' class="'+o.cls+'"':'')
      +(o.mode?' inputmode="'+o.mode+'"':'')+(o.max?' maxlength="'+o.max+'"':'')+' autocomplete="'+(o.auto||'off')+'"'+(o.req&&o.type==='date'?' required':'')+'>';
  return wrapF(path,label,o,(o.before||'')+ctl+(o.after||''));
}
function chips(path,label,options,o){
  o=o||{}; const v=get(path);
  return wrapF(path,label,Object.assign({full:o.full!==false},o),'<div class="chips'+(o.num?' num':'')+(o.sm?' sm':'')+'" role="radiogroup">'
    +options.map(function(x){ const val=Array.isArray(x)?x[0]:x, txt=Array.isArray(x)?x[1]:x;
      return '<button type="button" class="chip'+(v===val?' on':'')+'" role="radio" aria-checked="'+(v===val)+'" data-chip="'+path+'" data-v="'+esc(val)+'">'+esc(txt)+'</button>'; }).join('')+'</div>');
}
// A dropdown that looks like the rest of the form: a button that opens a list (a sheet on phones).
function pick(path,label,kind,o){
  o=o||{}; const v=get(path);
  let shown=esc(v||o.blank||'Choose');
  if(kind==='country'){ const c=byName(v); shown=(c?'<img class="flag" src="'+flagUrl(c[1])+'" alt="">':'')+'<span class="v">'+esc(v)+'</span>'; }
  else if(kind==='dial'){ const c=byDial(v); shown=(c?'<img class="flag" src="'+flagUrl(c[1])+'" alt="">':'')+'<span class="v">'+esc(v)+'</span>'; }
  else shown='<span class="v">'+shown+'</span>';
  const btn='<button type="button" class="pick" data-pick="'+path+'" data-kind="'+kind+'">'+shown+'</button>';
  return o.bare?btn:wrapF(path,label,o,btn);
}
function openSheet(path,kind){
  const isC=kind==='country'||kind==='dial';
  const list=isC?COUNTRIES.filter(function(c,i,a){ return kind!=='dial'||a.findIndex(function(x){ return x[2]===c[2]; })===i; }):[];
  const bg=document.createElement('div'); bg.className='sheet-bg';
  const draw=function(q){ q=(q||'').toLowerCase();
    return list.filter(function(c){ return !q||c[0].toLowerCase().indexOf(q)>=0||c[2].indexOf(q)>=0; }).map(function(c){
      const val=kind==='dial'?c[2]:c[0], on=get(path)===val;
      return '<button type="button" class="op'+(on?' on':'')+'" data-val="'+esc(val)+'"><img class="flag" src="'+flagUrl(c[1])+'" alt="">'+esc(c[0])+(kind==='dial'?'<small>'+c[2]+'</small>':'')+'</button>'; }).join('')
      ||'<div style="padding:14px;color:var(--slate)">No match</div>'; };
  bg.innerHTML='<div class="sheet" role="dialog"><div class="st">'+(kind==='dial'?'Country code':'Choose country')+'<button type="button" data-close="1" aria-label="Close">×</button></div>'
    +'<input type="text" placeholder="Search" autocomplete="off"><div class="ls">'+draw('')+'</div></div>';
  document.body.appendChild(bg);
  const inp=bg.querySelector('input'), ls=bg.querySelector('.ls');
  inp.addEventListener('input',function(){ ls.innerHTML=draw(inp.value); });
  bg.addEventListener('click',function(e){
    if(e.target===bg||e.target.closest('[data-close]')){ bg.remove(); return; }
    const op=e.target.closest('.op'); if(!op) return;
    set(path,op.getAttribute('data-val')); delete ERR[path]; bg.remove(); render();
  });
}

// ---------------------------------------------------------------- steps
function stepApplicants(){
  return card('👥','#c4161c','Who is booking?','Everyone whose name goes on the flat. You can add more people at the bottom.',
    S.applicants.map(function(a,i){
      const p='applicants.'+i+'.', foreign=a.nationality!=='India';
      /* One column, in small labelled groups, so a person always knows which part they are on:
         who they are, then their ID documents, then (first applicant only, folded away) family. */
      const F={full:1};
      return '<div class="app"><div class="ah"><span class="num">'+(i+1)+'</span><b>'+(i?'Joint applicant':'First / sole applicant')+'</b>'
          +(i?'<button type="button" class="rm" data-rm="'+i+'">Remove</button>':'')+'</div>'
        +'<div class="grp">Personal details</div><div class="stack">'
        +chips(p+'title','Title',['Mr.','Ms.','Mrs.','Mast.','M/s.'],{sm:1})
        +field(p+'full_name','Full name (as on PAN card)',{req:1,full:1,cls:'up',auto:i?'off':'name'})
        +chips(p+'relation','Son / Daughter / Wife / Care of',['S/o','D/o','W/o','C/o'],{sm:1})
        +field(p+'relation_name',({'S/o':"Father's",'D/o':"Father's",'W/o':"Husband's",'C/o':"Guardian's"}[a.relation]||"Father's")+' name',{req:1,full:1,cls:'up'})
        +(i===0?field(p+'dob','Date of birth',{type:'date',req:1,full:1}):'')
        +chips(p+'occupation','Occupation',['Salaried','Business'],{sm:1})
        +'</div><div class="grp">Identity documents</div><div class="stack">'
        +pick(p+'nationality','Nationality / Country','country',F)
        +field(p+'pan','PAN number',{cls:'up',max:10,ph:'ABCDE1234F',req:!foreign,optional:foreign,full:1})
        +field(p+'aadhaar','Aadhaar number',{mode:'numeric',max:14,ph:'1234 5678 9012',optional:1,full:1})
        +field(p+'passport','Passport number',{cls:'up',req:foreign,note:foreign?'':'(only for NRIs & foreigners)',full:1})
        +field(p+'bank_details','Bank account details',{type:'area',full:1,ph:'Bank, account number, branch, SWIFT / IFSC',req:foreign,note:foreign?'':'(only for NRIs & foreigners)'})
        +'</div>'
        +(i===0?'<details class="t opt-d"'+(a.spouse||a.anniversary?' open':'')+'><summary>Spouse & anniversary <span class="opt">(optional)</span></summary><div class="stack" style="padding:0 14px 14px">'
          +field(p+'spouse','Spouse name',{optional:1,cls:'up',full:1})+field(p+'anniversary','Marriage anniversary',{type:'date',optional:1,full:1})+'</div></details>':'')
        +'</div>';
    }).join('')
    +(S.applicants.length<MAX_APPS?'<button type="button" class="btn add" data-add="1">＋ Add another applicant</button>':''));
}
function addrBody(k){
  return '<div class="grid">'
    +'<div class="full ac">'+field(k+'.line','House, street and area',{type:'area',full:1,req:k==='res'||S.off.on,ph:'Start typing - suggestions will appear'})+'<div id="ac-'+k+'"></div></div>'
    +field(k+'.city','City / Town',{req:1,auto:k==='res'?'address-level2':'off'})
    +field(k+'.pin','PIN code',{mode:'numeric',max:6,req:1,auto:k==='res'?'postal-code':'off'})+'</div>';
}
function stepContact(){
  const a=S.applicants[0];
  return card('📞','#2563eb','How we reach you','For '+esc(a.full_name||'the first applicant')+'. Every letter and receipt comes here.',
      '<div class="grid">'
      +field('contact.mobile','Mobile number',{type:'tel',req:1,full:1,mode:'tel',auto:'tel-national',
        before:'<div class="pre">'+pick('contact.cc','','dial',{bare:1}),after:'</div>'})
      +field('contact.email','Email',{type:'email',req:1,full:1,auto:'email',mode:'email'})
      +field('contact.contact_person','Name of contact person',{optional:1,full:1})+'</div>')
    +card('🏠','#c4161c','Residential address','Where you live now.',addrBody('res'))
    +card('🏢','#7c3aed','Office address','Optional.',
      '<label class="switch"><input type="checkbox" data-check="off.on"'+(S.off.on?' checked':'')+'><span><b>I want to add an office address</b></span></label>'
      +(S.off.on?'<div style="margin-top:16px">'+addrBody('off')+'</div><div class="grid" style="margin-top:16px">'
        +chips('mailing','Send our letters to',['Residential','Office'])+chips('permanent','Permanent address is my',['Residential','Office'])+'</div>':''));
}
function stepAbout(){
  return card('💼','#0d9488','Your work','',
      '<div class="grid">'+chips('profession.kind','Profession',['Salaried','Self-Employed','Govt. Employee','Others'])
      +field('profession.company','Company',{optional:1})+field('profession.designation','Designation',{optional:1})+'</div>')
    +card('📣','#ea580c','About this project','',
      '<div class="grid">'
      +chips('heard','How did you come to know about the project?',['Facebook','Instagram','Google','Friend / Relative','Other'])
      +(S.heard==='Other'?field('heard_other','Where did you hear about it?',{full:1,req:1}):'')
      +'<div class="f full"><label>Why did you choose this project? <span class="opt">(optional)</span></label>'
        +S.why.map(function(w,i){ return '<div style="display:flex;gap:8px;align-items:center"><span class="num" style="width:26px;height:26px;border-radius:50%;background:#f1ede6;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex:none">'+(i+1)+'</span>'
          +'<input type="text" data-k="why.'+i+'" value="'+esc(w)+'" placeholder=" " autocomplete="off">'
          +(i?'<button type="button" class="rm lnk" style="color:var(--err);padding:8px" data-rmwhy="'+i+'" aria-label="Remove">×</button>':'')+'</div>'; }).join('')
        +(S.why.length<MAX_REASONS?'<button type="button" class="lnk" data-addwhy="1">＋ Add another reason</button>':'')
      +'</div></div>');
}
function stepFlat(){
  const floors=[]; for(let i=1;i<=(CONF.floors||8);i++) floors.push(String(i));
  return card('🏢','#c4161c','Flat choice','As discussed with our sales team. Leave the flat number empty if it is not fixed yet.',
      '<div class="grid">'
      +chips('flat.block','Block',CONF.blocks,{req:1})
      +chips('flat.floor','Floor',floors,{num:1})
      +field('flat.flat_no','Flat number',{cls:'up',ph:'e.g. 5A',max:8,optional:1})
      +chips('flat.bhk','Bedrooms',CONF.bhk)
      +chips('flat.parking','Right to use car park',['Covered','Open'])+'</div>')
    +card('🧾','#2563eb','Price & payment plan','',
      '<div class="grid">'
      +field('price.total','Total sale price agreed (₹)',{mode:'numeric',optional:1,after:'<div class="words" id="w-total">'+esc(words(S.price.total))+'</div>'})
      +field('price.rate','Rate per sq.ft. (₹)',{mode:'numeric',optional:1})
      +chips('price.plan','Payment plan',['Construction Linked','Down Payment'])
      +chips('price.loan','Home loan required?',['No','Yes'])
      +(S.price.loan==='Yes'?field('price.bank','Preferred bank / institution',{optional:1,full:1}):'')+'</div>');
}
function stepPay(){
  const chq=S.pay.mode==='Cheque'||S.pay.mode==='Demand Draft';
  return card('💳','#15803d','Application payment','The booking amount you have paid, in favour of <b>'+esc(CONF.company)+'</b>. We never take cash.',
      '<div class="grid">'
      +chips('pay.mode','Paid by',['UPI / NEFT / RTGS','Cheque','Demand Draft','Card'])
      +field('pay.amount','Amount (₹)',{mode:'numeric',req:1,after:'<div class="words" id="w-amount">'+esc(words(S.pay.amount))+'</div>'})
      +field('pay.date',chq?'Cheque / DD date':'Date paid',{type:'date',req:1})
      +field('pay.ref',({'Cheque':'Cheque number','Demand Draft':'DD number','Card':'Card transaction ID'}[S.pay.mode]||'UTR / transaction reference'),{req:1,cls:'up'})
      +field('pay.bank','Bank (drawn on)',{req:chq,optional:!chq})
      +(chq?field('pay.branch','Branch',{optional:1}):'')+'</div>')
    +card('📝','#7c3aed','Booking','',
      '<div class="grid">'
      +chips('purpose','Purpose of booking',['Residential','Investment'])
      +chips('sales','Booked through',['Direct','Booking agent / Channel partner'])
      +field('sales_name',S.sales==='Direct'?'Name of our sales person':'Name of agent / channel partner',{optional:S.sales==='Direct',req:S.sales!=='Direct'})
      +field('lead_id','Lead ID',{optional:1,ph:'If our team gave you one'})+'</div>');
}
function words(n){
  n=Math.floor(Number(n)); if(!n||n<0) return '';
  const a=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const b=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const two=function(x){ return x<20?a[x]:b[Math.floor(x/10)]+(x%10?' '+a[x%10]:''); };
  const three=function(x){ return (x>=100?a[Math.floor(x/100)]+' Hundred'+(x%100?' ':''):'')+(x%100?two(x%100):''); };
  const out=[]; const cr=Math.floor(n/1e7); n%=1e7; const lk=Math.floor(n/1e5); n%=1e5; const th=Math.floor(n/1e3); n%=1e3;
  if(cr) out.push(three(cr)+' Crore'); if(lk) out.push(two(lk)+' Lakh'); if(th) out.push(two(th)+' Thousand'); if(n) out.push(three(n));
  return 'Rupees '+out.join(' ')+' only';
}
function fileList(i,kind){
  return FILES[i][kind].map(function(f,n){
    const img=/^image\//.test(f.type)?'<img src="'+URL.createObjectURL(f)+'" alt="">':'<div class="pdf">PDF</div>';
    return '<div class="file">'+img+'<span>'+esc(f.name)+'</span><button type="button" data-delfile="'+i+'|'+kind+'|'+n+'" aria-label="Remove">×</button></div>';
  }).join('');
}
function stepDocs(){
  return S.applicants.map(function(a,i){
    const foreign=a.nationality!=='India';
    const box=function(kind,label){ const k='doc.'+i+'.'+kind;
      return wrapF(k,label,{full:1,req:!foreign,optional:foreign},'<div class="upl">'+fileList(i,kind)
        +(FILES[i][kind].length<2?'<label class="pk">📷 '+(FILES[i][kind].length?'Add another':'Add photo or PDF')+'<input type="file" accept="image/*,application/pdf" data-file="'+i+'|'+kind+'"></label>':'')+'</div>'); };
    return card('📄','#c4161c',esc(a.full_name||('Applicant '+(i+1))),(i?'Joint applicant':'First applicant')+'. Take a clear photo or attach a PDF. Aadhaar: front and back are fine as two photos.',
      '<div class="grid">'+box('pan','PAN card')+box('aadhaar','Aadhaar card')+'</div>');
  }).join('');
}
const TERMS=[
 'This application is only a request of the applicant for allotment of the unit/units and does not create any right whatsoever or howsoever of the applicant.',
 'The Company reserves its right not to accept the said applications and also the right to allot/transfer the units to any other person without any consent.',
 'The Company at its absolute discretion shall be entitled to reject the application without assigning any reason whatsoever or howsoever.',
 'If the applicant cancels, withdraw the application within 15 days, then in that event the Company will be entitled to deduct a sum equivalent to Rs. 50,000/- (Rupees FiftyThousand only) + GST of the application money and the applicant hereby consents to the same.',
 'After the lapse of 15 days from the day of application and non rejection by developers, all the clauses of the Sales Agreement will prevail, including the cancellation clauses.The builder is entitled to deduct 10% of apartment cost as penal charges in case of cancellation after 15 days.',
 'The Applicant and Company agree that no oral commitment would be valid unless backed by written confirmation.',
 'Please note that w.e.f. July 2017, GST would be collected with each instalment. More details can be sought at www.gst.gov.in.',
 'The financing of proposed flat/home loan procedure is the responsibility of the applicant only. The developer/ marketing agent or any of their representatives are in no way responsible for sanction, disbursal or delay of any of the banking formalities. Delay charges applicable.',
 'All cheques are to be made in favour of "Dream Gateway Hotels Ltd." The Company and/or its executives do not deal in any form of cash transaction whatsoever.',
 'Nomination charges are 4% of the prevailing market price of Unit as would be informed to the Applicant.',
 'The Applicant agrees that small or minor change in area is acceptable in view of the pre-launch nature of the current application and agrees not to raise any objections and hereby waives his/her rights in that regard.',
 'In the event of withdrawal, cancellation or termination of provisional allocation of the Unit as aforesaid, the Developer shall be entitled to deal with and/or dispose of the Unit in the manner it deems fit and proper and the Applicant shall not and waives his right to make any claim or raise any objection in this regard whether refund has been effected or not.',
 'In addition to the Consideration Value and the Additional Charges, the Applicant shall also be liable to pay on Stamp Duty and Registration charge. In case of liability arising in valuation of unit or laws 50 C or any similar government levies or taxes on Allottee/Unit developer, the liability so arises shall be done by the allottee limited to his Unit only. All levies, duties, charges, surcharges, rates taxes and outgoings including service tax, sales tax, VAT, Works Contract Tax, betterment development charges etc.that may be payable relating to the construction, transfer, ownership or maintenance of the Apartment booked by me/us and/or the amounts payable for the same and/or relating to this Application, the Agreement for Sale and or the Deed of Conveyance shall be the liability of the Allottee and the Allottee undertakes to make payment of the same in time.',
 'It shall be the responsibility of the Applicant to ensure to take the money receipts duly filled in and signed on your behalf acknowledging submission of the enclosed bank draft/cheque together with this Application Form as this Pay-in-Slip is to be treated as the acknowledgement of the receipt of remittance as well as of the completed',
 'All the contents of this Application Form are true to the best of my/our knowledge and nothing relevant has been concealed or suppressed.'];
const DECL=[
 'I/We have seen the proposed plan of the project and am/are desirous of purchasing an apartment in this complex. I/We have signed the application form for allotment and the Declaration after reading and understanding the same. All the terms, condition obligations, considerations etc. contained therein are fully acceptable to and agreeable by me/us and I/we confirm my/our unconditional acceptance of the same. I/We agree to sign your standard agreement for sale on stamp papers as per your requirements within 15 days of this booking. Or as and when requested.',
 'The layout plans and building plans, dimensions elevation, colour scheme, specifications of the building(s)/ complex of the apartment are tentative and subject to variation. The owner/Developer may effect such variations, additions, alterations, deletions and /or modifications therein as it may, at its sole discretion, deem appropriate and fit or as may be directed by any competent authority. No complain regarding design, layout and accommodation shall be entertained.'];
const SPECIAL=[
 'Advance Maintenance charges, deposits, electrical meter deposit, electrical connection charges, water connection charges, documentation/legal charges, Society formation charges and other charges may be applicable, shall be separately charged along with applicable taxes thereon.',
 'If the Allotee(s) fail to take possession within Thirty (30) days from the date of intimation in writing by Developer, then the Allotee(s) shall be liable to pay holding charges to Developers as per the decision of the developer for the entire period of such delay. Furthermore, no request for work/repairs/correction shall be entertained by the Developer after the above time has passed.',
 'Right-to-use car parking facility will be provided in the complex subject to availability. It comprises of Open & Covered parking, Parking spaces will be allotted by the Developer. Car Parking space can be dependent, independent, covered by building, basement or asbestos shed as builder may deem fit. The total number of car parks as mentioned in the marketing documents and/or brochures are merely indicative and the exact number thereof can only be known after completion of the respective building/tower. It is further agreed that in case the number of application car parks are more than the actual number of car parks available, their allotment will be made on the basis of first applied first served depending upon the number of applications and the availability of the same on or before final possession. Jain group has the option to cancel allotment of parking space if payments are not made regularly.<br><br>Earmarking of specific parking space will be done at time of giving of possession of the Residential Apartment. Each allotted parking space will entitle the Allottee(s) the right to park only one vehicle In case of transfer of Residential Apartment, the right to use the parking space shall be automatically transferred along with the Residential Apartment.The right to use the parking space under no circumstances is separately transferable. The right to use parking space(s) shall not conform upon the Allottee(s) any right of ownership of the space on which such parking facility is provided. Unallotted parking space, if any, shall continue to remain the property and in possession of Jain Group. It shall be the discretion of Jain Group to allot/use these unalloted parking spaces as it may decide, at its sole discretion.',
 'The Allottee(s) shall from time to time sign all applications, papers, documents, maintenance agreement, electricity agreement and other revenant papers, as required in pursuance to the allotment and to do all acts, deeds and things as Jain Group may require in the interest of the complex and Apartment. In case of Joint Allotee, any document signed/accepted acknowledge by any one of the Allottee(s) shall be binding upon the other Allottee.',
 'The Allottee(s) undertakes to join any society association of Residential Apartment Owners and to pay any fees, charges thereof and complete such documentation and formalities as may be deemed necessary by Jain Group in its sole discretion for this purpose.',
 'Jain Group reserves the right to create changes on this complex for obtaining development and other finance from credit/financial intuition, bank or other person/body that has already or may hereafter advance credit, finance or loans to Jain Group and the Allottee(s) whenever asked in support of by Jain Group in this regard, shall give grant to Jain Group, his/her/their/its specific, full, free and unqualified consent and permission for doing the same and strict compliance of this condition on the part of the Allottee(s) shall be the essence of allotment of Residential Apartment. Failure on the part of the Allottee(s) to implement and comply with this essential condition will be treated as the breach of the said Allotment Letter and/or the Agreement (as the case may be), and Developer shall thereupon be entitled to cancel and terminate the said Allotment Letter and/or the Agreement (as the case may be). However on or before the execution of the Sale Deed, the respective Residential Apartment of the Alottee(s) will be free from all such encumberances.',
 'The Allottee gives his irrevocable consent to become member of Association of Residential Apartment owners. The Association of Residential Apartment owners will be required to be a member of such apex body and will be required to contribute proportionately towards contingency fund and towards maintenance expenses of all such areas and facilities. However Developer will charge the individual Allottee(s), from the date of notice of possession the required maintenance fee till such time the Association of Residential Apartment owners take over the management and maintenance of the complex. In the event of the individual society/Association of Residential Apartment owners of each building is formed, Jain Group may retain the maintenance deposit till the completion of the complex for maintenance of common infrastructure. The balance deposit if any remaining shall be handed over hereafter either to the respective society/Association of Residential Apartment owners or to the Apex Body after adjusting all unpaid dues of any and all Allottees.',
 'The Terms and Condition contained here shall be deemed to form part of the Agreement by the Applicant(s)/ Allottee(s) and all the allotment shall be strictly subject to these Terms and Conditions. All designs, measurements, specifications mentioned and stated therein are tentative and subject to changes.',
 'The Allottee understands that conveyance/registration of the unit in question shall be effected after all formalities including society but not limited to Association formation are completed.The Allottee shall raise no objection towards the same.',
 'In addition to the Applicant(s)/Allottee(s) liability to pay interest as mentioned herein above, the Applicant(s)/Allottee(s) shall be liable to pay and reimburse to Developer, all the cost, charges expenses and penalty/interest due to thereon, whatsoever, which are borne, paid and/or incurred by Developer for the purpose of enforcing payment of and recovering from the Applicant(s)/Allottee(s) any amount/s or duels whatsoever payable by the Applicant(s)/Allottee(s) under this Application Form or the Allotment Letter (when issued) or the Agreement Sale Deed (when executed).',
 'All correspondence will be made with first Applicants at the address for correspondence on Developer\'s record initially indicated in the Application Form. Any change of address will have to be notified in writing to Developer\'s at its registered office and acknowledgement obtained for such change. In case there is a joint Allottee, all communication shall be sent by to the first Allottee and which shall for all purposes be considered as served on both Allottees. It is the responsibility of the Allottee to provide postal and email address as well as contact numbers. Inability to contact the customer and the resultant consequences are the sole responsibility/liability of the customer. The communication shall be deemed delivered and accepted by the customer unless otherwise objected.'];
function stepTerms(){
  const list=function(arr){ return '<ol>'+arr.map(function(t){ return '<li>'+esc(t).replace(/&lt;br&gt;&lt;br&gt;/g,'<br><br>')+'</li>'; }).join('')+'</ol>'; };
  const a=S.applicants[0];
  return card('📜','#2563eb','Terms & Conditions','Tap each heading to read it.',
      '<details class="t"><summary>Terms of application (15)</summary>'+list(TERMS)+'</details>'
      +'<details class="t"><summary>Declaration (2)</summary>'+list(DECL)+'</details>'
      +'<details class="t"><summary>Special Conditions (11)</summary>'+list(SPECIAL)+'</details>'
      +'<label class="agree'+(ERR.terms_accepted?' bad':'')+'" id="f-terms_accepted"><input type="checkbox" data-check="terms_accepted"'+(S.terms_accepted?' checked':'')+'><span><b>I/We have read and agree to all the above.</b><br><span style="color:var(--slate);font-size:13px">I/We confirm that everything in this form is true.</span><div class="err">'+esc(ERR.terms_accepted||'')+'</div></span></label>')
    +card('✍️','#c4161c','Signature',esc(a.full_name||'First applicant')+' signs with a finger (or mouse) inside the box.',
      wrapF('sig','Signature of the first applicant',{full:1,req:1},
        '<div class="pad"><canvas id="sigPad"></canvas><div class="line"></div>'+(SIG?'':'<div class="ph">Sign here</div>')
        +'<button type="button" class="x" data-clearsig="1">Clear</button></div>')
      +'<p style="color:var(--slate);font-size:13px;margin:12px 0 0">Place: '+esc(S.res.city||'—')+' · Date: '+new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})+'</p>');
}
function rows(pairs){ return '<table class="rv">'+pairs.filter(function(p){ return p[1]!==''&&p[1]!=null; }).map(function(p){ return '<tr><td>'+esc(p[0])+'</td><td>'+esc(p[1])+'</td></tr>'; }).join('')+'</table>'; }
function fmtD(d){ return d?new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):''; }
function addr(x){ return [x.line,x.city,x.pin].filter(Boolean).join(', '); }
function stepReview(){
  const h=function(t,step){ return '<div class="rvh"><h3>'+t+'</h3><button type="button" data-go="'+step+'">Edit</button></div>'; };
  return card('✅','#15803d','Please check everything','Tap Edit to change anything, then press Submit.',
    S.applicants.map(function(a,i){ return h((i?'Joint applicant '+(i+1):'First applicant'),0)+rows([
      ['Name',a.title+' '+a.full_name],[a.relation,a.relation_name],['Date of birth',i?'':fmtD(a.dob)],['Occupation',a.occupation],['Nationality',a.nationality],
      ['PAN',a.pan.toUpperCase()],['Aadhaar',a.aadhaar],['Passport',a.passport],['Bank details',a.bank_details],
      ['Spouse',i?'':a.spouse],['Anniversary',i?'':fmtD(a.anniversary)],
      ['Documents',(FILES[i].pan.length?'PAN ✓':'PAN —')+'  ·  '+(FILES[i].aadhaar.length?'Aadhaar ✓':'Aadhaar —')]]); }).join('')
    +h('Contact & address',1)+rows([['Mobile',S.contact.cc+' '+S.contact.mobile],['Email',S.contact.email],['Contact person',S.contact.contact_person],
      ['Residential address',addr(S.res)],['Office address',S.off.on?addr(S.off):''],['Letters to',S.off.on?S.mailing:''],['Permanent address',S.off.on?S.permanent:'']])
    +h('About you',2)+rows([['Profession',S.profession.kind],['Company',S.profession.company],['Designation',S.profession.designation],
      ['Heard about us from',S.heard==='Other'?S.heard_other:S.heard],['Why this project',S.why.filter(Boolean).map(function(w,i){ return (i+1)+'. '+w; }).join('   ')]])
    +h('Your flat',3)+rows([['Block',S.flat.block],['Floor',S.flat.floor],['Flat',S.flat.flat_no.toUpperCase()],['Bedrooms',S.flat.bhk],['Car park',S.flat.parking],
      ['Total sale price',S.price.total?'₹'+Number(S.price.total).toLocaleString('en-IN'):''],['Rate / sq.ft.',S.price.rate?'₹'+S.price.rate:''],['Payment plan',S.price.plan],
      ['Home loan',S.price.loan+(S.price.loan==='Yes'&&S.price.bank?' - '+S.price.bank:'')]])
    +h('Payment',4)+rows([['Amount',S.pay.amount?'₹'+Number(S.pay.amount).toLocaleString('en-IN')+' ('+words(S.pay.amount)+')':''],['Paid by',S.pay.mode],['Reference',S.pay.ref],
      ['Bank / branch',[S.pay.bank,S.pay.branch].filter(Boolean).join(', ')],['Date',fmtD(S.pay.date)],['Purpose',S.purpose],['Booked through',S.sales+(S.sales_name?' - '+S.sales_name:'')],['Lead ID',S.lead_id]])
    +h('Signature',6)+rows([['Signed by',SIG?(S.applicants[0].full_name+' ✓'):'Not yet']])
    +'<div class="hp" aria-hidden="true"><input tabindex="-1" autocomplete="off" id="hpWeb"></div>');
}

// ---------------------------------------------------------------- checks per step (the server checks again)
const PAN_RE=/^[A-Z]{5}[0-9]{4}[A-Z]$/;
const LABEL={};
function check(step){
  ERR={}; MISSING=[];
  const need=function(k,msg,lbl){ if(!String(get(k)||'').trim()){ ERR[k]=msg||'Please fill this in'; MISSING.push([k,lbl||msg]); } };
  const bad=function(k,msg,lbl){ ERR[k]=msg; MISSING.push([k,lbl||msg]); };
  if(step===0){
    const pans={}, aads={};
    S.applicants.forEach(function(a,i){ const p='applicants.'+i+'.', who=i?'Applicant '+(i+1)+': ':'';
      need(p+'full_name','Please write the full name',who+'Full name'); need(p+'relation_name',null,who+(a.relation==='W/o'?"Husband's":"Father's")+' name');
      if(i===0) need(p+'dob','Please choose the date of birth','Date of birth');
      const pan=a.pan.toUpperCase(), aad=a.aadhaar.replace(/\s/g,'');
      if(a.nationality==='India'&&!pan) bad(p+'pan','Please write the PAN number',who+'PAN number');
      else if(pan&&!PAN_RE.test(pan)) bad(p+'pan','PAN should look like ABCDE1234F',who+'PAN number');
      else if(pan&&pans[pan]!=null) bad(p+'pan','Same PAN as applicant '+(pans[pan]+1)+' - each applicant has their own',who+'PAN number repeated');
      if(pan) pans[pan]=pans[pan]==null?i:pans[pan];
      if(aad&&!/^\d{12}$/.test(aad)) bad(p+'aadhaar','Aadhaar should be 12 digits',who+'Aadhaar number');
      else if(aad&&aads[aad]!=null) bad(p+'aadhaar','Same Aadhaar as applicant '+(aads[aad]+1)+' - each applicant has their own',who+'Aadhaar number repeated');
      if(aad) aads[aad]=aads[aad]==null?i:aads[aad];
      if(a.nationality!=='India'){ need(p+'passport',null,who+'Passport number'); need(p+'bank_details',null,who+'Bank account details'); }
    });
  }
  if(step===1){
    const m=S.contact.mobile.replace(/[^\d]/g,'');
    if(S.contact.cc==='+91'?!/^[6-9]\d{9}$/.test(m):m.length<6) bad('contact.mobile','Please write a complete mobile number','Mobile number');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(S.contact.email.trim())) bad('contact.email','Please write a complete email address','Email');
    need('res.line','Please write the address','Residential address'); need('res.city',null,'Residential city');
    if(!/^\d{6}$/.test(S.res.pin.trim())) bad('res.pin','PIN code is 6 digits','Residential PIN code');
    if(S.off.on){ need('off.line','Please write the address','Office address'); need('off.city',null,'Office city');
      if(!/^\d{6}$/.test(S.off.pin.trim())) bad('off.pin','PIN code is 6 digits','Office PIN code'); }
  }
  if(step===2){ if(S.heard==='Other') need('heard_other',null,'Where you heard about it'); }
  if(step===3) need('flat.block','Please choose the block','Block');
  if(step===4){
    if(!(Number(S.pay.amount)>0)) bad('pay.amount','Please write the amount paid','Amount paid');
    need('pay.date','Please choose the date','Payment date'); need('pay.ref',null,'Payment reference');
    if(S.pay.mode==='Cheque'||S.pay.mode==='Demand Draft') need('pay.bank',null,'Bank');
    if(S.sales!=='Direct') need('sales_name',null,'Agent / channel partner name');
  }
  if(step===5) S.applicants.forEach(function(a,i){ if(a.nationality!=='India') return; const who=(a.full_name||('Applicant '+(i+1)))+': ';
    if(!FILES[i].pan.length) bad('doc.'+i+'.pan','Please attach the PAN card',who+'PAN card');
    if(!FILES[i].aadhaar.length) bad('doc.'+i+'.aadhaar','Please attach the Aadhaar card',who+'Aadhaar card'); });
  if(step===6){ if(!S.terms_accepted) bad('terms_accepted','Please tick to accept the terms','Accept the terms'); if(!SIG) bad('sig','Please sign in the box','Signature'); }
  return !MISSING.length;
}

// ---------------------------------------------------------------- drawing
function render(){
  const st=S.step;
  $('steps').innerHTML='<div class="bar"><i style="width:'+Math.round((st+1)/STEPS.length*100)+'%"></i></div><div class="lbl"><span>Step '+(st+1)+' of '+STEPS.length+'</span><b>'+STEPS[st][1]+' '+STEPS[st][0]+'</b></div>';
  $('missing').innerHTML=MISSING.length?'<div class="miss"><b>Still missing on this page ('+MISSING.length+'):</b><ul>'+MISSING.map(function(m){ return '<li data-jump="'+fid(m[0])+'">'+esc(m[1])+'</li>'; }).join('')+'</ul></div>':'';
  $('app').innerHTML=[stepApplicants,stepContact,stepAbout,stepFlat,stepPay,stepDocs,stepTerms,stepReview][st]();
  $('nav').innerHTML='<div class="in">'+(st?'<button type="button" class="btn sec2" data-back="1">Back</button>':'')
    +'<button type="button" class="btn pri" id="nextBtn" data-next="1">'+(st===STEPS.length-1?'Submit booking form':'Continue')+'</button></div>'
    +'<div class="saved">Your answers are saved on this phone as you go.</div>';
  if(st===6) setupPad();
}
function go(n){ S.step=Math.max(0,Math.min(STEPS.length-1,n)); save(); ERR={}; MISSING=[]; render(); window.scrollTo(0,0); }
function showErrors(){
  render(); window.scrollTo({top:0,behavior:'smooth'});
  toast(MISSING.length===1?'1 thing is still missing':MISSING.length+' things are still missing');
}

// ---------------------------------------------------------------- signature pad
/* Smooth: every point the finger passes is used (getCoalescedEvents), and the line is drawn as
   curves through the midpoints, not straight segments, so it does not look jagged. Nothing is drawn
   outside the box, and the page does not scroll while signing. */
function setupPad(){
  const c=$('sigPad'); if(!c) return;
  const dpr=Math.max(1,window.devicePixelRatio||1), r=c.getBoundingClientRect();
  c.width=Math.round(r.width*dpr); c.height=Math.round(r.height*dpr);
  const g=c.getContext('2d'); g.scale(dpr,dpr); g.lineCap='round'; g.lineJoin='round'; g.strokeStyle='#0f2a6b'; g.fillStyle='#0f2a6b'; g.lineWidth=2.6;
  if(SIG){ const im=new Image(); im.onload=function(){ g.drawImage(im,0,0,r.width,r.height); }; im.src=SIG; }
  let pts=null, inked=!!SIG;
  const pt=function(e){ const b=c.getBoundingClientRect(); return {x:e.clientX-b.left,y:e.clientY-b.top,w:b.width,h:b.height}; };
  const inside=function(p){ return p.x>=0&&p.y>=0&&p.x<=p.w&&p.y<=p.h; };
  const add=function(p){
    if(!inside(p)){ pts=pts&&pts.length?[]:pts; return; }          // left the box: lift the pen
    pts.push(p);
    const n=pts.length;
    if(n===1){ g.beginPath(); g.arc(p.x,p.y,1.2,0,Math.PI*2); g.fill(); return; }
    if(n===2){ g.beginPath(); g.moveTo(pts[0].x,pts[0].y); g.lineTo((pts[0].x+p.x)/2,(pts[0].y+p.y)/2); g.stroke(); return; }
    const a=pts[n-3], b=pts[n-2], m1={x:(a.x+b.x)/2,y:(a.y+b.y)/2}, m2={x:(b.x+p.x)/2,y:(b.y+p.y)/2};
    g.beginPath(); g.moveTo(m1.x,m1.y); g.quadraticCurveTo(b.x,b.y,m2.x,m2.y); g.stroke();
  };
  c.addEventListener('pointerdown',function(e){ e.preventDefault(); pts=[]; inked=true;
    const ph=c.parentNode.querySelector('.ph'); if(ph) ph.remove();
    try{ c.setPointerCapture(e.pointerId); }catch(_e){} add(pt(e)); });
  c.addEventListener('pointermove',function(e){ if(!pts) return; e.preventDefault();
    const list=e.getCoalescedEvents?e.getCoalescedEvents():[e]; (list.length?list:[e]).forEach(function(x){ add(pt(x)); }); });
  const end=function(){ if(!pts) return;
    if(pts.length>1){ const l=pts[pts.length-1]; g.beginPath(); g.moveTo((pts[pts.length-2].x+l.x)/2,(pts[pts.length-2].y+l.y)/2); g.lineTo(l.x,l.y); g.stroke(); }
    pts=null; if(inked){ SIG=c.toDataURL('image/png'); if(ERR.sig){ delete ERR.sig; const f=$('f-sig'); if(f) f.classList.remove('bad'); } } };
  c.addEventListener('pointerup',end); c.addEventListener('pointercancel',end); c.addEventListener('lostpointercapture',end);
  c.addEventListener('touchmove',function(e){ e.preventDefault(); },{passive:false});
}

// ---------------------------------------------------------------- address suggestions (Photon / OpenStreetMap)
let acTimer=null, acSeq=0;
function suggest(k,q){
  clearTimeout(acTimer); const box=$('ac-'+k); if(!box) return;
  if(q.trim().length<4){ box.innerHTML=''; return; }
  acTimer=setTimeout(async function(){
    const seq=++acSeq;
    try{
      const r=await fetch('https://photon.komoot.io/api/?limit=5&lang=en&lat=22.57&lon=88.36&q='+encodeURIComponent(q));
      const j=await r.json(); if(seq!==acSeq) return;
      const items=(j.features||[]).map(function(f){ const p=f.properties||{};
        const line=[p.housenumber,p.name,p.street,p.district||p.locality].filter(Boolean).filter(function(v,i,a){ return a.indexOf(v)===i; }).join(', ');
        return {line:line||p.name||'',city:p.city||p.county||p.state||'',pin:/^\d{6}$/.test(p.postcode||'')?p.postcode:'',more:[p.city,p.state,p.postcode].filter(Boolean).join(', ')}; })
        .filter(function(x){ return x.line; });
      box.innerHTML=items.length?'<div class="acl">'+items.map(function(x,i){ return '<button type="button" data-acpick="'+k+'|'+i+'">'+esc(x.line)+'<small>'+esc(x.more)+'</small></button>'; }).join('')
        +'<div class="src">Suggestions from OpenStreetMap</div></div>':'';
      box._items=items;
    }catch(e){ box.innerHTML=''; }
  },350);
}

// ---------------------------------------------------------------- events
document.addEventListener('input',function(e){
  const k=e.target.getAttribute&&e.target.getAttribute('data-k'); if(!k) return;
  let v=e.target.value;
  if(/\.(pan|passport)$|flat_no$|pay\.ref$/.test(k)) v=v.toUpperCase();
  if(/aadhaar$/.test(k)){ const d=v.replace(/\D/g,'').slice(0,12); v=d.replace(/(\d{4})(?=\d)/g,'$1 '); }
  if(/(price\.total|price\.rate|pay\.amount)$/.test(k)) v=v.replace(/[^\d]/g,'');
  if(/\.pin$/.test(k)) v=v.replace(/\D/g,'').slice(0,6);
  if(v!==e.target.value){ e.target.value=v; try{ e.target.setSelectionRange(v.length,v.length); }catch(_e){} }
  set(k,v);
  if(k==='pay.amount'){ const w=$('w-amount'); if(w) w.textContent=words(v); }
  if(k==='price.total'){ const w=$('w-total'); if(w) w.textContent=words(v); }
  if(/^(res|off)\.line$/.test(k)) suggest(k.split('.')[0],v);
  if(ERR[k]){ delete ERR[k]; const f=$(fid(k)); if(f) f.classList.remove('bad'); }
});
document.addEventListener('change',function(e){
  const t=e.target;
  const ck=t.getAttribute&&t.getAttribute('data-check');
  if(ck){ set(ck,t.checked); if(ck==='off.on'){ if(!t.checked){ S.mailing='Residential'; S.permanent='Residential'; } render(); } else if(ERR[ck]){ delete ERR[ck]; const f=$('f-'+ck); if(f) f.classList.remove('bad'); } return; }
  const fk=t.getAttribute&&t.getAttribute('data-file');
  if(fk&&t.files&&t.files[0]){ const parts=fk.split('|'), f=t.files[0];
    if(f.size>10*1024*1024){ toast('That file is over 10 MB - please take a smaller photo'); return; }
    if(!/^image\//.test(f.type)&&f.type!=='application/pdf'){ toast('Please attach a photo or a PDF'); return; }
    FILES[+parts[0]][parts[1]].push(f); delete ERR['doc.'+parts[0]+'.'+parts[1]]; render(); }
});
document.addEventListener('click',function(e){
  const li=e.target.closest&&e.target.closest('[data-jump]');
  if(li){ const f=$(li.getAttribute('data-jump')); if(f){ f.scrollIntoView({behavior:'smooth',block:'center'}); const i=f.querySelector('input,textarea,button'); if(i) setTimeout(function(){ i.focus({preventScroll:true}); },400); } return; }
  const b=e.target.closest&&e.target.closest('button'); if(!b) return;
  if(b.dataset.pick){ openSheet(b.dataset.pick,b.dataset.kind); return; }
  if(b.dataset.chip){ set(b.dataset.chip,b.dataset.v); if(ERR[b.dataset.chip]){ delete ERR[b.dataset.chip]; MISSING=MISSING.filter(function(m){ return m[0]!==b.dataset.chip; }); } render(); return; }
  if(b.dataset.acpick){ const p=b.dataset.acpick.split('|'), box=$('ac-'+p[0]), x=box&&box._items&&box._items[+p[1]]; if(!x) return;
    set(p[0]+'.line',x.line); if(x.city) set(p[0]+'.city',x.city); if(x.pin) set(p[0]+'.pin',x.pin); render(); return; }
  if(b.dataset.add){ S.applicants.push(newApp()); FILES.push({pan:[],aadhaar:[]}); save(); render();
    const cards=document.querySelectorAll('.app'); cards[cards.length-1].scrollIntoView({behavior:'smooth',block:'start'}); return; }
  if(b.dataset.rm){ const i=+b.dataset.rm; if(!confirm('Remove applicant '+(i+1)+'?')) return; S.applicants.splice(i,1); FILES.splice(i,1); save(); render(); return; }
  if(b.dataset.addwhy){ S.why.push(''); save(); render(); const ins=document.querySelectorAll('[data-k^="why."]'); ins[ins.length-1].focus(); return; }
  if(b.dataset.rmwhy){ S.why.splice(+b.dataset.rmwhy,1); save(); render(); return; }
  if(b.dataset.delfile){ const p=b.dataset.delfile.split('|'); FILES[+p[0]][p[1]].splice(+p[2],1); render(); return; }
  if(b.dataset.clearsig){ SIG=null; render(); return; }
  if(b.dataset.go){ go(+b.dataset.go); return; }
  if(b.dataset.back){ go(S.step-1); return; }
  if(b.dataset.next){
    if(S.step===STEPS.length-1){ submit(); return; }
    if(!check(S.step)){ showErrors(); return; }
    go(S.step+1);
  }
});
document.addEventListener('click',function(e){ if(!e.target.closest('.ac')) document.querySelectorAll('[id^="ac-"]').forEach(function(b){ b.innerHTML=''; }); },true);

// ---------------------------------------------------------------- submit
function dataURLtoBlob(u){ const p=u.split(','), bin=atob(p[1]), a=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return new Blob([a],{type:'image/png'}); }
async function submit(){
  for(let s=0;s<STEPS.length-1;s++){ if(!check(s)){ S.step=s; save(); showErrors(); return; } }
  const btn=$('nextBtn'); btn.disabled=true; btn.textContent='Sending… please keep this page open';
  const data=JSON.parse(JSON.stringify(S)); delete data.step;
  data.website=($('hpWeb')||{}).value||'';
  data.applicants.forEach(function(a){ a.pan=a.pan.toUpperCase(); a.aadhaar=a.aadhaar.replace(/\s/g,''); });
  data.why=data.why.filter(Boolean);
  data.submitted_on_device=new Date().toString();
  const fd=new FormData();
  fd.append('data',JSON.stringify(data));
  FILES.forEach(function(f,i){ ['pan','aadhaar'].forEach(function(kind){ f[kind].forEach(function(file,n){ fd.append('f_'+i+'_'+kind+'_'+n,file,file.name); }); }); });
  if(SIG) fd.append('sig_0',dataURLtoBlob(SIG),'signature.png');
  try{
    const r=await fetch(FN,{method:'POST',body:fd});
    const j=await r.json().catch(function(){ return {}; });
    if(!r.ok||!j.ok) throw new Error(j.error||('Could not send (error '+r.status+')'));
    try{ localStorage.removeItem(DRAFT_KEY); }catch(e){}
    $('steps').innerHTML=''; $('nav').innerHTML=''; $('missing').innerHTML='';
    $('app').innerHTML='<div class="sec"><div class="done"><div class="ok">✓</div><h2>Thank you! Your booking form has been received.</h2>'
      +'<p style="color:var(--slate);margin-top:8px">Your reference number</p><div class="ref">'+esc(j.ref_no)+'</div>'
      +'<p style="color:var(--slate)">Please keep this number. Our team will call you shortly to confirm your booking.</p></div></div>';
    window.scrollTo(0,0);
  }catch(e){
    btn.disabled=false; btn.textContent='Submit booking form';
    alert(e.message||'Could not send. Please check your internet and try again.');
  }
}

if(!CONF){ $('app').innerHTML='<div class="sec"><div class="sb"><h2>This booking link is not valid.</h2><p>Please use the exact link our team sent you.</p></div></div>'; return; }
// Coming back to a saved draft: files and the signature were not kept, so it opens no later than
// the PAN & Aadhaar step.
if(S.step>5) S.step=5;
render();
})();
