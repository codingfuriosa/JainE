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
let CONF=({ananta:{name:'Dream Ananta',company:'Dream Gateway Hotels Ltd.',address:'44/2A Hazra Road, Kolkata – 700 019',blocks:['Block D','Block E'],floors:8,
  bhk:['2 BHK','3 BHK','4 BHK'],bhkDefault:'3 BHK',showRate:false,logo:'assets/brand/dream-ananta-logo.png'}})[PROJECT];   // generated links replace this with their own project (setProject)
/* A GENERATED LINK (booking-form.html?t=<token>, made by Sales with "Generate Form", 7 Nov 2026): the same page for everybody.
   The server holds what Sales filled in (LOCK = those answers: shown, never editable) and the customer's draft, which is saved
   on the server as they go - so closing the tab and opening the link again lands on the same step with everything filled.
   LINK is set once the server has opened it. The open link (?p=ananta) works as before, with answers kept on the phone. */
const TOKEN=(new URLSearchParams(location.search).get('t')||'').trim().toLowerCase();
let LINK=null;
let RO=false;   // a submitted form opened again through its link: shown as it was saved, nothing can be changed
const LOCK=new Set();
const DRAFT_KEY='jg-booking-form-'+PROJECT+'-v2';
const MAX_APPS=6, MAX_REASONS=5;
const STEPS=[['Applicant details'],['Contact & address'],['Occupation & source'],['Unit details'],['Booking amount'],['KYC documents'],['Terms & cost sheet'],['Review & submit']];

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
  mailing:'Residential',permanent:'Residential',mailing_other:'',permanent_other:'',
  profession:{kind:'Salaried',company:'',designation:'',income:'',community:'',newspaper:'',magazine:'',tv:'',radio:''},
  heard:'Facebook',heard_other:'',why:[''],
  flat:{block:'',floor:'',flat_no:'',bhk:CONF?CONF.bhkDefault:'',parking:'Covered'},
  price:{sba:'',basic:'',plc:'',flc:'',rate:'',total:'',loan:'No',bank:'',plan:'Construction Linked'},
  pay:{mode:'UPI / NEFT / RTGS',amount:'',ref:'',bank:'',branch:'',date:''},
  purpose:'Residential',sales:'Direct',sales_name:'',lead_id:'',terms_accepted:false}; }
