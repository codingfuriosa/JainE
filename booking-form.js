/* Digital Booking Form - Dream Ananta (2 Nov 2026).
   The paper Ananta booking form (Page 1 of 6 + Terms, Declaration, Special Conditions), made for a
   customer filling it alone on a phone, anywhere:
     - six short steps with a progress bar; nothing is lost if the page is closed - answers (not files
       or signatures) are kept on the customer's own device until they submit
     - any number of applicants (up to 6), each with their own card
     - fixed answers are tap-to-choose buttons, the most common answer already chosen (from the
       Ananta forms received so far: Mr., S/o, Salaried, Facebook, Construction Linked, 3 BHK)
     - Nationality starts as India; passport and bank details are asked only of non-Indians
     - PAN and Aadhaar are attached as photos or PDFs, straight from the phone camera
     - each applicant signs in a box with a finger; drawing works only inside that box
   Submitting posts everything to the booking-form-public edge function, which checks it all again
   and saves it (acc.digital_booking_forms). This page never talks to the database. */
(function(){
'use strict';
const FN='https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/booking-form-public';
const PROJECT=(new URLSearchParams(location.search).get('p')||'ananta').toLowerCase();
const CONF={ananta:{name:'Dream Ananta',company:'Dream Gateway Hotels Ltd.',blocks:['Block D','Block E'],floors:8,
  bhk:['2 BHK','3 BHK','4 BHK'],bhkDefault:'3 BHK'}}[PROJECT];
const DRAFT_KEY='jg-booking-form-'+PROJECT;
const MAX_APPS=6;
const STEPS=['Applicants','Contact & address','Flat & payment','PAN & Aadhaar','Terms & signature','Check & submit'];

const COUNTRIES=[['India','🇮🇳','+91'],['United Arab Emirates','🇦🇪','+971'],['United States','🇺🇸','+1'],['United Kingdom','🇬🇧','+44'],
  ['Canada','🇨🇦','+1'],['Australia','🇦🇺','+61'],['Singapore','🇸🇬','+65'],['Saudi Arabia','🇸🇦','+966'],['Qatar','🇶🇦','+974'],
  ['Kuwait','🇰🇼','+965'],['Oman','🇴🇲','+968'],['Bahrain','🇧🇭','+973'],['Bangladesh','🇧🇩','+880'],['Nepal','🇳🇵','+977'],
  ['Bhutan','🇧🇹','+975'],['Germany','🇩🇪','+49'],['New Zealand','🇳🇿','+64'],['Malaysia','🇲🇾','+60'],['Other','🌐','']];
const STATES=['Andaman & Nicobar','Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chandigarh','Chhattisgarh','Delhi','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jammu & Kashmir','Jharkhand','Karnataka','Kerala','Ladakh','Madhya Pradesh','Maharashtra','Manipur',
  'Meghalaya','Mizoram','Nagaland','Odisha','Puducherry','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura',
  'Uttar Pradesh','Uttarakhand','West Bengal'];

// ---------------------------------------------------------------- state
function newApp(){ return {title:'Mr.',full_name:'',relation:'S/o',relation_name:'',dob:'',occupation:'Salaried',nationality:'India',
  pan:'',aadhaar:'',passport:'',bank_details:'',spouse:'',anniversary:''}; }
function fresh(){ return {project:PROJECT,step:0,applicants:[newApp()],
  contact:{cc:'+91',mobile:'',phone_res:'',phone_off:'',email:'',contact_person:''},
  profession:{kind:'Salaried',company:'',designation:'',income:'',community:'',newspaper:'',magazine:'',tv:'',radio:''},
  res:{co:'',line:'',city:'',state:'West Bengal',pin:'',country:'India'},off:{on:false,co:'',line:'',city:'',state:'West Bengal',pin:'',country:'India'},
  mailing:'Residential',permanent:'Residential',
  heard:'Facebook',heard_other:'',why:['','',''],
  flat:{block:'',floor:'',flat_no:'',bhk:CONF?CONF.bhkDefault:'',parking:'Covered'},
  price:{total:'',rate:'',loan:'No',bank:'',plan:'Construction Linked'},
  pay:{mode:'UPI / NEFT / RTGS',amount:'',ref:'',bank:'',branch:'',date:''},
  purpose:'Residential',sales:'Direct',sales_name:'',lead_id:'',terms_accepted:false}; }
let S; try{ S=Object.assign(fresh(),JSON.parse(localStorage.getItem(DRAFT_KEY)||'null')||{}); }catch(e){ S=fresh(); }
if(!Array.isArray(S.applicants)||!S.applicants.length) S.applicants=[newApp()];
// Files and signatures live only in this page (too big for the draft): {pan:[File],aadhaar:[File]} and a PNG data URL.
let FILES=S.applicants.map(function(){ return {pan:[],aadhaar:[]}; });
let SIGS=S.applicants.map(function(){ return null; });
let ERR={};
const $=function(id){ return document.getElementById(id); };
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function save(){ try{ const c=Object.assign({},S); localStorage.setItem(DRAFT_KEY,JSON.stringify(c)); }catch(e){} }
function get(path){ return path.split('.').reduce(function(o,k){ return o==null?o:o[k]; },S); }
function set(path,v){ const ks=path.split('.'); let o=S; for(let i=0;i<ks.length-1;i++) o=o[ks[i]]; o[ks[ks.length-1]]=v; save(); }
function toast(m){ const t=document.createElement('div'); t.className='toast'; t.textContent=m; document.body.appendChild(t); setTimeout(function(){ t.remove(); },2600); }

// ---------------------------------------------------------------- building blocks
function field(path,label,o){
  o=o||{}; const v=get(path);
  const ctl=o.type==='select'
    ?'<select data-k="'+path+'">'+(o.blank?'<option value="">'+esc(o.blank)+'</option>':'')+o.options.map(function(x){ const val=Array.isArray(x)?x[0]:x, txt=Array.isArray(x)?x[1]:x; return '<option value="'+esc(val)+'"'+(String(v)===String(val)?' selected':'')+'>'+esc(txt)+'</option>'; }).join('')+'</select>'
    :o.type==='area'?'<textarea data-k="'+path+'" placeholder="'+esc(o.ph||'')+'">'+esc(v)+'</textarea>'
    :'<input type="'+(o.type||'text')+'" data-k="'+path+'" value="'+esc(v)+'"'+(o.ph?' placeholder="'+esc(o.ph)+'"':'')+(o.cls?' class="'+o.cls+'"':'')
      +(o.mode?' inputmode="'+o.mode+'"':'')+(o.max?' maxlength="'+o.max+'"':'')+(o.auto?' autocomplete="'+o.auto+'"':'')+'>';
  return '<div class="f'+(o.full?' full':'')+(ERR[path]?' bad':'')+'" id="f-'+path.replace(/\./g,'-')+'"><label>'+esc(label)+(o.req?' <span class="req">*</span>':(o.optional?' <span class="opt">(optional)</span>':''))+'</label>'
    +(o.before||'')+ctl+(o.after||'')+'<div class="err">'+esc(ERR[path]||'')+'</div></div>';
}
function chips(path,label,options,o){
  o=o||{}; const v=get(path);
  return '<div class="f'+(o.full!==false?' full':'')+(ERR[path]?' bad':'')+'" id="f-'+path.replace(/\./g,'-')+'"><label>'+esc(label)+(o.req?' <span class="req">*</span>':'')+'</label><div class="chips" role="radiogroup">'
    +options.map(function(x){ return '<button type="button" class="chip'+(v===x?' on':'')+'" role="radio" aria-checked="'+(v===x)+'" data-chip="'+path+'" data-v="'+esc(x)+'">'+esc(x)+'</button>'; }).join('')
    +'</div><div class="err">'+esc(ERR[path]||'')+'</div></div>';
}
function countrySel(path,label,o){
  return field(path,label,Object.assign({type:'select',options:COUNTRIES.map(function(c){ return [c[0],c[1]+'  '+c[0]]; })},o||{}));
}

// ---------------------------------------------------------------- steps
function stepApplicants(){
  return '<div class="sec"><h2>Who is booking?</h2><p class="hint">Add everyone whose name should be on the flat. The first applicant is the main contact.</p>'
    +S.applicants.map(function(a,i){
      const p='applicants.'+i+'.', foreign=a.nationality!=='India';
      return '<div class="app"><div class="ah"><span class="num">'+(i+1)+'</span><b>'+(i?'Joint applicant':'First / sole applicant')+'</b>'
          +(i?'<button type="button" class="rm" data-rm="'+i+'">Remove</button>':'')+'</div>'
        +'<div class="grid">'
        +chips(p+'title','Title',['Mr.','Ms.','Mrs.','Mast.','M/s.'])
        +field(p+'full_name','Full name (as on PAN card)',{req:1,full:1,cls:'up',auto:i?'off':'name'})
        +chips(p+'relation','Son / Daughter / Wife / Care of',['S/o','D/o','W/o','C/o'])
        +field(p+'relation_name',({'S/o':"Father's",'D/o':"Father's",'W/o':"Husband's",'C/o':"Guardian's"}[a.relation]||"Father's")+' name',{req:1,full:1,cls:'up'})
        +field(p+'dob','Date of birth',{type:'date',req:1})
        +chips(p+'occupation','Occupation',['Salaried','Business'],{full:false})
        +countrySel(p+'nationality','Nationality')
        +field(p+'pan','PAN number',{cls:'up',max:10,ph:'ABCDE1234F',req:!foreign,optional:foreign})
        +field(p+'aadhaar','Aadhaar number',{mode:'numeric',max:14,ph:'1234 5678 9012',optional:1})
        +(foreign?field(p+'passport','Passport number',{cls:'up',req:1})+field(p+'bank_details','Bank account details (for NRIs & foreigners)',{type:'area',full:1,ph:'Bank, account number, branch, SWIFT/IFSC',req:1}):'')
        +(i===0?field(p+'spouse','Spouse name',{optional:1,cls:'up'})+field(p+'anniversary','Marriage anniversary',{type:'date',optional:1}):'')
        +'</div></div>';
    }).join('')
    +(S.applicants.length<MAX_APPS?'<button type="button" class="btn add" data-add="1">＋ Add another applicant</button>':'')
    +'</div>';
}
function addrBlock(k,title){
  return '<h3>'+title+'</h3><div class="grid">'
    +field(k+'.co','Care of (C/o)',{optional:1,full:1})
    +field(k+'.line','House, street, area',{type:'area',full:1,req:k==='res'})
    +field(k+'.city','City / Town',{req:k==='res'})
    +(get(k+'.country')==='India'?field(k+'.state','State',{type:'select',options:STATES}):field(k+'.state','State / Province',{optional:1}))
    +field(k+'.pin',get(k+'.country')==='India'?'PIN code':'Postal code',{mode:get(k+'.country')==='India'?'numeric':'text',max:10,req:k==='res'})
    +countrySel(k+'.country','Country')+'</div>';
}
function stepContact(){
  const a=S.applicants[0];
  return '<div class="sec"><h2>Contact details</h2><p class="hint">For '+esc(a.full_name||'the first applicant')+'. We send every letter and receipt here.</p><div class="grid">'
      +field('contact.mobile','Mobile number',{type:'tel',req:1,full:1,mode:'tel',auto:'tel-national',
        before:'<div class="pre"><select data-k="contact.cc" aria-label="Country code">'+COUNTRIES.filter(function(c){ return c[2]; }).map(function(c){
          return '<option value="'+c[2]+'"'+(S.contact.cc===c[2]?' selected':'')+'>'+c[1]+' '+c[2]+'</option>'; }).filter(function(o,i,a){ return a.indexOf(o)===i; }).join('')+'</select>',after:'</div>'})
      +field('contact.email','Email',{type:'email',req:1,full:1,auto:'email'})
      +field('contact.phone_res','Phone (residence)',{type:'tel',optional:1,mode:'tel'})
      +field('contact.phone_off','Phone (office)',{type:'tel',optional:1,mode:'tel'})
    +'</div>'
    +addrBlock('res','Residential address')
    +'<label class="agree" style="margin-top:14px"><input type="checkbox" data-check="off.on"'+(S.off.on?' checked':'')+'><span><b>Add an office address</b><br><span style="color:var(--slate);font-size:13px">Optional</span></span></label>'
    +(S.off.on?addrBlock('off','Office address'):'')
    +'<div class="grid" style="margin-top:14px">'
      +chips('mailing','Send letters to (mailing address)',S.off.on?['Residential','Office']:['Residential'])
      +chips('permanent','Permanent address',S.off.on?['Residential','Office']:['Residential'])
      +field('contact.contact_person','Name of contact person',{optional:1,full:1})
    +'</div></div>'
    +'<div class="sec"><h2>Work</h2><div class="grid">'
      +chips('profession.kind','Profession',['Salaried','Self-Employed','Govt. Employee','Others'])
      +field('profession.company','Company',{optional:1})+field('profession.designation','Designation',{optional:1})
    +'</div>'
    +'<details class="t" style="margin-top:14px"><summary>A little more about you (optional)</summary><div class="grid" style="padding:0 14px 14px">'
      +field('profession.income','Gross income',{optional:1})+field('profession.community','Community',{optional:1})
      +field('profession.newspaper','Favourite newspaper',{optional:1})+field('profession.magazine','Magazine',{optional:1})
      +field('profession.tv','TV channel',{optional:1})+field('profession.radio','Radio station',{optional:1})
    +'</div></details></div>'
    +'<div class="sec"><h2>About this project</h2><div class="grid">'
      +chips('heard','How did you come to know about the project?',['Facebook','Instagram','Google','YouTube','Newspaper','Hoarding / Poster','Friend / Relative','Channel partner','Site visit','Other'])
      +(S.heard==='Other'?field('heard_other','Please tell us where',{full:1}):'')
      +field('why.0','Why did you choose this project? (A)',{optional:1,full:1})
      +field('why.1','(B)',{optional:1})+field('why.2','(C)',{optional:1})
    +'</div></div>';
}
function words(n){
  n=Math.floor(Number(n)); if(!n||n<0) return '';
  const a=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const b=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const two=function(x){ return x<20?a[x]:b[Math.floor(x/10)]+(x%10?' '+a[x%10]:''); };
  const three=function(x){ return (x>=100?a[Math.floor(x/100)]+' Hundred'+(x%100?' ':''):'')+(x%100?two(x%100):''); };
  let out=[]; const cr=Math.floor(n/1e7); n%=1e7; const lk=Math.floor(n/1e5); n%=1e5; const th=Math.floor(n/1e3); n%=1e3;
  if(cr) out.push(three(cr)+' Crore'); if(lk) out.push(two(lk)+' Lakh'); if(th) out.push(two(th)+' Thousand'); if(n) out.push(three(n));
  return 'Rupees '+out.join(' ')+' only';
}
function stepFlat(){
  const floors=[]; for(let i=1;i<=(CONF.floors||8);i++) floors.push([String(i),i+(i===1?'st':i===2?'nd':i===3?'rd':'th')+' floor']);
  return '<div class="sec"><h2>Flat choice</h2><p class="hint">As discussed with our sales team. Leave the flat number empty if it is not fixed yet.</p><div class="grid">'
      +chips('flat.block','Block',CONF.blocks,{req:1})
      +field('flat.floor','Floor',{type:'select',blank:'Choose floor',options:floors})
      +field('flat.flat_no','Flat number',{cls:'up',ph:'e.g. 5A',max:8,optional:1})
      +chips('flat.bhk','Bedrooms',CONF.bhk)
      +chips('flat.parking','Right to use car park',['Covered','Open'])
    +'</div></div>'
    +'<div class="sec"><h2>Price & payment plan</h2><div class="grid">'
      +field('price.total','Total sale price agreed (₹)',{mode:'numeric',optional:1,after:'<div class="words" id="w-total">'+esc(words(S.price.total))+'</div>'})
      +field('price.rate','Rate per sq.ft. (₹)',{mode:'numeric',optional:1})
      +chips('price.plan','Payment plan',['Construction Linked','Down Payment'])
      +chips('price.loan','Home loan required?',['No','Yes'],{full:false})
      +(S.price.loan==='Yes'?field('price.bank','Preferred bank / institution',{optional:1}):'')
    +'</div></div>'
    +'<div class="sec"><h2>Application payment</h2><p class="hint">The booking amount you have paid or are paying, in favour of <b>'+esc(CONF.company)+'</b>. We never take cash.</p><div class="grid">'
      +chips('pay.mode','Paid by',['UPI / NEFT / RTGS','Cheque','Demand Draft','Card'])
      +field('pay.amount','Amount (₹)',{mode:'numeric',req:1,after:'<div class="words" id="w-amount">'+esc(words(S.pay.amount))+'</div>'})
      +field('pay.date','Date paid / cheque date',{type:'date',req:1})
      +field('pay.ref',({'Cheque':'Cheque number','Demand Draft':'DD number','Card':'Card transaction ID'}[S.pay.mode]||'UTR / transaction reference'),{req:1,cls:'up'})
      +field('pay.bank','Bank (drawn on)',{optional:S.pay.mode!=='Cheque'&&S.pay.mode!=='Demand Draft',req:S.pay.mode==='Cheque'||S.pay.mode==='Demand Draft'})
      +field('pay.branch','Branch',{optional:1})
    +'</div></div>'
    +'<div class="sec"><h2>Booking</h2><div class="grid">'
      +chips('purpose','Purpose of booking',['Residential','Investment'])
      +chips('sales','Booked through',['Direct','Booking agent / Channel partner'])
      +field('sales_name',S.sales==='Direct'?'Name of our sales person':'Name of agent / channel partner',{optional:S.sales==='Direct',req:S.sales!=='Direct'})
      +field('lead_id','Lead ID',{optional:1,ph:'If our team gave you one'})
    +'</div></div>';
}
function fileList(i,kind){
  return FILES[i][kind].map(function(f,n){
    const img=/^image\//.test(f.type)?'<img src="'+URL.createObjectURL(f)+'" alt="">':'<div class="pdf">PDF</div>';
    return '<div class="file">'+img+'<span>'+esc(f.name)+'</span><button type="button" data-delfile="'+i+'|'+kind+'|'+n+'" aria-label="Remove">×</button></div>';
  }).join('');
}
function stepDocs(){
  return '<div class="sec"><h2>PAN & Aadhaar</h2><p class="hint">Take a clear photo with your phone, or attach a PDF. Aadhaar: front and back (two photos are fine).</p>'
    +S.applicants.map(function(a,i){
      const foreign=a.nationality!=='India';
      const box=function(kind,label){ const k='doc.'+i+'.'+kind;
        return '<div class="f full'+(ERR[k]?' bad':'')+'" id="f-'+k.replace(/\./g,'-')+'"><label>'+label+(foreign?' <span class="opt">(optional)</span>':' <span class="req">*</span>')+'</label><div class="upl">'
          +fileList(i,kind)
          +(FILES[i][kind].length<2?'<label class="pick">📷 '+(FILES[i][kind].length?'Add another':'Add photo or PDF')+'<input type="file" accept="image/*,application/pdf" data-file="'+i+'|'+kind+'"></label>':'')
          +'</div><div class="err">'+esc(ERR[k]||'')+'</div></div>'; };
      return '<div class="app"><div class="ah"><span class="num">'+(i+1)+'</span><b>'+esc(a.full_name||('Applicant '+(i+1)))+'</b></div><div class="grid">'
        +box('pan','PAN card')+box('aadhaar','Aadhaar card')+'</div></div>';
    }).join('')+'</div>';
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
  const list=function(arr,html){ return '<ol>'+arr.map(function(t){ return '<li>'+(html?t:esc(t))+'</li>'; }).join('')+'</ol>'; };
  return '<div class="sec"><h2>Terms & Conditions</h2><p class="hint">Tap each heading to read it.</p>'
      +'<details class="t"><summary>Terms of application (15)</summary>'+list(TERMS)+'</details>'
      +'<details class="t"><summary>Declaration (2)</summary>'+list(DECL)+'</details>'
      +'<details class="t"><summary>Special Conditions (11)</summary>'+list(SPECIAL.map(function(s){ return esc(s).replace(/&lt;br&gt;&lt;br&gt;/g,'<br><br>'); }),true)+'</details>'
      +'<div class="note">The Annexure – Supplemental Terms and Conditions will be added here.</div>'
      +'<label class="agree'+(ERR.terms_accepted?' bad':'')+'" id="f-terms_accepted"><input type="checkbox" data-check="terms_accepted"'+(S.terms_accepted?' checked':'')+'><span><b>I/We have read and agree to all the above.</b><br><span style="color:var(--slate);font-size:13px">I/We confirm that everything in this form is true.</span><div class="err">'+esc(ERR.terms_accepted||'')+'</div></span></label>'
    +'</div>'
    +'<div class="sec"><h2>Signatures</h2><p class="hint">Each applicant signs with a finger (or mouse) inside their box.</p>'
    +S.applicants.map(function(a,i){ const k='sig.'+i;
      return '<div class="f full'+(ERR[k]?' bad':'')+'" id="f-'+k.replace(/\./g,'-')+'" style="margin-top:14px"><label>'+esc(a.full_name||('Applicant '+(i+1)))+' <span class="req">*</span></label>'
        +'<div class="pad"><canvas data-sig="'+i+'"></canvas><div class="line"></div>'+(SIGS[i]?'':'<div class="ph">Sign here</div>')
        +'<button type="button" class="x" data-clearsig="'+i+'">Clear</button></div><div class="err">'+esc(ERR[k]||'')+'</div></div>';
    }).join('')
    +'<p class="hint" style="margin-top:14px">Place: '+esc(S.res.city||'—')+' · Date: '+new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})+'</p></div>';
}
function rows(pairs){ return '<table class="rv">'+pairs.filter(function(p){ return p[1]!==''&&p[1]!=null; }).map(function(p){ return '<tr><td>'+esc(p[0])+'</td><td>'+esc(p[1])+'</td></tr>'; }).join('')+'</table>'; }
function fmtD(d){ return d?new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):''; }
function addr(x){ return [x.co?'C/o '+x.co:'',x.line,x.city,x.state,x.pin,x.country].filter(Boolean).join(', '); }
function stepReview(){
  const h=function(t,step){ return '<div class="rvh"><h3>'+t+'</h3><button type="button" data-go="'+step+'">Edit</button></div>'; };
  return '<div class="sec"><h2>Please check everything</h2><p class="hint">Tap Edit to change anything. Then press Submit.</p>'
    +S.applicants.map(function(a,i){ return h((i?'Joint applicant '+(i+1):'First applicant'),0)+rows([
      ['Name',a.title+' '+a.full_name],[a.relation,a.relation_name],['Date of birth',fmtD(a.dob)],['Occupation',a.occupation],['Nationality',a.nationality],
      ['PAN',a.pan.toUpperCase()],['Aadhaar',a.aadhaar],['Passport',a.nationality!=='India'?a.passport:''],['Bank details',a.nationality!=='India'?a.bank_details:''],
      ['Spouse',i?'':a.spouse],['Anniversary',i?'':fmtD(a.anniversary)],
      ['Documents',(FILES[i].pan.length?'PAN ✓':'PAN —')+'  ·  '+(FILES[i].aadhaar.length?'Aadhaar ✓ ('+FILES[i].aadhaar.length+')':'Aadhaar —')],['Signed',SIGS[i]?'Yes ✓':'Not yet']]); }).join('')
    +h('Contact & address',1)+rows([['Mobile',S.contact.cc+' '+S.contact.mobile],['Email',S.contact.email],['Phone (res.)',S.contact.phone_res],['Phone (off.)',S.contact.phone_off],
      ['Residential address',addr(S.res)],['Office address',S.off.on?addr(S.off):''],['Mailing address',S.mailing],['Permanent address',S.permanent],
      ['Contact person',S.contact.contact_person],['Profession',S.profession.kind],['Company',S.profession.company],['Designation',S.profession.designation],
      ['Heard about us from',S.heard==='Other'?S.heard_other:S.heard],['Why this project',S.why.filter(Boolean).join(' · ')]])
    +h('Flat & payment',2)+rows([['Block',S.flat.block],['Floor',S.flat.floor],['Flat',S.flat.flat_no.toUpperCase()],['Bedrooms',S.flat.bhk],['Car park',S.flat.parking],
      ['Total sale price',S.price.total?'₹'+Number(S.price.total).toLocaleString('en-IN'):''],['Rate / sq.ft.',S.price.rate?'₹'+S.price.rate:''],['Payment plan',S.price.plan],
      ['Home loan',S.price.loan+(S.price.loan==='Yes'&&S.price.bank?' - '+S.price.bank:'')],
      ['Application payment',S.pay.amount?'₹'+Number(S.pay.amount).toLocaleString('en-IN')+' ('+words(S.pay.amount)+')':''],['Paid by',S.pay.mode],['Reference',S.pay.ref],
      ['Bank / branch',[S.pay.bank,S.pay.branch].filter(Boolean).join(', ')],['Date',fmtD(S.pay.date)],['Purpose',S.purpose],['Booked through',S.sales+(S.sales_name?' - '+S.sales_name:'')],['Lead ID',S.lead_id]])
    +'<div class="hp" aria-hidden="true"><input tabindex="-1" autocomplete="off" id="hpWeb"></div>'
    +'</div>';
}