let S; if(TOKEN) S=fresh(); else try{ const d=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null')||{}, f=fresh(); S=Object.assign(f,d); ['price','profession'].forEach(function(k){ S[k]=Object.assign(fresh()[k],d[k]||{}); }); }catch(e){ S=fresh(); }
if(!Array.isArray(S.applicants)||!S.applicants.length) S.applicants=[newApp()];
if(!Array.isArray(S.why)||!S.why.length) S.why=[''];
/* The documents each applicant attaches (19 Nov 2026: passport for a foreign national, an optional photograph, and on the first applicant the payment proof). */
const DOC_KINDS=['pan','aadhaar','passport','photo','payment'];
function blankFiles(){ return {pan:[],aadhaar:[],passport:[],photo:[],payment:[]}; }
// Files and the signature live only in this page (too big for the draft).
let FILES=S.applicants.map(function(){ return blankFiles(); });
let OTP_REQUIRED=false;   // a generated link made with a cost sheet is submitted with an emailed code
let FROM_REVIEW=false;   // true while one section is being edited from the last (review) page: Continue / Back return straight there
let PASS_OPEN=new Set();   // applicants whose Passport & bank panel was opened by hand (it is always open for a non-Indian applicant)
let SPOUSE_OPEN=!!(S.applicants[0]&&(S.applicants[0].spouse||S.applicants[0].anniversary));   // Spouse & anniversary: hidden until asked for
let ERR={}, MISSING=[];
const $=function(id){ return document.getElementById(id); };
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function save(){ if(LINK){ scheduleSync(); return; } try{ localStorage.setItem(DRAFT_KEY,JSON.stringify(S)); }catch(e){} }
function get(path){ return path.split('.').reduce(function(o,k){ return o==null?o:o[k]; },S); }
function set(path,v){ const ks=path.split('.'); let o=S; for(let i=0;i<ks.length-1;i++) o=o[ks[i]]; o[ks[ks.length-1]]=v; save(); }
function toast(m){ const t=document.createElement('div'); t.className='toast'; t.textContent=m; document.body.appendChild(t); setTimeout(function(){ t.remove(); },2600); }
const fid=function(path){ return 'f-'+path.replace(/\./g,'-'); };

// ---------------------------------------------------------------- building blocks
// A section: a plain title (and a short line under it), then its fields. The first two arguments
// (an icon and a colour) are no longer used.
function card(icon,color,title,hint,body){
  return '<div class="sec"><div class="sh"><h2>'+title+'</h2>'+(hint?'<p>'+hint+'</p>':'')+'</div><div class="sb">'+body+'</div></div>';
}
// Line icons (no emoji), drawn in the text colour.
const ICON={
  camera:'<svg class="i" viewBox="0 0 24 24"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  pen:'<svg class="i" viewBox="0 0 24 24"><path d="M16.5 3.5l4 4L8 20H4v-4z"/><path d="M14 6l4 4"/></svg>',
  check:'<svg class="i" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  lock:'<svg class="lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'};
function wrapF(path,label,o,inner){
  return '<div class="f'+(o.full?' full':'')+(o.wide?' wide':'')+(LOCK.has(path)?' locked':'')+(o.req?' need':'')+(ERR[path]?' bad':'')+'" id="'+fid(path)+'"><label>'+esc(label)+(LOCK.has(path)?ICON.lock:'')
    +(o.req?' <span class="req">*</span>':(o.optional?' <span class="opt">(optional)</span>':''))+(o.note?' <span class="opt">'+esc(o.note)+'</span>':'')+'</label>'
    +inner+'<div class="err">'+esc(ERR[path]||'')+'</div></div>';
}
function field(path,label,o){
  o=o||{}; const v=get(path);
  const ro=LOCK.has(path)?' readonly tabindex="-1"':'';
  const ph=' placeholder="'+esc(LOCK.has(path)&&!v?'Set by our team':(o.ph||' '))+'"'+ro;
  const ctl=o.type==='area'?'<textarea data-k="'+path+'"'+ph+'>'+esc(v)+'</textarea>'
    :'<input type="'+(o.type||'text')+'" data-k="'+path+'" value="'+esc(v)+'"'+ph+(o.cls?' class="'+o.cls+'"':'')
      +(o.mode?' inputmode="'+o.mode+'"':'')+(o.max?' maxlength="'+o.max+'"':'')+' autocomplete="'+(o.auto||'off')+'"'+(o.req&&o.type==='date'?' required':'')+'>';
  return wrapF(path,label,o,(o.before||'')+ctl+(o.after||''));
}
/* Choice pills: small and as wide as their words, wrapping onto a second line when a row is full
   (the user preferred this to equal-width buttons squeezed into one row, 2 Nov 2026). */
function chips(path,label,options,o){
  o=o||{}; const v=get(path);
  return wrapF(path,label,Object.assign({full:o.full!==false},o),'<div class="chips'+(o.num?' num':'')+'" role="radiogroup">'
    +options.map(function(x){ const val=Array.isArray(x)?x[0]:x, txt=Array.isArray(x)?x[1]:x;
      return '<button type="button" class="chip'+(v===val?' on':'')+'" role="radio" aria-checked="'+(v===val)+'" data-chip="'+path+'" data-v="'+esc(val)+'"'+(LOCK.has(path)?' disabled':'')+'>'+esc(txt)+'</button>'; }).join('')+'</div>');
}
// A dropdown that looks like the rest of the form: a button that opens a list (a sheet on phones).
function pick(path,label,kind,o){
  o=o||{}; const v=get(path);
  let shown=esc(v||o.blank||'Choose');
  if(kind==='country'){ const c=byName(v); shown=(c?'<img class="flag" src="'+flagUrl(c[1])+'" alt="">':'')+'<span class="v">'+esc(v)+'</span>'; }
  else if(kind==='dial'){ const c=byDial(v); shown=(c?'<img class="flag" src="'+flagUrl(c[1])+'" alt="">':'')+'<span class="v">'+esc(v)+'</span>'; }
  else shown='<span class="v">'+shown+'</span>';
  const btn='<button type="button" class="pick" data-pick="'+path+'" data-kind="'+kind+'"'+(LOCK.has(path)?' disabled':'')+'>'+shown+'</button>';
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
/* COST SHEET & PAYMENT PLAN (19 Nov 2026, Ayush: "below Applicant Details and before the first form, a full-length dropdown named Cost Sheet and Payment Plan
   ... it should blink, because the customer does not proceed without seeing the cost sheet price"). It pulses until it has been opened once, and Continue on
   this page waits until it has been (S.cost_seen). */
let COST_OPEN=false;
function costPanel(){
  if(!COST.meta) return '';
  return '<div class="cpanel'+(S.cost_seen?'':' blink')+(COST_OPEN?' on':'')+(ERR.cost_seen?' bad':'')+'" id="f-cost_seen"><button type="button" class="cph" data-costpanel="1" aria-expanded="'+COST_OPEN+'">'
    +'<span><b>Cost Sheet and Payment Plan</b><small>'+(S.cost_seen?'Prepared for you by our Sales team':'Please open and read this before you continue')+'</small></span><span class="car">'+(COST_OPEN?'−':'+')+'</span></button>'
    +(COST_OPEN?'<div class="cpb">'+costBody()+'</div>':'')+(ERR.cost_seen?'<div class="err" style="padding:0 16px 12px">'+esc(ERR.cost_seen)+'</div>':'')+'</div>';
}
function stepApplicants(){
  return costPanel()+card('','','Applicant details','Every person in whose name the unit is to be booked. Joint applicants can be added below.',
    S.applicants.map(function(a,i){
      const p='applicants.'+i+'.', foreign=a.nationality!=='India';
      /* One column, in small labelled groups, so a person always knows which part they are on:
         who they are, then their ID documents, then (first applicant only, folded away) family. */
      const F={full:1};
      return '<div class="app"><div class="ah"><span class="num">'+(i+1)+'</span><b>'+(i?'Joint applicant':'First / sole applicant')+'</b>'
          +(S.applicants.length>1&&!(LINK&&i===0)?'<button type="button" class="rm" data-rm="'+i+'">Remove</button>':'')+'</div>'
        +'<div class="grp g1">Personal details</div><div class="stack s1">'
        +chips(p+'title','Title',['Mr.','Ms.','Mrs.','Mast.','M/s.'],{sm:1,mcols:5})
        +field(p+'full_name','Full name (as on PAN card)',{req:1,full:1,cls:'up',auto:i?'off':'name'})
        +chips(p+'relation','Son / Daughter / Wife / Care of',['S/o','D/o','W/o','C/o'],{sm:1,mcols:4})
        +field(p+'relation_name',({'S/o':"Father's",'D/o':"Father's",'W/o':"Husband's",'C/o':"Guardian's"}[a.relation]||"Father's")+' name',{req:1,full:1,cls:'up'})
        +(i===0?field(p+'dob','Date of birth',{type:'date',req:1,full:1}):'')
        +'</div><div class="grp g2">Identity &amp; occupation</div><div class="stack s2">'
        +pick(p+'nationality','Nationality / Country','country',F)
        /* 19 Nov 2026 (Ayush): the Aadhaar number comes first and is compulsory for an Indian national; a foreign national gives no Aadhaar (their
           passport, and its number, are asked for on the KYC documents page instead). There are no bank details any more. */
        +(foreign?'':field(p+'aadhaar','Aadhaar number',{mode:'numeric',max:14,ph:'1234 5678 9012',req:1,full:1}))
        +field(p+'pan','PAN number',{cls:'up',max:10,ph:'ABCDE1234F',req:1,full:1})   /* 19 Nov 2026: PAN is compulsory for everybody */
        +chips(p+'occupation','Occupation',['Salaried','Business'],{sm:1})
        +'</div>'
        +(i===0?(function(){
          const spOpen=SPOUSE_OPEN;   // the Spouse & anniversary bar alone, full width
          return '<div class="xts one">'
            +'<button type="button" class="tg bsp'+(spOpen?' on':'')+'" data-sp="1">'+(spOpen?'−':'+')+' Spouse &amp; anniversary <span class="opt">(optional)</span></button>'
            +(spOpen?'<div class="xp sp"><div class="xp-h">Spouse &amp; anniversary <span class="opt">(optional)</span></div><div class="xp-b">'+field(p+'spouse','Spouse name',{optional:1,cls:'up',full:1})+field(p+'anniversary','Marriage anniversary',{type:'date',optional:1,full:1})+'</div></div>':'')
            +'</div>';
        })():'')
        +'</div>';
    }).join('')
    +(S.applicants.length<MAX_APPS?'<button type="button" class="btn add" data-add="1">+ Add another applicant</button>':''));
}
/* 19 Nov 2026 (Ayush: "the addresses suggested will show only of the particular country chosen"): the country is the first applicant's nationality; outside
   India the PIN code is a postal / ZIP code of any shape. */
function addrCountry(){ const a=S.applicants[0]||{}; return byName(a.nationality||'India')||byName('India'); }
function addrIndia(){ return addrCountry()[0]==='India'; }
function addrBody(k){
  return '<div class="grid">'
    +'<div class="full ac">'+field(k+'.line','House, street and area',{type:'area',full:1,req:k==='res'||S.off.on,ph:'Type your address'})+'<div id="ac-'+k+'"></div></div>'
    +'<div class="pair">'+field(k+'.city','City / Town',{req:1,auto:k==='res'?'address-level2':'off'})
    +(addrIndia()?field(k+'.pin','PIN code',{mode:'numeric',max:6,req:1,auto:k==='res'?'postal-code':'off'}):field(k+'.pin','Postal / ZIP code',{max:10,req:1,cls:'up',auto:k==='res'?'postal-code':'off'}))+'</div></div>';
}
function stepContact(){
  const a=S.applicants[0];
  return card('','','Contact details','Of the first applicant. All letters and receipts are sent here.',
      '<div class="grid">'
      +field('contact.mobile','Mobile number',{type:'tel',req:1,full:1,mode:'tel',auto:'tel-national',
        before:'<div class="pre">'+pick('contact.cc','','dial',{bare:1}),after:'</div>'})
      +field('contact.email','Email',{type:'email',req:1,full:1,auto:'email',mode:'email'})
      +field('contact.contact_person','Primary contact person',{optional:1,full:1})+'</div>')
    +card('','','Residential address','',addrBody('res'))
    +card('','','Office address','Optional',
      '<label class="switch"><input type="checkbox" data-check="off.on"'+(S.off.on?' checked':'')+'><span><b>I want to add an office address</b></span></label>'
      +(S.off.on?'<div style="margin-top:16px">'+addrBody('off')+'</div>':''))
    +card('','','Mailing & permanent address','Which address to use. Choose Other to give a different one.',
      '<div class="grid">'
      +chips('mailing','Send our letters to',S.off.on?['Residential','Office','Other']:['Residential','Other'])
      +(S.mailing==='Other'?field('mailing_other','Mailing address',{type:'area',full:1,req:1,ph:'House, street, area, city and PIN code'}):'')
      +chips('permanent','Permanent address',S.off.on?['Residential','Office','Other']:['Residential','Other'])
      +(S.permanent==='Other'?field('permanent_other','Permanent address',{type:'area',full:1,req:1,ph:'House, street, area, city and PIN code'}):'')
      +'</div>');
}
function stepAbout(){
  return card('','','Occupation','',
      '<div class="grid">'+chips('profession.kind','Profession',['Salaried','Self-Employed','Govt. Employee','Others'],{mcols:4,sm:1})
      +'<div class="pair">'+field('profession.company','Company',{optional:1})+field('profession.designation','Designation',{optional:1})+'</div></div>'
      +'<details class="t opt-d"><summary><span>More about you <span class="opt">(optional)</span></span></summary>'
        +'<div class="stack" style="padding:0 14px 14px">'
        +field('profession.income','Gross income',{optional:1})+field('profession.community','Community',{optional:1})
        +field('profession.newspaper','Favourite newspaper',{optional:1})+field('profession.magazine','Magazine',{optional:1})
        +field('profession.tv','TV channel',{optional:1})+field('profession.radio','Radio station / frequency',{optional:1})
        +'</div></details>')
    +card('','','Source','',
      '<div class="grid">'
      +chips('heard','How did you come to know about the project?',['Facebook','Instagram','Google','Channel Partners','Other'])
      +(S.heard==='Other'?field('heard_other','Where did you hear about it?',{full:1,req:1}):'')
      +'<div class="f full"><label>Why did you choose this project? <span class="opt">(optional)</span></label>'
        +S.why.map(function(w,i){ return '<div style="display:flex;gap:8px;align-items:center"><span class="num" style="width:26px;height:26px;border-radius:50%;background:#f1ede6;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex:none">'+(i+1)+'</span>'
          +'<input type="text" data-k="why.'+i+'" value="'+esc(w)+'" placeholder=" " autocomplete="off">'
          +(i?'<button type="button" class="rm lnk" style="color:var(--err);padding:8px" data-rmwhy="'+i+'" aria-label="Remove">×</button>':'')+'</div>'; }).join('')
        +(S.why.length<MAX_REASONS?'<button type="button" class="btn add2" data-addwhy="1">+ Add another reason</button>':'')
      +'</div></div>');
}
function stepFlat(){
  const floors=[]; for(let i=1;i<=(CONF.floors||8);i++) floors.push(String(i));
  const agreed=LINK?'As agreed with our sales team.':null;
  const rate=CONF.showRate?'<div class="f full"><label>Rate per sq.ft. (₹)</label>'
        +'<div class="rate">'
          +'<div class="f">'+'<label class="sub">Basic</label><input type="text" inputmode="decimal" data-k="price.basic" value="'+esc(S.price.basic)+'" placeholder=" " autocomplete="off"></div><span class="op">+</span>'
          +'<div class="f">'+'<label class="sub">PLC</label><input type="text" inputmode="decimal" data-k="price.plc" value="'+esc(S.price.plc)+'" placeholder=" " autocomplete="off"></div><span class="op">+</span>'
          +'<div class="f">'+'<label class="sub">FLC</label><input type="text" inputmode="decimal" data-k="price.flc" value="'+esc(S.price.flc)+'" placeholder=" " autocomplete="off"></div><span class="op">=</span>'
          +'<div class="f">'+'<label class="sub">Total</label><div class="sum" id="w-rate">'+esc(rateTotal()?('₹'+fmtN(rateTotal())):'—')+'</div></div>'
        +'</div><div class="words">PLC: preferential location charge · FLC: floor rise charge</div></div>':'';
  /* 19 Nov 2026 (Ayush): on a link from our Sales team the unit, size, price and booking amount are fixed - shown in full, never editable (the server puts them
     back too); "Location" is "Your unit" (it read like a map address); car parks can be several, or NA; the payment plan choice is gone (it is in the cost sheet)
     and only "Home loan required?" stays in that strip. */
  const fixed=LINK&&LOCK.size;
  const parks=parkList();
  const parkCtl=LOCK.has('flat.parkings')||LOCK.has('flat.parking')
    ?wrapF('flat.parkings','Right to use car park',{full:1},'<div class="chips">'+(parks.length?parks:['NA']).map(function(x,i){ return '<button type="button" class="chip on" disabled>'+(parks.length>1?(i+1)+'. ':'')+esc(x)+'</button>'; }).join('')+'</div>')
    :chips('flat.parking','Right to use car park',['Covered','Open','NA']);
  return card('','','Unit selection',fixed?'Fixed by our sales team as agreed with you - shown here for you to check.':(agreed||'As discussed with our sales team. The flat number may be left blank if not yet allotted.'),
      '<div class="pn2">'
      +'<div class="pnl"><div class="grp">Your unit</div><div class="stack">'
      +chips('flat.block','Block',CONF.blocks,{req:!LOCK.has('flat.block')})
      +chips('flat.floor','Floor',floors,{num:1,cols:8,mcols:4})
      +field('flat.flat_no','Flat number',{cls:'up',ph:'e.g. 5A',max:8,optional:!LOCK.has('flat.flat_no')})
      +chips('flat.bhk','Bedrooms',CONF.bhk)
      +'</div></div>'
      /* 19 Nov 2026 (Ayush: "Configuration has too much negative space"; "Flat & Size & Price not divided properly, nothing looks aligned"): one card, two
         equal panels side by side - the unit on the left (block, floor, flat, bedrooms), its car parks, size and price on the right - instead of a half-empty
         Configuration panel and a separate Area & price card with a lone field. */
      +'<div class="pnl"><div class="grp">Size &amp; price</div><div class="stack">'
      +parkCtl
      +field('price.sba','Super built-up area (sq.ft.)',{mode:'decimal',full:1})
      +rate
      +field('price.total','Estimated Sale Price (₹)',{mode:'numeric',full:1,after:'<div class="words" id="w-total">'+esc(words(S.price.total))+'</div>'+(CONF.showRate?'<div class="words" id="w-calc">'+esc(calcHint())+'</div>':'')})
      +(S.price.booking||LOCK.has('price.booking')?field('price.booking','Booking price (₹)',{mode:'numeric',full:1,after:'<div class="words">'+esc(words(S.price.booking))+'</div>'}):'')
      +'</div></div>'
      +'</div>')
    +card('','','Home loan','',
      '<div class="grid">'
      +chips('price.loan','Home loan required?',['No','Yes'])
      +(S.price.loan==='Yes'?field('price.bank','Preferred bank / institution',{optional:1,full:1,wide:1}):'')+'</div>');
}
// the car parks: Sales' list on a generated link, else the one choice on the page
function parkList(){ const f=S.flat||{}; return (Array.isArray(f.parkings)&&f.parkings.length?f.parkings:(f.parking?[f.parking]:[])).filter(Boolean).map(String); }
/* 7 Nov 2026: "Name of our sales person" and "Lead ID" are hidden for now (not usually something the customer knows) -
   the user asked to keep reminding about it. To bring them back, set this to true. */
const SHOW_SALES_FIELDS=false;
function stepPay(){
  // 19 Nov 2026: no Cheque; the amount is the Booking Amount set by our Sales team (fixed); the payment proof is attached right below it (compulsory)
  if(S.pay.mode==='Cheque') S.pay.mode='UPI / NEFT / RTGS';
  const chq=S.pay.mode==='Demand Draft';
  const proof='doc.0.payment';
  return card('','','Booking amount','Paid in favour of '+esc(String(CONF.company||'').replace(/[.]+$/,''))+'. Cash is not accepted.',
      /* 19 Nov 2026 (Ayush: "the Booking Amount page's first section is a bit cluttered"): every field of this card now has its label ABOVE it and sits in the same
         two-column grid - Paid by | Booking Amount on the first row, the receipts | date, reference, bank under them - instead of mixing label-on-the-left rows
         with label-above boxes. Wording unchanged. */
      '<div class="grid">'
      +'<div class="paygrid"><div class="pcol">'+chips('pay.mode','Paid by',['UPI / NEFT / RTGS','Demand Draft','Card'],{mcols:3})+'</div>'
      +'<div class="pcol">'+field('pay.amount','Booking Amount (₹)',{mode:'numeric',req:!LOCK.has('pay.amount'),full:1,after:'<div class="words" id="w-amount">'+esc(words(S.pay.amount))+'</div>'})+'</div>'
      /* 19 Nov 2026 (Ayush): any number of receipts; they list down the left while date, reference and bank sit on the right (Bank below the reference),
         so more receipts only make the left column longer. On a phone the two simply follow each other. */
      // with fewer than 3 receipts Bank sits on the left under them; from the 3rd receipt it moves to the right, under the reference (Ayush, 19 Nov 2026)
      +(function(){
        const nRc=((FILES[0]&&FILES[0].payment)||[]).length;
        const bank=chq?field('pay.bank','Bank (drawn on)',{req:1,full:1})+field('pay.branch','Branch',{optional:1,full:1}):field('pay.bank','Bank',{optional:1,full:1});
        return '<div class="pcol">'
          +wrapF(proof,'Payment proof',{full:1,req:1,note:'Screenshots or receipts of the payment - add as many as you need'},docUpl(0,'payment','Take a photo or attach the receipt','The UTR / transaction number should be readable',10))
          +(nRc<3?bank:'')
          +'</div><div class="pcol">'
          +field('pay.date',chq?'DD date':'Date paid',{type:'date',req:1,full:1})
          +field('pay.ref',({'Demand Draft':'DD number','Card':'Card transaction ID'}[S.pay.mode]||'UTR / transaction reference'),{optional:1,cls:'up',full:1})   /* optional (19 Nov 2026) */
          +(nRc>=3?bank:'')
          +'</div>';
      })()
      +'</div></div>')
    +card('','','Booking details','',
      '<div class="grid">'
      +chips('purpose','Purpose of booking',['Residential','Investment'])
      +chips('sales','Booked through',['Direct','Booking agent / Channel partner'])
      +(SHOW_SALES_FIELDS?field('sales_name',S.sales==='Direct'?'Name of our sales person':'Name of agent / channel partner',{optional:S.sales==='Direct',req:S.sales!=='Direct'})
      +field('lead_id','Lead ID',{optional:1,ph:'If our team gave you one'}):'')+'</div>');
}
// Basic + PLC + FLC, per sq.ft. - only when at least one is given.
function rateTotal(){ const p=S.price, xs=[p.basic,p.plc,p.flc].filter(function(v){ return String(v||'').trim()!==''; }); return xs.length?xs.reduce(function(s,v){ return s+Number(v||0); },0):0; }
function fmtN(n){ return Number(n).toLocaleString('en-IN',{maximumFractionDigits:2}); }
// A help line only, never filled in for the customer: area x rate, to compare with the price they write.
function calcHint(){ const a=Number(S.price.sba||0), r=rateTotal(); return a&&r?'Area × rate = ₹'+fmtN(Math.round(a*r)):''; }
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
    const img=f.saved?'<div class="pdf">'+(f.ext==='pdf'?'PDF':'IMG')+'</div>':/^image\//.test(f.type)?'<img src="'+URL.createObjectURL(f)+'" alt="">':'<div class="pdf">PDF</div>';
    return '<div class="file">'+img+'<span>'+esc(f.name)+'</span><button type="button" data-delfile="'+i+'|'+kind+'|'+n+'" aria-label="Remove">×</button></div>';
  }).join('');
}
// The attach box of one document: what is attached, and (until 2 are) a button to take a photo or pick a file.
function docUpl(i,kind,first,hint,max){
  const L=(FILES[i]&&FILES[i][kind])||[];
  return '<div class="upl">'+fileList(i,kind)
    +(L.length<(max||2)?'<label class="pk'+(L.length?' more':'')+'"><span class="pi">'+ICON.camera+'</span><span><b>'+(L.length?'Add another':first)+'</b>'
      +(L.length?'':'<small>'+hint+'</small>')+'</span><input type="file" accept="'+(kind==='photo'?'image/*':'image/*,application/pdf')+'" data-file="'+i+'|'+kind+'"></label>':'')+'</div>';
}
/* 19 Nov 2026 (Ayush): every applicant has their own clearly numbered card ("which PAN or Aadhaar is for whom should be very visible"); an Indian national gives
   PAN and Aadhaar; anyone else gives their Passport (compulsory) with its number (optional, typed here - it is no longer on the first page) and PAN if they have
   one; everybody may add a passport-size photograph. */