// ---------------------------------------------------------------- checks per step (the server checks again)
const PAN_RE=/^[A-Z]{5}[0-9]{4}[A-Z]$/;
function check(step){
  ERR={};
  const need=function(k,msg){ if(!String(get(k)||'').trim()) ERR[k]=msg||'Please fill this in'; };
  if(step===0) S.applicants.forEach(function(a,i){ const p='applicants.'+i+'.';
    need(p+'full_name','Please write the full name'); need(p+'relation_name'); need(p+'dob','Please choose the date of birth');
    if(a.nationality==='India'){ if(!PAN_RE.test(a.pan.toUpperCase())) ERR[p+'pan']=a.pan?'PAN should look like ABCDE1234F':'Please write the PAN number'; }
    else { need(p+'passport'); need(p+'bank_details'); if(a.pan&&!PAN_RE.test(a.pan.toUpperCase())) ERR[p+'pan']='PAN should look like ABCDE1234F'; }
    if(a.aadhaar&&!/^\d{12}$/.test(a.aadhaar.replace(/\s/g,''))) ERR[p+'aadhaar']='Aadhaar should be 12 digits';
  });
  if(step===1){
    const m=S.contact.mobile.replace(/[^\d]/g,'');
    if(S.contact.cc==='+91'?!/^[6-9]\d{9}$/.test(m):m.length<6) ERR['contact.mobile']='Please write a complete mobile number';
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(S.contact.email.trim())) ERR['contact.email']='Please write a complete email address';
    need('res.line','Please write the address'); need('res.city');
    if(S.res.country==='India'&&!/^\d{6}$/.test(S.res.pin.trim())) ERR['res.pin']='PIN code is 6 digits'; else if(S.res.country!=='India') need('res.pin');
    if(S.heard==='Other') need('heard_other');
  }
  if(step===2){
    need('flat.block','Please choose the block');
    if(!(Number(S.pay.amount)>0)) ERR['pay.amount']='Please write the amount paid';
    need('pay.date','Please choose the date'); need('pay.ref');
    if(S.pay.mode==='Cheque'||S.pay.mode==='Demand Draft') need('pay.bank');
    if(S.sales!=='Direct') need('sales_name');
  }
  if(step===3) S.applicants.forEach(function(a,i){ if(a.nationality!=='India') return;
    if(!FILES[i].pan.length) ERR['doc.'+i+'.pan']='Please attach the PAN card';
    if(!FILES[i].aadhaar.length) ERR['doc.'+i+'.aadhaar']='Please attach the Aadhaar card'; });
  if(step===4){
    if(!S.terms_accepted) ERR.terms_accepted='Please tick to accept the terms';
    S.applicants.forEach(function(a,i){ if(!SIGS[i]) ERR['sig.'+i]='Please sign in the box'; });
  }
  return !Object.keys(ERR).length;
}