function stepDocs(){
  return S.applicants.map(function(a,i){
    const foreign=a.nationality!=='India', p='applicants.'+i+'.';
    const who=[a.title,a.full_name].filter(Boolean).join(' ')||('Applicant '+(i+1));
    const box=function(kind,label,req,first,hint){ return wrapF('doc.'+i+'.'+kind,label,{full:1,wide:kind==='photo'&&!foreign,req:req,optional:!req},docUpl(i,kind,first,hint)); };   // the photograph runs the full width for an Indian national; for a foreign national it sits beside the PAN card, half and half (19 Nov 2026)
    return '<div class="sec doc-app"><div class="dah"><span class="dan">'+(i+1)+'</span><div><b>'+esc(who)+'</b><small>'+(i?'Joint applicant '+(i+1):'First / sole applicant')+' · '+esc(a.nationality||'India')+'</small></div></div><div class="sb">'
      +'<div class="grid">'
      +(foreign
        ?box('passport','Passport',true,'Take a photo or attach a PDF','The photo page, with the number readable')
          +field(p+'passport','Passport number',{cls:'up',req:1,full:1,ph:'As on the passport'})
          +box('pan','PAN card',true,'Take a photo or attach a PDF','Make sure the number is readable')
        :box('pan','PAN card',true,'Take a photo or attach a PDF','Make sure the number is readable')
          +box('aadhaar','Aadhaar card',true,'Take a photo or attach a PDF','Front and back can be two photos'))
      +box('photo','Photograph',false,'Take or attach a photo','A recent passport-size photo of '+esc(a.full_name||'this applicant'))
      +'</div></div></div>';
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
  const co=CONF.company||'';
  const list=function(arr){ return '<ol>'+arr.map(function(t){ return '<li>'+esc(t.split('Dream Gateway Hotels Ltd.').join(co)).replace(/&lt;br&gt;&lt;br&gt;/g,'<br><br>')+'</li>'; }).join('')+'</ol>'; };
  /* 13 Nov 2026: terms first, then the cost sheet (as pictures), and the tick to agree comes last. There is no signature any more. */
  return card('','','Terms & conditions','Open each section to read it in full.',
      '<details class="t"><summary>Terms of application (15)</summary>'+list(TERMS)+'</details>'
      +'<details class="t"><summary>Declaration (2)</summary>'+list(DECL)+'</details>'
      +'<details class="t"><summary>Special Conditions (11)</summary>'+list(SPECIAL)+'</details>')
    // 19 Nov 2026: the cost sheet is at the top of the form AND here again, just before the customer agrees to it (Ayush: "why is there no cost sheet in the Terms page")
    +(COST.meta?card('','','Cost sheet','Prepared for you by our Sales team. Tap a page to zoom in; you can download it too.',costBody()):'')
    +card('','','Agreement','',
      '<label class="agree'+(ERR.terms_accepted?' bad':'')+'" id="f-terms_accepted"><input type="checkbox" data-check="terms_accepted"'+(S.terms_accepted?' checked':'')+'><span><b>I/We have read and agree to all the above'+(COST.meta?' and to the cost sheet':'')+'.</b><br><span style="color:var(--slate);font-size:13px">I/We confirm that everything in this form is true.</span><div class="err">'+esc(ERR.terms_accepted||'')+'</div></span></label>');
}
// The Terms, Declaration and Special Conditions, folded - for the submitted form (19 Nov 2026: "in this page ... collapsible")
function termsBlock(){
  const co=CONF.company||'';
  const list=function(arr){ return '<ol>'+arr.map(function(t){ return '<li>'+esc(t.split('Dream Gateway Hotels Ltd.').join(co)).replace(/&lt;br&gt;&lt;br&gt;/g,'<br><br>')+'</li>'; }).join('')+'</ol>'; };
  return card('','','Terms & conditions','Accepted when the form was submitted. Open a section to read it.',
    '<details class="t"><summary>Terms of application ('+TERMS.length+')</summary>'+list(TERMS)+'</details>'
    +'<details class="t"><summary>Declaration ('+DECL.length+')</summary>'+list(DECL)+'</details>'
    +'<details class="t"><summary>Special Conditions ('+SPECIAL.length+')</summary>'+list(SPECIAL)+'</details>');
}
function rows(pairs){ return '<table class="rv">'+pairs.filter(function(p){ return p[1]!==''&&p[1]!=null; }).map(function(p){ return '<tr><td>'+esc(p[0])+'</td><td>'+esc(p[1])+'</td></tr>'; }).join('')+'</table>'; }
function fmtD(d){ return d?new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):''; }
function addr(x){ return [x.line,x.city,x.pin].filter(Boolean).join(', '); }
function stepReview(){
  const h=function(t,step){ return '<div class="rvh"><h3>'+t+'</h3>'+(RO?'':'<button type="button" data-go="'+step+'">Edit</button>')+'</div>'; };
  return card('','',RO?'Your submitted application':'Review your application',RO?'Saved exactly as you submitted it. It cannot be changed here - please contact our team if something needs correcting.':'Please check every detail. Use Edit to make a change, then submit.',
    S.applicants.map(function(a,i){ return h((i?'Joint applicant '+(i+1):'First applicant'),0)+rows([
      ['Name',a.title+' '+a.full_name],[a.relation,a.relation_name],['Date of birth',i?'':fmtD(a.dob)],['Occupation',a.occupation],['Nationality',a.nationality],
      ['Aadhaar',a.aadhaar],['PAN',a.pan.toUpperCase()],['Passport number',a.passport],
      ['Spouse',i?'':a.spouse],['Anniversary',i?'':fmtD(a.anniversary)],
      ['Documents',(a.nationality!=='India'?['passport','pan','photo']:['pan','aadhaar','photo']).filter(function(k){ return (FILES[i][k]||[]).length; }).map(function(k){ return {pan:'PAN card',aadhaar:'Aadhaar card',passport:'Passport',photo:'Photograph'}[k]; }).join(', ')||'None attached']]); }).join('')
    +h('Contact & address',1)+rows([['Mobile',S.contact.cc+' '+S.contact.mobile],['Email',S.contact.email],['Contact person',S.contact.contact_person],
      ['Residential address',addr(S.res)],['Office address',S.off.on?addr(S.off):''],['Letters to',S.mailing==='Other'?'Other: '+S.mailing_other:S.mailing],['Permanent address',S.permanent==='Other'?'Other: '+S.permanent_other:S.permanent]])
    +h('About you',2)+rows([['Profession',S.profession.kind],['Company',S.profession.company],['Designation',S.profession.designation],
      ['Gross income',S.profession.income],['Community',S.profession.community],['Newspaper',S.profession.newspaper],['Magazine',S.profession.magazine],['TV channel',S.profession.tv],['Radio',S.profession.radio],
      ['Heard about us from',S.heard==='Other'?S.heard_other:S.heard],['Why this project',S.why.filter(Boolean).map(function(w,i){ return (i+1)+'. '+w; }).join('   ')]])
    +h('Your flat',3)+rows([['Block',S.flat.block],['Floor',S.flat.floor],['Flat',String(S.flat.flat_no||'').toUpperCase()],['Bedrooms',S.flat.bhk],['Car park',parkList().join(', ')],
      ['Super built-up area',S.price.sba?S.price.sba+' sq.ft.':''],
      ['Rate / sq.ft.',rateTotal()?'₹'+fmtN(rateTotal())+' (Basic '+(S.price.basic||0)+' + PLC '+(S.price.plc||0)+' + FLC '+(S.price.flc||0)+')':''],
      ['Estimated Sale Price',S.price.total?'₹'+Number(S.price.total).toLocaleString('en-IN'):''],['Booking price',S.price.booking?'₹'+Number(S.price.booking).toLocaleString('en-IN'):''],
      ['Home loan',S.price.loan+(S.price.loan==='Yes'&&S.price.bank?' - '+S.price.bank:'')]])
    +h('Booking amount',4)+rows([['Booking Amount',S.pay.amount?'₹'+Number(S.pay.amount).toLocaleString('en-IN')+' ('+words(S.pay.amount)+')':''],['Payment proof',(FILES[0]&&FILES[0].payment||[]).length?'Attached':''],['Paid by',S.pay.mode],['Reference',S.pay.ref],
      ['Bank / branch',[S.pay.bank,S.pay.branch].filter(Boolean).join(', ')],['Date',fmtD(S.pay.date)],['Purpose',S.purpose],['Booked through',S.sales+(S.sales_name?' - '+S.sales_name:'')],['Lead ID',S.lead_id]])
    +h('Terms & cost sheet',6)+rows([['Cost sheet',COST.meta?COST.meta.name:''],['Terms',S.terms_accepted?'Accepted':'']])
    +'<div class="hp" aria-hidden="true"><input tabindex="-1" autocomplete="off" id="hpWeb"></div>');
}

// ---------------------------------------------------------------- checks per step (the server checks again)
const PAN_RE=/^[A-Z]{5}[0-9]{4}[A-Z]$/;
const LABEL={};
const todayISO=function(){ return new Date().toLocaleDateString('en-CA'); };   // yyyy-mm-dd, the customer's own day
function check(step){
  ERR={}; MISSING=[];
  const need=function(k,msg,lbl){ if(!String(get(k)||'').trim()){ ERR[k]=msg||'Please fill this in'; MISSING.push([k,lbl||msg]); } };
  const bad=function(k,msg,lbl){ ERR[k]=msg; MISSING.push([k,lbl||msg]); };
  if(step===0){
    const pans={}, aads={};
    S.applicants.forEach(function(a,i){ const p='applicants.'+i+'.', who=i?'Applicant '+(i+1)+': ':'';
      need(p+'full_name','Please write the full name',who+'Full name'); need(p+'relation_name',null,who+(a.relation==='W/o'?"Husband's":"Father's")+' name');
      if(i===0) need(p+'dob','Please choose the date of birth','Date of birth');
      if(a.dob&&a.dob>todayISO()) bad(p+'dob','The date of birth cannot be in the future',who+'Date of birth');
      if(a.anniversary&&a.anniversary>todayISO()) bad(p+'anniversary','The anniversary cannot be in the future',who+'Marriage anniversary');
      const pan=a.pan.toUpperCase(), aad=a.nationality==='India'?a.aadhaar.replace(/\s/g,''):'';
      if(a.nationality==='India'&&!aad) bad(p+'aadhaar','Please write the Aadhaar number',who+'Aadhaar number');
      if(!pan) bad(p+'pan','Please write the PAN number',who+'PAN number');
      else if(pan&&!PAN_RE.test(pan)) bad(p+'pan','PAN should look like ABCDE1234F',who+'PAN number');
      else if(pan&&pans[pan]!=null) bad(p+'pan','Same PAN as applicant '+(pans[pan]+1)+' - each applicant has their own',who+'PAN number repeated');
      if(pan) pans[pan]=pans[pan]==null?i:pans[pan];
      if(aad&&!/^\d{12}$/.test(aad)) bad(p+'aadhaar','Aadhaar should be 12 digits',who+'Aadhaar number');
      else if(aad&&aads[aad]!=null) bad(p+'aadhaar','Same Aadhaar as applicant '+(aads[aad]+1)+' - each applicant has their own',who+'Aadhaar number repeated');
      if(aad) aads[aad]=aads[aad]==null?i:aads[aad];
    });
    if(COST.meta&&!S.cost_seen) bad('cost_seen','Please open the Cost Sheet and Payment Plan and read it','Open the Cost Sheet and Payment Plan');
  }
  if(step===1){
    if(S.mailing==='Other') need('mailing_other','Please write the mailing address','Mailing address');
    if(S.permanent==='Other') need('permanent_other','Please write the permanent address','Permanent address');
    const m=S.contact.mobile.replace(/[^\d]/g,'');
    if(S.contact.cc==='+91'?!/^[6-9]\d{9}$/.test(m):m.length<6) bad('contact.mobile','Please write a complete mobile number','Mobile number');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(S.contact.email.trim())) bad('contact.email','Please write a complete email address','Email');
    need('res.line','Please write the address','Residential address'); need('res.city',null,'Residential city');
    const pinOk=function(v){ v=String(v||'').trim(); return addrIndia()?/^\d{6}$/.test(v):/^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/.test(v); };
    const pinMsg=addrIndia()?'PIN code is 6 digits':'Please write the postal / ZIP code';
    if(!pinOk(S.res.pin)) bad('res.pin',pinMsg,'Residential PIN code');
    if(S.off.on){ need('off.line','Please write the address','Office address'); need('off.city',null,'Office city');
      if(!pinOk(S.off.pin)) bad('off.pin',pinMsg,'Office PIN code'); }
  }
  if(step===2){ if(S.heard==='Other') need('heard_other',null,'Where you heard about it'); }
  if(step===3&&!LOCK.has('flat.block')) need('flat.block','Please choose the block','Block');
  if(step===4){
    if(!(Number(S.pay.amount)>0)) bad('pay.amount','Please write the booking amount','Booking Amount');
    if(!((FILES[0]&&FILES[0].payment)||[]).length) bad('doc.0.payment','Please attach the payment proof','Payment proof');
    need('pay.date','Please choose the date','Payment date');
    if(S.pay.date&&S.pay.date>todayISO()) bad('pay.date','The payment date cannot be in the future','Payment date');
    if(S.pay.mode==='Demand Draft') need('pay.bank',null,'Bank');
    if(SHOW_SALES_FIELDS&&S.sales!=='Direct') need('sales_name',null,'Agent / channel partner name');
  }
  if(step===5) S.applicants.forEach(function(a,i){ const who=(a.full_name||('Applicant '+(i+1)))+': ', F0=FILES[i]||blankFiles();
    if(a.nationality!=='India'){ if(!F0.passport.length) bad('doc.'+i+'.passport','Please attach the passport',who+'Passport');
      if(!F0.pan.length) bad('doc.'+i+'.pan','Please attach the PAN card',who+'PAN card');
      if(!String(a.passport||'').trim()) bad('applicants.'+i+'.passport','Please write the passport number',who+'Passport number'); return; }
    if(!F0.pan.length) bad('doc.'+i+'.pan','Please attach the PAN card',who+'PAN card');
    if(!F0.aadhaar.length) bad('doc.'+i+'.aadhaar','Please attach the Aadhaar card',who+'Aadhaar card'); });
  if(step===6){ if(!S.terms_accepted) bad('terms_accepted','Please tick to accept the terms','Accept the terms'); }
  return !MISSING.length;
}

// ---------------------------------------------------------------- drawing
function render(){
  const st=S.step;
  $('steps').innerHTML='<div class="lbl"><b>'+STEPS[st][0]+'</b><span>Step '+(st+1)+' of '+STEPS.length+'</span></div><div class="bar"><i style="width:'+Math.round((st+1)/STEPS.length*100)+'%"></i></div>';
  $('missing').innerHTML=MISSING.length?'<div class="miss"><b>Still missing on this page ('+MISSING.length+'):</b><ul>'+MISSING.map(function(m){ return '<li data-jump="'+fid(m[0])+'">'+esc(m[1])+'</li>'; }).join('')+'</ul></div>':'';
  $('app').innerHTML=[stepApplicants,stepContact,stepAbout,stepFlat,stepPay,stepDocs,stepTerms,stepReview][st]();
  document.querySelectorAll('input[type=date]').forEach(function(i){ i.max=todayISO(); });
  $('nav').innerHTML='<div class="in">'+(st?'<button type="button" class="btn sec2" data-back="1">Back</button>':'')
    +'<button type="button" class="btn pri" id="nextBtn" data-next="1">'+(st===STEPS.length-1?'Submit booking form':'Continue')+'</button></div>'
    +'<div class="saved">'+(LINK?'Your answers are saved as you go - you can close this page and open the same link later to carry on.':'Your answers are saved on this device as you go.')+'</div>';
}
function go(n){ S.step=Math.max(0,Math.min(STEPS.length-1,n)); save(); ERR={}; MISSING=[]; render(); window.scrollTo(0,0); }
function showErrors(){
  render(); window.scrollTo({top:0,behavior:'smooth'});
  toast(MISSING.length===1?'1 thing is still missing':MISSING.length+' things are still missing');
}