// ---------------------------------------------------------------- drawing
function render(){
  const st=S.step;
  $('steps').innerHTML='<div class="bar"><i style="width:'+Math.round((st+1)/STEPS.length*100)+'%"></i></div><div class="lbl"><span>Step '+(st+1)+' of '+STEPS.length+'</span><b>'+STEPS[st]+'</b></div>';
  $('app').innerHTML=[stepApplicants,stepContact,stepFlat,stepDocs,stepTerms,stepReview][st]();
  $('nav').innerHTML='<div class="in">'+(st?'<button type="button" class="btn sec2" data-back="1">Back</button>':'')
    +'<button type="button" class="btn pri" id="nextBtn" data-next="1">'+(st===STEPS.length-1?'Submit booking form':'Continue')+'</button></div>'
    +'<div class="saved">Your answers are saved on this phone as you go.</div>';
  if(st===4) S.applicants.forEach(function(a,i){ setupPad(i); });
}
function go(n){ S.step=Math.max(0,Math.min(STEPS.length-1,n)); save(); ERR={}; render(); window.scrollTo(0,0); }
function showErrors(){
  render();
  const first=document.querySelector('.bad'); if(first) first.scrollIntoView({behavior:'smooth',block:'center'});
  toast('Please check the highlighted '+(Object.keys(ERR).length===1?'field':'fields'));
}