// ---------------------------------------------------------------- cost sheet (13 Nov 2026)
/* Sales attaches the cost sheet as a PDF when they make the link. The customer sees it after the terms as PICTURES (each page drawn from the PDF here in the
   browser with pdf.js, vendor/pdfjs): tap a page to zoom, download a page picture or the PDF itself. The server hands the PDF over only with the link's token. */
const COST={meta:null,state:'idle',pages:[],bytes:null,err:'',cur:0};
function pdfjsReady(){
  return new Promise(function(res,rej){
    if(window.pdfjsLib){ res(); return; }
    const s=document.createElement('script'); s.src='vendor/pdfjs/pdf.min.js';
    s.onload=function(){ try{ window.pdfjsLib.GlobalWorkerOptions.workerSrc='vendor/pdfjs/pdf.worker.min.js'; res(); }catch(e){ rej(e); } };
    s.onerror=function(){ rej(new Error('The cost sheet viewer could not be loaded')); };
    document.head.appendChild(s);
  });
}
async function loadCost(){
  if(!COST.meta||COST.state==='loading'||COST.state==='ready') return;
  COST.state='loading'; COST.pages=[]; COST.err='';
  try{
    const r=await fetch(FN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cost_pdf',token:TOKEN})});
    if(!r.ok) throw new Error('The cost sheet could not be opened');
    COST.bytes=await r.arrayBuffer();
    // 19 Nov 2026: the cost sheet may be a picture - then it is that one page, shown as it is
    const ct=String(r.headers.get('content-type')||COST.meta.type||'');
    if(/^image\//.test(ct)){ COST.type=ct; COST.pages=[URL.createObjectURL(new Blob([COST.bytes],{type:ct}))]; COST.state='ready'; const hh=$('costv'); if(hh) hh.innerHTML=costInner(); return; }
    COST.type='application/pdf';
    await pdfjsReady();
    const doc=await window.pdfjsLib.getDocument({data:COST.bytes.slice(0)}).promise;
    for(let n=1;n<=doc.numPages;n++){
      const pg=await doc.getPage(n), v0=pg.getViewport({scale:1}), sc=Math.min(2.5,1700/v0.width), v=pg.getViewport({scale:sc});
      const cv=document.createElement('canvas'); cv.width=Math.ceil(v.width); cv.height=Math.ceil(v.height);
      const g=cv.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,cv.width,cv.height);
      await pg.render({canvasContext:g,viewport:v}).promise;
      COST.pages.push(cv.toDataURL('image/jpeg',0.92));
    }
    COST.state='ready';
  }catch(e){ COST.state='error'; COST.err=(e&&e.message)||'The cost sheet could not be shown'; }
  const host=$('costv'); if(host) host.innerHTML=costInner();
}
function costInner(){
  if(!COST.meta) return '';
  if(COST.state==='error') return '<div class="costwait" style="color:var(--err)">'+esc(COST.err)+'<br><button type="button" class="btn sec2" style="margin-top:10px" data-costretry="1">Try again</button></div>';
  if(COST.state!=='ready') return '<div class="costwait">Opening the cost sheet…</div>';
  const n=COST.pages.length, i=Math.max(0,Math.min(n-1,COST.cur||0));
  /* One page at a time in a frame of a sensible height (not a very long scroll): the whole page is tappable to enlarge, arrows / swipe change the page, the page number sits small at the bottom right, Download (the PDF) is on the right. */
  return '<div class="costview"><button type="button" class="cdl" data-costdl="pdf" aria-label="Download the cost sheet (PDF)" title="Download"><svg class="i" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="M7.5 11 12 15.5 16.5 11"/><path d="M5 19h14"/></svg></button><button type="button" class="costpg" data-zoom="'+i+'" aria-label="Cost sheet page '+(i+1)+' of '+n+' - tap to enlarge"><img src="'+COST.pages[i]+'" alt="Cost sheet page '+(i+1)+'"></button>'
    +(n>1?'<button type="button" class="cnav prev" data-cnav="-1" aria-label="Previous page"'+(i===0?' disabled':'')+'>&#8249;</button><button type="button" class="cnav next" data-cnav="1" aria-label="Next page"'+(i===n-1?' disabled':'')+'>&#8250;</button>':'')
    +'<span class="pgn">'+(i+1)+' / '+n+'</span></div>';
}
function costBody(){ if(COST.state==='idle') loadCost(); return '<div id="costv">'+costInner()+'</div>'; }
function dl(url,name){ const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); }
function downloadPdf(){ if(!COST.bytes) return; const u=URL.createObjectURL(new Blob([COST.bytes],{type:COST.type||'application/pdf'})); dl(u,COST.meta.name); setTimeout(function(){ URL.revokeObjectURL(u); },4000); }
// A page full screen: zoom in / out / fit (also double-tap and ctrl + wheel), scroll to move around, download the picture.
function openZoom(i){
  closeZoom(); let z=1;
  const d=document.createElement('div'); d.className='zoomov'; d.id='zoomov';
  /* 19 Nov 2026 (Ayush: "in zoomed mode it can't go after and before"): previous / next page right in the zoomed view (also the arrow keys) */
  const n=COST.pages.length;
  d.innerHTML='<div class="zbar"><b id="zttl">Cost sheet · page '+(i+1)+' of '+n+'</b><div class="zbtns">'
    +(n>1?'<button type="button" data-z="prev" aria-label="Previous page"'+(i===0?' disabled':'')+'>&#8249;</button><button type="button" data-z="next" aria-label="Next page"'+(i===n-1?' disabled':'')+'>&#8250;</button>':'')
    +'<button type="button" data-z="out" aria-label="Zoom out">−</button><button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="fit">Fit</button><button type="button" data-z="dl" aria-label="Download this page" title="Download this page"><svg class="i" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="M7.5 11 12 15.5 16.5 11"/><path d="M5 19h14"/></svg></button><button type="button" data-z="x" aria-label="Close">×</button></div></div>'
    +'<div class="zarea" id="zarea"><img alt="Cost sheet page '+(i+1)+'" src="'+COST.pages[i]+'"></div>';
  document.body.appendChild(d); document.documentElement.classList.add('noscroll');
  const img=d.querySelector('img');
  const apply=function(){ img.style.width=Math.round(Math.min(window.innerWidth-28,1100)*z)+'px'; };
  apply();
  // another page: the picture, the title and the buttons follow, the zoom goes back to fit, and the page under the zoom moves with it
  const turn=function(step){
    const j=Math.max(0,Math.min(n-1,i+step)); if(j===i) return; i=j; z=1; apply();
    img.src=COST.pages[i]; img.alt='Cost sheet page '+(i+1);
    const t=d.querySelector('#zttl'); if(t) t.textContent='Cost sheet · page '+(i+1)+' of '+n;
    const p=d.querySelector('[data-z="prev"]'), q=d.querySelector('[data-z="next"]'); if(p) p.disabled=i===0; if(q) q.disabled=i===n-1;
    const za=d.querySelector('#zarea'); if(za) za.scrollTop=0;
    COST.cur=i; const h=$('costv'); if(h) h.innerHTML=costInner();
  };
  const onKey=function(e){ if(!document.getElementById('zoomov')){ document.removeEventListener('keydown',onKey); return; } if(e.key==='ArrowRight') turn(1); if(e.key==='ArrowLeft') turn(-1); };
  document.addEventListener('keydown',onKey);
  d.addEventListener('click',function(e){
    const b=e.target.closest('[data-z]'); if(!b) return; const k=b.getAttribute('data-z');
    if(k==='prev'||k==='next'){ turn(k==='next'?1:-1); return; }
    if(k==='in') z=Math.min(5,z*1.4); else if(k==='out') z=Math.max(1,z/1.4); else if(k==='fit') z=1;
    else if(k==='dl'){ dl(COST.pages[i],'Cost sheet - page '+(i+1)+'.jpg'); return; }
    else if(k==='x'){ closeZoom(); return; }
    apply();
  });
  d.addEventListener('dblclick',function(e){ if(e.target.tagName==='IMG'){ z=z>1?1:2.5; apply(); } });
  d.addEventListener('wheel',function(e){ if(!e.ctrlKey) return; e.preventDefault(); z=Math.max(1,Math.min(5,z*(e.deltaY<0?1.15:1/1.15))); apply(); },{passive:false});
}
(function(){ let x0=null; document.addEventListener('touchstart',function(e){ x0=e.target.closest&&e.target.closest('.costview')?e.touches[0].clientX:null; },{passive:true});
  document.addEventListener('touchend',function(e){ if(x0===null) return; const dx=e.changedTouches[0].clientX-x0; x0=null; if(Math.abs(dx)<60||COST.state!=='ready') return;
    COST.cur=Math.max(0,Math.min(COST.pages.length-1,(COST.cur||0)+(dx<0?1:-1))); const h=$('costv'); if(h) h.innerHTML=costInner(); },{passive:true}); })();
function closeZoom(){ const d=document.getElementById('zoomov'); if(d){ d.remove(); document.documentElement.classList.remove('noscroll'); } }

// ---------------------------------------------------------------- address suggestions (Photon / OpenStreetMap)
let acTimer=null, acSeq=0;
function suggest(k,q){
  clearTimeout(acTimer); const box=$('ac-'+k); if(!box) return;
  if(q.trim().length<4){ box.innerHTML=''; return; }
  acTimer=setTimeout(async function(){
    const seq=++acSeq;
    try{
      // only places in the chosen country (19 Nov 2026): more are asked for, the rest of the world is dropped, the first five kept
      const ctry=addrCountry(), india=ctry[0]==='India';
      const r=await fetch('https://photon.komoot.io/api/?limit=25&lang=en'+(india?'&lat=22.57&lon=88.36':'')+'&q='+encodeURIComponent(q));
      const j=await r.json(); if(seq!==acSeq) return;
      const items=(j.features||[]).filter(function(f){ return String((f.properties||{}).countrycode||'').toLowerCase()===ctry[1]; }).map(function(f){ const p=f.properties||{};
        const line=[p.housenumber,p.name,p.street,p.district||p.locality].filter(Boolean).filter(function(v,i,a){ return a.indexOf(v)===i; }).join(', ');
        return {line:line||p.name||'',city:p.city||p.county||p.state||'',pin:india?(/^\d{6}$/.test(p.postcode||'')?p.postcode:''):String(p.postcode||'').slice(0,10),more:[p.city,p.state,p.postcode].filter(Boolean).join(', ')}; })
        .filter(function(x,i,arr){ return x.line&&arr.findIndex(function(y){ return y.line===x.line&&y.more===x.more; })===i; }).slice(0,5);
      box.innerHTML=items.length?'<div class="acl">'+items.map(function(x,i){ return '<button type="button" data-acpick="'+k+'|'+i+'">'+esc(x.line)+'<small>'+esc(x.more)+'</small></button>'; }).join('')
        +'<div class="src">Suggestions from OpenStreetMap</div></div>':'';
      box._items=items;
    }catch(e){ box.innerHTML=''; }
  },350);
}

// ---------------------------------------------------------------- generated link: saved on our server as the customer goes
let SYNC_T=null, SYNC_BUSY=false, SYNC_AGAIN=false, SYNC_FAIL=0;
function setSaved(txt,bad){ const e=document.querySelector('#nav .saved'); if(e){ e.textContent=txt; e.style.color=bad?'var(--err)':''; } }
function scheduleSync(){ if(!LINK) return; clearTimeout(SYNC_T); SYNC_T=setTimeout(function(){ doSync(false); },900); setSaved('Saving…'); }
// The files kept on the server, as the customer has them now (which applicant, which document).
function fileMeta(){ const out=[]; FILES.forEach(function(f,i){ DOC_KINDS.forEach(function(k){ (f[k]||[]).forEach(function(x){ if(x.saved) out.push({id:x.id,applicant:i,kind:k}); }); }); }); return out; }
async function doSync(keep){
  if(!LINK) return;
  if(SYNC_BUSY){ SYNC_AGAIN=true; return; }
  clearTimeout(SYNC_T); SYNC_BUSY=true;
  const body={action:'save',token:TOKEN,data:S,step:S.step,files:fileMeta()};
  const txt=JSON.stringify(body);
  try{
    const r=await fetch(FN,{method:'POST',headers:{'Content-Type':'application/json'},body:txt,keepalive:!!keep&&txt.length<60000});
    const jj=await r.json().catch(function(){ return {}; });
    if(r.status===404||r.status===409){ LINK=null; setSaved(jj.error||'This form is closed.',true); SYNC_BUSY=false; return; }
    if(!r.ok||!jj.ok) throw new Error(jj.error||('error '+r.status));
    SYNC_FAIL=0;
    setSaved('Saved '+new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));
  }catch(e){ SYNC_FAIL++; setSaved('Could not save just now - trying again',true); SYNC_T=setTimeout(function(){ doSync(false); },Math.min(15000,3000*SYNC_FAIL)); }
  SYNC_BUSY=false; if(SYNC_AGAIN){ SYNC_AGAIN=false; scheduleSync(); }
}
document.addEventListener('visibilitychange',function(){ if(document.visibilityState==='hidden') doSync(true); });
window.addEventListener('pagehide',function(){ doSync(true); });
/* 19 Nov 2026: a photo is made smaller on the phone before it is sent - at most 1800 px on its long side, as a JPEG - so it uploads quickly and the
   thank-you PDF (which draws every picture) stays within the server's time limit. A PDF, or a photo the browser cannot open (e.g. HEIC on some phones), goes as it is. */
async function shrinkPhoto(f){
  try{
    if(!/^image\/(jpeg|png|webp)$/.test(f.type)) return f;
    const bmp=await createImageBitmap(f);
    const k=Math.min(1,1800/Math.max(bmp.width,bmp.height));
    if(k===1&&f.type==='image/jpeg'&&f.size<900*1024) return f;
    const cv=document.createElement('canvas'); cv.width=Math.round(bmp.width*k); cv.height=Math.round(bmp.height*k);
    const g=cv.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,cv.width,cv.height); g.drawImage(bmp,0,0,cv.width,cv.height);
    const blob=await new Promise(function(res){ cv.toBlob(res,'image/jpeg',0.85); });
    if(!blob||blob.size>=f.size&&f.type==='image/jpeg') return f;
    return new File([blob],String(f.name||'photo').replace(/\.[a-z0-9]+$/i,'')+'.jpg',{type:'image/jpeg'});
  }catch(e){ return f; }
}
async function uploadKyc(ai,kind,file){
  toast('Uploading '+file.name+'…');
  const fd=new FormData(); fd.append('action','upload'); fd.append('token',TOKEN); fd.append('applicant',String(ai)); fd.append('kind',kind); fd.append('file',file,file.name);
  try{
    const r=await fetch(FN,{method:'POST',body:fd}); const jj=await r.json().catch(function(){ return {}; });
    if(!r.ok||!jj.ok) throw new Error(jj.error||'The file did not upload - please try again');
    if(FILES[ai]) FILES[ai][kind].push({saved:true,id:jj.file.id,name:jj.file.name,ext:jj.file.ext});
    delete ERR['doc.'+ai+'.'+kind]; render(); scheduleSync();
  }catch(e){ toast(e.message||'The file did not upload - please try again'); }
}
function getIn(o,path){ return path.split('.').reduce(function(x,k){ return x==null?x:x[k]; },o); }
function setIn(o,path,v){ const ks=path.split('.'); let c=o; for(let i=0;i<ks.length-1;i++){ if(c[ks[i]]==null||typeof c[ks[i]]!=='object') c[ks[i]]=/^\d+$/.test(ks[i+1])?[]:{}; c=c[ks[i]]; } c[ks[ks.length-1]]=v; }
function setProject(info){
  if(!info) return;
  CONF=Object.assign({},CONF,{name:info.name,company:info.company,address:info.address,blocks:info.blocks,floors:info.floors,bhk:info.bhk,bhkDefault:info.bhkDefault,logo:info.logo||''});
  document.title='Booking application form - '+info.name;
  const img=$('projLogo'), nm=$('projName'), to=$('hdTo');
  if(to) to.textContent='To '+info.company+', '+info.address;
  const text=function(){ if(img) img.style.display='none'; if(nm){ nm.textContent=info.name; nm.hidden=false; } };
  if(info.logo&&img){ if(nm) nm.hidden=true; img.style.display=''; img.style.visibility=''; img.alt=info.name; img.onerror=text; img.src=info.logo; } else text();
}
function showDone(ref,email){
  $('steps').innerHTML=''; $('nav').innerHTML=''; $('missing').innerHTML='';
  $('app').innerHTML='<div class="sec"><div class="done"><div class="ok">'+ICON.check+'</div><h2>Thank you! Your booking form has been received.</h2>'
    +''
    +(email?'<p style="color:var(--slate)">A confirmation email, with a copy of your form and the cost sheet, has been sent to <b style="color:var(--ink)">'+esc(email)+'</b>.</p>':'')
    +'<p style="color:var(--slate)">Our team will call you shortly to confirm your booking.</p>'
    +(TOKEN?'<p style="margin-top:14px"><button type="button" class="btn pri" data-viewsub="1" style="max-width:320px">View your submitted form</button></p>':'')+'</div></div>';
  window.scrollTo(0,0);
}
/* STAFF VIEW (13 Nov 2026): the same page the customer sees, for a JainE user who is signed in on this same site (their own session is read from the browser; the
   server checks it again and only lets the Administrator and the Sales department through). It shows exactly what the customer gave and nothing else - every answer in
   full (PAN and Aadhaar unmasked), the uploaded KYC photos and the signature, each with a preview that opens large. No staff note, status or remark is on this page. */