// ---------------------------------------------------------------- signature pad: draws only inside its own box
function setupPad(i){
  const c=document.querySelector('canvas[data-sig="'+i+'"]'); if(!c) return;
  const dpr=Math.max(1,window.devicePixelRatio||1), r=c.getBoundingClientRect();
  c.width=Math.round(r.width*dpr); c.height=Math.round(r.height*dpr);
  const g=c.getContext('2d'); g.scale(dpr,dpr); g.lineWidth=2.4; g.lineCap='round'; g.lineJoin='round'; g.strokeStyle='#0f2a6b';
  if(SIGS[i]){ const im=new Image(); im.onload=function(){ g.drawImage(im,0,0,r.width,r.height); }; im.src=SIGS[i]; }
  let drawing=false, last=null, inked=!!SIGS[i];
  const pt=function(e){ const b=c.getBoundingClientRect(); return {x:e.clientX-b.left,y:e.clientY-b.top}; };
  c.addEventListener('pointerdown',function(e){ e.preventDefault(); drawing=true; last=pt(e); inked=true;
    const ph=c.parentNode.querySelector('.ph'); if(ph) ph.remove(); g.beginPath(); g.arc(last.x,last.y,1.1,0,Math.PI*2); g.fillStyle='#0f2a6b'; g.fill();
    try{ c.setPointerCapture(e.pointerId); }catch(_e){ /* some browsers refuse capture; drawing still works inside the box */ } });
  c.addEventListener('pointermove',function(e){ if(!drawing) return; e.preventDefault(); const p=pt(e);
    // A captured pointer keeps reporting after it leaves the box; nothing is drawn outside it.
    const b=c.getBoundingClientRect(); if(p.x<0||p.y<0||p.x>b.width||p.y>b.height){ last=null; return; }
    if(last){ g.beginPath(); g.moveTo(last.x,last.y); g.lineTo(p.x,p.y); g.stroke(); } last=p; });
  const end=function(){ if(!drawing) return; drawing=false; last=null; if(inked){ SIGS[i]=c.toDataURL('image/png'); const k='sig.'+i; if(ERR[k]){ delete ERR[k]; const f=document.getElementById('f-sig-'+i); if(f) f.classList.remove('bad'); } } };
  c.addEventListener('pointerup',end); c.addEventListener('pointercancel',end); c.addEventListener('lostpointercapture',end);
}