function staffToken(){
  try{ for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i);
    if(/^sb-.+-auth-token$/.test(k)){ const v=JSON.parse(localStorage.getItem(k)||'null'); const t=v&&(v.access_token||(v.currentSession&&v.currentSession.access_token)); if(typeof t==='string'&&t) return t; } } }
  catch(e){}
  return null;
}
let STAFF=null;
// A picture with a small preview; pressing it opens it large (a PDF opens in its own tab).
function docCard(f,label,who){
  if(!f.url) return '<div class="dcard none"><div class="im">Not available</div><div class="cap"><div><b>'+esc(label)+'</b>'+(who?'<small>'+esc(who)+'</small>':'')+'</div></div></div>';
  const img=/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name||'')||f.kind==='signature';
  return img
    ?'<button type="button" class="dcard'+(f.kind==='signature'?' sig':'')+'" data-lb="'+esc(f.url)+'" data-cap="'+esc(label+(who?' - '+who:''))+'" title="Click to enlarge"><div class="im"><img src="'+esc(f.url)+'" alt="'+esc(label)+'"></div><div class="cap"><div><b>'+esc(label)+'</b>'+(who?'<small>'+esc(who)+'</small>':'')+'</div><span>Enlarge</span></div></button>'
    :'<a class="dcard" href="'+esc(f.url)+'" target="_blank" rel="noopener"><div class="im pdf">PDF</div><div class="cap"><div><b>'+esc(label)+'</b>'+(who?'<small>'+esc(who)+'</small>':'')+'</div><span>Open</span></div></a>';
}
function staffDocs(){
  const fl=STAFF.form.files||[];
  const nm={pan:'PAN card',aadhaar:'Aadhaar card',passport:'Passport',photo:'Photograph',payment:'Payment proof'};
  const people=S.applicants.map(function(a,i){ const mine=fl.filter(function(f){ return f.applicant===i&&f.kind!=='signature'; });
    const who=[a.title,a.full_name].filter(Boolean).join(' ')||('Applicant '+(i+1));
    return '<div class="dgrp"><h4><span class="dn">'+(i+1)+'</span>'+esc(i?'Joint applicant':'First applicant')+' <b>'+esc(who)+'</b></h4><div class="docg">'
      +(mine.length?mine.map(function(f){ return docCard(f,nm[f.kind]||f.kind,who); }).join(''):'<div class="nodoc">No documents attached</div>')+'</div></div>'; }).join('');
  return people;
}
function openLightbox(url,cap){
  closeLightbox();
  const d=document.createElement('div'); d.className='lb'; d.id='lb';
  d.innerHTML='<button type="button" class="lbx" data-lbx="1" aria-label="Close">×</button><img src="'+esc(url)+'" alt=""><div class="lbc">'+esc(cap||'')+'</div>';
  d.addEventListener('click',function(e){ if(e.target.tagName!=='IMG') closeLightbox(); });
  document.body.appendChild(d);
}
function closeLightbox(){ const d=document.getElementById('lb'); if(d) d.remove(); }
document.addEventListener('keydown',function(e){ if(e.key==='Escape'){ closeLightbox(); closeZoom(); } });
function showStaff(jj){
  const f=jj.form, d=f.data;
  RO=true; STAFF=jj;
  S=Object.assign(fresh(),d); ['price','profession'].forEach(function(k){ S[k]=Object.assign(fresh()[k],d[k]||{}); });
  if(!Array.isArray(S.applicants)||!S.applicants.length) S.applicants=[newApp()];
  S.applicants=S.applicants.map(function(a){ return Object.assign(newApp(),a); });
  if(!Array.isArray(S.why)||!S.why.length) S.why=[''];
  FILES=S.applicants.map(function(){ return blankFiles(); });
  (f.files||[]).forEach(function(x){ if(x.kind!=='signature'&&FILES[x.applicant]&&FILES[x.applicant][x.kind]) FILES[x.applicant][x.kind].push({saved:true,name:x.name}); });
  setProject(jj.project); COST.meta=jj.cost||null; if(COST.meta) loadCost();
  $('steps').innerHTML=''; $('nav').innerHTML=''; $('missing').innerHTML='';
  $('app').innerHTML='<div class="sec"><div class="done"><div class="ok">'+ICON.check+'</div><h2>Submitted booking form</h2><div class="ref">'+esc(jj.ref_no||'')+'</div>'
      +'<p style="color:var(--slate);margin:4px 0 0">'+(f.submitted_at?'Submitted on '+esc(new Date(f.submitted_at).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})):'')+'</p></div></div>'
    +stepReview()+termsBlock()
    +(COST.meta?card('','','Cost sheet','Prepared by our Sales team.',costBody()):'')
    +card('','','Documents','Click a picture to enlarge it.',staffDocs());
  window.scrollTo(0,0);
}
function showSubmitted(jj){
  const sub=jj.submitted, d=sub&&sub.data;
  if(!d) return showDone(jj.ref_no||'');
  RO=true;
  S=Object.assign(fresh(),d); ['price','profession'].forEach(function(k){ S[k]=Object.assign(fresh()[k],d[k]||{}); });
  if(!Array.isArray(S.applicants)||!S.applicants.length) S.applicants=[newApp()];
  S.applicants=S.applicants.map(function(a){ return Object.assign(newApp(),a); });
  if(!Array.isArray(S.why)||!S.why.length) S.why=[''];
  FILES=S.applicants.map(function(){ return blankFiles(); });
  (sub.docs||[]).forEach(function(x){ if(FILES[x.applicant]&&FILES[x.applicant][x.kind]) FILES[x.applicant][x.kind].push({saved:true,name:x.kind}); });
  setProject(sub.project); COST.meta=sub.cost||null; if(COST.meta) loadCost();
  $('steps').innerHTML=''; $('nav').innerHTML=''; $('missing').innerHTML='';
  $('app').innerHTML='<div class="sec"><div class="done"><div class="ok">'+ICON.check+'</div><h2>Your booking form has been received.</h2>'
    +'<p style="color:var(--slate);margin-top:8px">'+(sub.submitted_at?'Submitted on '+esc(new Date(sub.submitted_at).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}))+'. ':'')+'Our team will call you shortly to confirm your booking.</p></div></div>'
    +stepReview()+termsBlock()
    +(COST.meta?card('','','Cost sheet','',costBody()):'');
  window.scrollTo(0,0);
}
function linkMessage(msg){
  $('steps').innerHTML=''; $('nav').innerHTML=''; $('missing').innerHTML='';
  $('app').innerHTML='<div class="sec"><div class="sb"><h2>'+esc(msg)+'</h2></div></div>';
}
async function bootLink(){
  $('app').innerHTML='<div class="sec"><div class="sb"><p style="color:var(--slate)">Opening your form…</p></div></div>';
  let r, jj;
  try{ r=await fetch(FN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'load',token:TOKEN})}); jj=await r.json().catch(function(){ return {}; }); }
  catch(e){ return linkMessage('We could not reach our server. Please check your internet and open the link again.'); }
  if(!r.ok||jj.error) return linkMessage(jj.error||'This booking link is not valid. Please use the exact link our team sent you.');
  if(jj.status==='cancelled') return linkMessage('This booking link is no longer active. Please contact our team.');
  if(jj.status==='completed'){
    const tk=staffToken();
    if(tk){ try{ const r2=await fetch(FN,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tk},body:JSON.stringify({action:'staff_load',token:TOKEN})}); const j2=await r2.json().catch(function(){ return {}; }); if(r2.ok&&j2.ok&&j2.form) return showStaff(j2); }catch(e){} }
    return showSubmitted(jj);
  }
  setProject(jj.projectInfo); OTP_REQUIRED=!!jj.otp_required; COST.meta=jj.cost||null; if(COST.meta) loadCost();
  const pf=jj.prefill||{values:{}}, d=jj.draft&&typeof jj.draft==='object'?jj.draft:{};
  S=Object.assign(fresh(),d); ['price','profession'].forEach(function(k){ S[k]=Object.assign(fresh()[k],d[k]||{}); });
  if(!Array.isArray(S.applicants)||!S.applicants.length) S.applicants=[newApp()];
  S.applicants=S.applicants.map(function(a){ return Object.assign(newApp(),a); });
  if(!Array.isArray(S.why)||!S.why.length) S.why=[''];
  /* 13 Nov 2026: what Sales filled in is only a starting point - the customer can change any of it. It is put in when the form is opened
     for the first time; once the customer has a saved draft, the draft (their own answers) is what is shown. */
  if(!jj.draft) (pf.fields||pf.locked||[]).forEach(function(p){ const v=getIn(pf.values||{},p); if(v!=null&&v!=='') setIn(S,p,v); });
  /* 19 Nov 2026: what Sales LOCKED (unit, size, price, booking amount on links made from today) is shown from Sales' values every time and cannot be changed. */
  LOCK.clear();
  (Array.isArray(pf.locked)?pf.locked:[]).forEach(function(p){ LOCK.add(p); const v=getIn(pf.values||{},p); setIn(S,p,v==null?'':v); });
  S.project=PROJECT;
  FILES=S.applicants.map(function(){ return blankFiles(); });
  (jj.files||[]).forEach(function(f){ if(FILES[f.applicant]&&FILES[f.applicant][f.kind]) FILES[f.applicant][f.kind].push({saved:true,id:f.id,name:f.name,ext:f.ext}); });
  SPOUSE_OPEN=!!(S.applicants[0]&&(S.applicants[0].spouse||S.applicants[0].anniversary));
  S.step=Math.max(0,Math.min(STEPS.length-1,parseInt(jj.step,10)||0));
  LINK={token:TOKEN};
  render();
}

// ---------------------------------------------------------------- events
document.addEventListener('input',function(e){
  const k=e.target.getAttribute&&e.target.getAttribute('data-k'); if(!k) return;
  if(LOCK.has(k)) return;
  let v=e.target.value;
  if(/\.(pan|passport|full_name|relation_name|spouse)$|flat_no$|pay\.ref$/.test(k)) v=v.toUpperCase();
  if(/aadhaar$/.test(k)){ const d=v.replace(/\D/g,'').slice(0,12); v=d.replace(/(\d{4})(?=\d)/g,'$1 '); }
  if(/(price\.total|pay\.amount)$/.test(k)) v=v.replace(/[^\d]/g,'');
  if(/price\.(sba|basic|plc|flc)$/.test(k)) v=v.replace(/[^\d.]/g,'').replace(/(\..*)\./g,'$1');
  if(/\.pin$/.test(k)) v=addrIndia()?v.replace(/\D/g,'').slice(0,6):v.toUpperCase().replace(/[^A-Z0-9 -]/g,'').slice(0,10);
  if(v!==e.target.value){ const same=v.length===e.target.value.length, pos=same?e.target.selectionStart:v.length; e.target.value=v; try{ e.target.setSelectionRange(pos,pos); }catch(_e){} }
  set(k,v);
  if(k==='pay.amount'){ const w=$('w-amount'); if(w) w.textContent=words(v); }
  if(k==='price.total'){ const w=$('w-total'); if(w) w.textContent=words(v); }
  if(/price\.(sba|basic|plc|flc)$/.test(k)){ S.price.rate=rateTotal()?String(rateTotal()):''; save();
    const w=$('w-rate'); if(w) w.textContent=rateTotal()?'₹'+fmtN(rateTotal()):'—'; const c=$('w-calc'); if(c) c.textContent=calcHint(); }
  if(/^(res|off)\.line$/.test(k)) suggest(k.split('.')[0],v);
  if(ERR[k]){ delete ERR[k]; const f=$(fid(k)); if(f) f.classList.remove('bad'); }
});
document.addEventListener('change',function(e){
  const t=e.target;
  const ck=t.getAttribute&&t.getAttribute('data-check');
  if(ck){ set(ck,t.checked); if(ck==='off.on'){ if(!t.checked){ if(S.mailing==='Office') S.mailing='Residential'; if(S.permanent==='Office') S.permanent='Residential'; save(); } render(); } else if(ERR[ck]){ delete ERR[ck]; const f=$('f-'+ck); if(f) f.classList.remove('bad'); } return; }
  const fk=t.getAttribute&&t.getAttribute('data-file');
  if(fk&&t.files&&t.files[0]){ const parts=fk.split('|'), f=t.files[0];
    if(f.size>10*1024*1024){ toast('That file is over 10 MB - please take a smaller photo'); return; }
    if(!/^image\//.test(f.type)&&f.type!=='application/pdf'){ toast('Please attach a photo or a PDF'); return; }
    if(LINK){ t.value=''; shrinkPhoto(f).then(function(g){ uploadKyc(+parts[0],parts[1],g); }); return; }
    FILES[+parts[0]][parts[1]].push(f); delete ERR['doc.'+parts[0]+'.'+parts[1]]; render(); }
});
document.addEventListener('click',function(e){
  const li=e.target.closest&&e.target.closest('[data-jump]');
  if(li){ const f=$(li.getAttribute('data-jump')); if(f){ f.scrollIntoView({behavior:'smooth',block:'center'}); const i=f.querySelector('input,textarea,button'); if(i) setTimeout(function(){ i.focus({preventScroll:true}); },400); } return; }
  const b=e.target.closest&&e.target.closest('button'); if(!b) return;
  if(b.dataset.lb){ openLightbox(b.dataset.lb,b.dataset.cap); return; }
  if(b.dataset.lbx){ closeLightbox(); return; }
  if(b.dataset.zoom!==undefined){ openZoom(+b.dataset.zoom); return; }
  if(b.dataset.costdl){ downloadPdf(); return; }
  if(b.dataset.costpanel){ COST_OPEN=!COST_OPEN; if(COST_OPEN&&!S.cost_seen){ S.cost_seen=true; save(); } delete ERR.cost_seen; MISSING=MISSING.filter(function(m){ return m[0]!=='cost_seen'; }); render(); return; }
  if(b.dataset.cnav){ COST.cur=Math.max(0,Math.min(COST.pages.length-1,(COST.cur||0)+Number(b.dataset.cnav))); const h=$('costv'); if(h) h.innerHTML=costInner(); return; }
  if(b.dataset.costretry){ COST.state='idle'; const h=$('costv'); if(h) h.innerHTML=costInner(); loadCost(); return; }
  if(b.dataset.viewsub){ location.reload(); return; }
  if(b.dataset.pick){ openSheet(b.dataset.pick,b.dataset.kind); return; }
  if(b.dataset.chip){ set(b.dataset.chip,b.dataset.v); if(ERR[b.dataset.chip]){ delete ERR[b.dataset.chip]; MISSING=MISSING.filter(function(m){ return m[0]!==b.dataset.chip; }); } render(); return; }
  if(b.dataset.acpick){ const p=b.dataset.acpick.split('|'), box=$('ac-'+p[0]), x=box&&box._items&&box._items[+p[1]]; if(!x) return;
    set(p[0]+'.line',x.line); if(x.city) set(p[0]+'.city',x.city); if(x.pin) set(p[0]+'.pin',x.pin); render(); return; }
  if(b.dataset.add){ S.applicants.push(newApp()); FILES.push(blankFiles()); save(); render();
    const cards=document.querySelectorAll('.app'); cards[cards.length-1].scrollIntoView({behavior:'smooth',block:'start'}); return; }
  /* Remove asks inside the page (a browser pop-up can be blocked or hidden, and then the button seems dead). */
  if(b.dataset.rm){ const i=+b.dataset.rm;
    b.outerHTML='<span class="rmask">'+(i?'':'The next person becomes the first applicant. ')+'Remove? <button type="button" class="rm" data-rmyes="'+i+'">Yes, remove</button> <button type="button" class="rm keep" data-rmno="1">Keep</button></span>'; return; }
  if(b.dataset.pp!==undefined){ const i=+b.dataset.pp; if(PASS_OPEN.has(i)) PASS_OPEN.delete(i); else PASS_OPEN.add(i); render();
    if(PASS_OPEN.has(i)){ const pp=document.querySelector('[data-k="applicants.'+i+'.passport"]'); if(pp){ const box=pp.closest('.xp'); if(box) box.scrollIntoView({behavior:'smooth',block:'center'}); pp.focus({preventScroll:true}); } }
    return; }
  if(b.dataset.sp){ SPOUSE_OPEN=!SPOUSE_OPEN; render();
    if(SPOUSE_OPEN){ const sp=document.querySelector('[data-k="applicants.0.spouse"]'); if(sp){ const box=sp.closest('.xp'); if(box) box.scrollIntoView({behavior:'smooth',block:'center'}); sp.focus({preventScroll:true}); } }
    return; }
  if(b.dataset.rmyes){ const i=+b.dataset.rmyes; if(LINK&&i===0) return; S.applicants.splice(i,1); FILES.splice(i,1);
    PASS_OPEN=new Set([...PASS_OPEN].filter(function(x){ return x!==i; }).map(function(x){ return x>i?x-1:x; })); save(); render(); return; }
  if(b.dataset.rmno){ render(); return; }
  if(b.dataset.addwhy){ S.why.push(''); save(); render(); const ins=document.querySelectorAll('[data-k^="why."]'); ins[ins.length-1].focus(); return; }
  if(b.dataset.rmwhy){ S.why.splice(+b.dataset.rmwhy,1); save(); render(); return; }
  if(b.dataset.delfile){ const p=b.dataset.delfile.split('|'); FILES[+p[0]][p[1]].splice(+p[2],1); save(); render(); return; }
  if(b.dataset.go){ if(S.step===STEPS.length-1) FROM_REVIEW=true; go(+b.dataset.go); return; }
  if(b.dataset.back){ if(FROM_REVIEW){ FROM_REVIEW=false; go(STEPS.length-1); return; } go(S.step-1); return; }
  if(b.dataset.next){
    if(S.step===STEPS.length-1){ submit(); return; }
    if(!check(S.step)){ showErrors(); return; }
    if(FROM_REVIEW){ FROM_REVIEW=false; go(STEPS.length-1); return; }
    go(S.step+1);
  }
});
document.addEventListener('click',function(e){ if(!e.target.closest('.ac')) document.querySelectorAll('[id^="ac-"]').forEach(function(b){ b.innerHTML=''; }); },true);

// ---------------------------------------------------------------- submit
// ---------------------------------------------------------------- submit
/* A generated link with a cost sheet (13 Nov 2026) is submitted in two steps: Submit asks our server to email a 6-digit code to the customer's email address;
   the customer types it in, and only then is the form sent. An address that cannot receive email is turned back here, with a way to change it. */
let OTP_BUSY=false, OTP_TIMER=null;
async function submit(){
  for(let s=0;s<STEPS.length-1;s++){ if(!check(s)){ S.step=s; save(); showErrors(); return; } }
  if(LINK&&OTP_REQUIRED){ await startOtp(false); return; }
  await sendForm('');
}
function otpClose(){ clearInterval(OTP_TIMER); const e=document.getElementById('otpbg'); if(e) e.remove(); document.documentElement.classList.remove('noscroll'); }
async function startOtp(isResend){
  const btn=$('nextBtn');
  if(btn&&!isResend){ btn.disabled=true; btn.textContent='Sending the code…'; }
  await doSync(false);
  let r, jj;
  try{ r=await fetch(FN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'otp_send',token:TOKEN})}); jj=await r.json().catch(function(){ return {}; }); }
  catch(e){ if(btn){ btn.disabled=false; btn.textContent='Submit booking form'; } toast('Could not reach our server - please try again'); return; }
  if(btn){ btn.disabled=false; btn.textContent='Submit booking form'; }
  if(!r.ok||!jj.ok){ otpSheet({error:jj.error||'We could not send the code. Please try again.',fatal:jj.code==='bad_email'||jj.code==='bad_domain'||jj.code==='mail_failed',wait:jj.wait}); return; }
  otpSheet({to:jj.to,wait:jj.resend_after||30});
}
function otpSheet(o){
  otpClose();
  const d=document.createElement('div'); d.className='otpbg'; d.id='otpbg';
  d.innerHTML='<div class="otp" role="dialog" aria-modal="true"><h2>'+(o.fatal?'Please check your email address':'Verify your email')+'</h2>'
    +(o.fatal?'<p>'+esc(o.error)+'</p><div class="orow"><button type="button" class="btn pri" data-otp="change">Change email address</button></div><div class="olinks"><button type="button" data-otp="close">Close</button><span></span></div>'
      :'<p>We have sent a 6-digit code to <span class="em">'+esc(o.to||'')+'</span>. Please enter it below to submit your booking.</p>'
        +'<input class="code" id="otpCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="······" aria-label="6-digit code">'
        +'<div class="oerr" id="otpErr">'+esc(o.error||'')+'</div>'
        +'<div class="orow"><button type="button" class="btn pri" id="otpGo" data-otp="go">Verify &amp; submit</button></div>'
        +'<div class="olinks"><button type="button" id="otpResend" data-otp="resend" disabled>Resend code</button><button type="button" data-otp="change">Change email address</button></div>')
    +'</div>';
  document.body.appendChild(d); document.documentElement.classList.add('noscroll');
  d.addEventListener('click',function(e){
    const b=e.target.closest('[data-otp]'); if(!b) return; const k=b.getAttribute('data-otp');
    if(k==='close'){ otpClose(); return; }
    if(k==='change'){ otpClose(); FROM_REVIEW=true; go(1); setTimeout(function(){ const i=document.querySelector('[data-k="contact.email"]'); if(i){ i.focus(); i.scrollIntoView({block:'center'}); } },150); return; }
    if(k==='resend'){ startOtp(true); return; }
    if(k==='go') verifyOtp();
  });
  const inp=d.querySelector('#otpCode');
  if(inp){ inp.addEventListener('input',function(){ inp.value=inp.value.replace(/\D/g,'').slice(0,6); if(inp.value.length===6) verifyOtp(); }); inp.focus(); }
  if(!o.fatal){
    let left=Math.max(0,Number(o.wait)||30); const rs=d.querySelector('#otpResend');
    const tick=function(){ if(!rs) return; if(left>0){ rs.disabled=true; rs.textContent='Resend code in '+left+'s'; left--; } else { rs.disabled=false; rs.textContent='Resend code'; clearInterval(OTP_TIMER); } };
    clearInterval(OTP_TIMER); tick(); OTP_TIMER=setInterval(tick,1000);
  }
}
async function verifyOtp(){
  const inp=$('otpCode'), err=$('otpErr'), go=$('otpGo'); if(!inp||OTP_BUSY) return;
  const code=inp.value.trim(); if(code.length!==6){ err.textContent='Please enter all 6 digits.'; return; }
  OTP_BUSY=true; go.disabled=true; go.textContent='Checking…'; err.textContent='';
  const res=await sendForm(code);
  OTP_BUSY=false;
  if(res&&res.ok) return;
  const go2=$('otpGo'), err2=$('otpErr'), inp2=$('otpCode');
  if(go2){ go2.disabled=false; go2.innerHTML='Verify &amp; submit'; }
  if(err2&&res) err2.textContent=res.error||'Could not send. Please try again.';
  if(inp2&&res&&res.code==='otp_wrong'){ inp2.value=''; inp2.focus(); }
}
async function sendForm(otp){
  const btn=$('nextBtn');
  if(btn&&!otp){ btn.disabled=true; btn.textContent='Sending… please keep this page open'; }
  const data=JSON.parse(JSON.stringify(S)); delete data.step;
  data.website=($('hpWeb')||{}).value||'';
  data.applicants.forEach(function(a){ a.pan=a.pan.toUpperCase(); a.aadhaar=a.aadhaar.replace(/\s/g,''); });
  data.why=data.why.filter(Boolean);
  data.submitted_on_device=new Date().toString();
  const fd=new FormData();
  fd.append('data',JSON.stringify(data));
  if(LINK){ fd.append('token',TOKEN); fd.append('files',JSON.stringify(fileMeta())); }
  if(otp) fd.append('otp',otp);
  FILES.forEach(function(f,i){ DOC_KINDS.forEach(function(kind){ (f[kind]||[]).forEach(function(file,n){ if(file instanceof Blob) fd.append('f_'+i+'_'+kind+'_'+n,file,file.name); }); }); });
  try{
    const r=await fetch(FN,{method:'POST',body:fd});
    const j=await r.json().catch(function(){ return {}; });
    if(!r.ok||!j.ok){ const er=new Error(j.error||('Could not send (error '+r.status+')')); er.code=j.code; throw er; }
    try{ localStorage.removeItem(DRAFT_KEY); }catch(e){}
    LINK=null; clearTimeout(SYNC_T); otpClose();
    showDone(j.ref_no,j.email);
    return {ok:true};
  }catch(e){
    const msg=e.message||'Could not send. Please check your internet and try again.';
    if(otp) return {ok:false,error:msg,code:e.code};
    if(btn){ btn.disabled=false; btn.textContent='Submit booking form'; }
    $('missing').innerHTML='<div class="miss"><b>The form could not be sent</b><ul><li style="cursor:default;text-decoration:none">'+esc(msg)+'</li><li style="cursor:default;text-decoration:none">'+(LINK?'Your answers are saved':'Your answers are still saved on this device')+' - press Submit again.</li></ul></div>';
    window.scrollTo({top:0,behavior:'smooth'}); toast('The form could not be sent','err');
    return {ok:false,error:msg};
  }
}

if(!CONF){ $('app').innerHTML='<div class="sec"><div class="sb"><h2>This booking link is not valid.</h2><p>Please use the exact link our team sent you.</p></div></div>'; return; }
if(TOKEN){ bootLink(); return; }
// Coming back to a saved draft: files and the signature were not kept, so it opens no later than
// the PAN & Aadhaar step.
if(S.step>5) S.step=5;
render();
})();