// ---------------------------------------------------------------- events
document.addEventListener('input',function(e){
  const k=e.target.getAttribute&&e.target.getAttribute('data-k'); if(!k) return;
  let v=e.target.value;
  if(/\.(pan|passport)$|flat_no$|pay\.ref$/.test(k)) v=v.toUpperCase();
  if(/aadhaar$/.test(k)) v=v.replace(/[^\d ]/g,'');
  if(/(price\.total|price\.rate|pay\.amount)$/.test(k)) v=v.replace(/[^\d]/g,'');
  if(v!==e.target.value){ const pos=e.target.selectionStart; e.target.value=v; try{ e.target.setSelectionRange(pos,pos); }catch(_e){} }
  set(k,v);
  if(k==='pay.amount'){ const w=$('w-amount'); if(w) w.textContent=words(v); }
  if(k==='price.total'){ const w=$('w-total'); if(w) w.textContent=words(v); }
  if(ERR[k]){ delete ERR[k]; const f=document.getElementById('f-'+k.replace(/\./g,'-')); if(f) f.classList.remove('bad'); }
});
document.addEventListener('change',function(e){
  const t=e.target;
  const k=t.getAttribute&&t.getAttribute('data-k');
  if(k&&t.tagName==='SELECT'){ set(k,t.value);
    if(/nationality$|country$/.test(k)){ if(/country$/.test(k)&&t.value!=='India') set(k.replace('country','state'),''); else if(/country$/.test(k)) set(k.replace('country','state'),'West Bengal');
      if(k==='res.country'){ const c=COUNTRIES.filter(function(x){ return x[0]===t.value; })[0]; if(c&&c[2]) S.contact.cc=c[2]; }
      render(); } return; }
  const ck=t.getAttribute&&t.getAttribute('data-check');
  if(ck){ set(ck,t.checked); if(ck==='off.on'){ if(!t.checked){ S.mailing='Residential'; S.permanent='Residential'; } render(); } else if(ERR[ck]){ delete ERR[ck]; render(); } return; }
  const fk=t.getAttribute&&t.getAttribute('data-file');
  if(fk&&t.files&&t.files[0]){ const parts=fk.split('|'), f=t.files[0];
    if(f.size>10*1024*1024){ toast('That file is over 10 MB - please take a smaller photo'); return; }
    if(!/^image\//.test(f.type)&&f.type!=='application/pdf'){ toast('Please attach a photo or a PDF'); return; }
    FILES[+parts[0]][parts[1]].push(f); delete ERR['doc.'+parts[0]+'.'+parts[1]]; render(); }
});
document.addEventListener('click',function(e){
  const b=e.target.closest&&e.target.closest('button'); if(!b) return;
  if(b.dataset.chip){ set(b.dataset.chip,b.dataset.v); delete ERR[b.dataset.chip]; render(); return; }
  if(b.dataset.add){ S.applicants.push(newApp()); FILES.push({pan:[],aadhaar:[]}); SIGS.push(null); save(); render();
    const cards=document.querySelectorAll('.app'); cards[cards.length-1].scrollIntoView({behavior:'smooth',block:'start'}); return; }
  if(b.dataset.rm){ const i=+b.dataset.rm; if(!confirm('Remove applicant '+(i+1)+'?')) return; S.applicants.splice(i,1); FILES.splice(i,1); SIGS.splice(i,1); save(); render(); return; }
  if(b.dataset.delfile){ const p=b.dataset.delfile.split('|'); FILES[+p[0]][p[1]].splice(+p[2],1); render(); return; }
  if(b.dataset.clearsig){ SIGS[+b.dataset.clearsig]=null; render(); return; }
  if(b.dataset.go){ go(+b.dataset.go); return; }
  if(b.dataset.back){ go(S.step-1); return; }
  if(b.dataset.next){
    if(S.step===STEPS.length-1){ submit(); return; }
    if(!check(S.step)){ showErrors(); return; }
    // Files and signatures cannot be kept on the phone between visits; say so before the review.
    go(S.step+1);
  }
});

// ---------------------------------------------------------------- submit
function dataURLtoBlob(u){ const p=u.split(','), bin=atob(p[1]), a=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return new Blob([a],{type:'image/png'}); }
async function submit(){
  for(let s=0;s<STEPS.length-1;s++){ if(!check(s)){ S.step=s; save(); showErrors(); return; } }
  const btn=$('nextBtn'); btn.disabled=true; btn.textContent='Sending… please keep this page open';
  const data=JSON.parse(JSON.stringify(S)); delete data.step;
  data.website=($('hpWeb')||{}).value||'';
  data.applicants.forEach(function(a){ a.pan=a.pan.toUpperCase(); a.aadhaar=a.aadhaar.replace(/\s/g,''); });
  data.submitted_on_device=new Date().toString();
  const fd=new FormData();
  fd.append('data',JSON.stringify(data));
  FILES.forEach(function(f,i){ ['pan','aadhaar'].forEach(function(kind){ f[kind].forEach(function(file,n){ fd.append('f_'+i+'_'+kind+'_'+n,file,file.name); }); }); });
  SIGS.forEach(function(s,i){ if(s) fd.append('sig_'+i,dataURLtoBlob(s),'signature_'+(i+1)+'.png'); });
  try{
    const r=await fetch(FN,{method:'POST',body:fd});
    const j=await r.json().catch(function(){ return {}; });
    if(!r.ok||!j.ok) throw new Error(j.error||('Could not send (error '+r.status+')'));
    try{ localStorage.removeItem(DRAFT_KEY); }catch(e){}
    $('steps').innerHTML=''; $('nav').innerHTML='';
    $('app').innerHTML='<div class="sec done"><div class="ok">✓</div><h2>Thank you! Your booking form has been received.</h2>'
      +'<p class="hint" style="margin-top:8px">Your reference number</p><div class="ref">'+esc(j.ref_no)+'</div>'
      +'<p class="hint">Please keep this number. Our team will call you shortly to confirm your booking.</p></div>';
    window.scrollTo(0,0);
  }catch(e){
    btn.disabled=false; btn.textContent='Submit booking form';
    alert(e.message||'Could not send. Please check your internet and try again.');
  }
}

if(!CONF){ $('app').innerHTML='<div class="sec"><h2>This booking link is not valid.</h2><p class="hint">Please use the exact link our team sent you.</p></div>'; return; }
// Coming back to a saved draft: files and signatures were not kept, so start from the first step
// that needs them only when the customer gets there.
if(S.step>3) S.step=3;
render();
})();
