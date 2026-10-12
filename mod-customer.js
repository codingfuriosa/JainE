function s3KeyForMaintenanceReceipt(unitId,filename){return `customer-portal/units/${unitId}/maintenance-payment-receipt/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForModificationRequest(unitId,filename){return `customer-portal/units/${unitId}/modification-request/${s3Stamp()}_${s3SafeName(filename)}`;}
function s3KeyForSupportAttachment(ticketId,filename){return `customer-portal/support-tickets/${ticketId}/${s3Stamp()}_${s3SafeName(filename)}`;}
async function custLoadData(customerId,force){
  // Filtered by customerId explicitly, not left to RLS alone — a real customer JWT is scoped to
  // its own rows by RLS regardless, but a staff session previewing a customer (state.impersonating,
  // see boot() above) has full staff_all read access to every cust.* row, so without this filter a
  // preview would show every customer's units mixed together instead of just the one being previewed.
  if(CUST_DATA&&CUST_DATA.customerId===customerId&&!force)return CUST_DATA;
  // Live flats only. A cancelled booking keeps its unit row (audit, and the money that moved off it),
  // but it is not the customer's flat any more - Arup Bhawal's D/8G stayed in his "Viewing" list
  // after he moved to D/8H, beside the flat he actually owns.
  const {data:units}=await sb.schema('cust').from('units').select('*, projects(id,name)').eq('customer_id',customerId)
    .neq('status','cancelled').is('deleted_at',null).order('id');
  const list=units||[];
  const unitIds=list.map(u=>u.id);
  let contacts=[];
  if(unitIds.length){
    const {data}=await sb.schema('cust').from('farvision_contacts').select('*').in('unit_id',unitIds).eq('is_current',true);
    contacts=data||[];
  }
  /* Anything the customer corrected themselves wins over the imported row. It is kept in its own
     table because farvision_contacts is rewritten by the nightly import - an edit written there
     would quietly disappear overnight. Blank fields in the override mean "no correction", so the
     imported value still shows through. */
  let overrides=[];
  if(unitIds.length){
    const {data}=await sb.schema('cust').from('contact_overrides').select('*').in('unit_id',unitIds);
    overrides=data||[];
  }
  const ovByUnit={};overrides.forEach(o=>{ovByUnit[o.unit_id]=o;});
  const contactByUnit={};
  contacts.forEach(c=>{
    const o=ovByUnit[c.unit_id];
    contactByUnit[c.unit_id]=o
      ? Object.assign({},c,{
          contact_phone:   o.contact_phone   || c.contact_phone,
          contact_email:   o.contact_email   || c.contact_email,
          contact_address: o.contact_address || c.contact_address,
          _edited:{phone:!!o.contact_phone,email:!!o.contact_email,address:!!o.contact_address}
        })
      : c;
  });
  // Whether this customer has ever submitted a referral, across all their units (the sidebar is
  // shared across units, not per-unit) - drives the "Earn" badge in custSidebarTabs. Left undefined
  // rather than defaulted to false until this resolves, so the sidebar's very first paint (before
  // any data has loaded) never flashes a badge it might have to immediately take back.
  let hasReferred;
  if(unitIds.length){
    const {data:ref}=await sb.schema('cust').from('referrals').select('id').in('unit_id',unitIds).limit(1);
    hasReferred=!!(ref&&ref.length);
  }else hasReferred=false;
  // The section rules for these flats' projects plus the all-projects default. If they can't be read,
  // featureRules stays empty and only the CUST_FEATURE_FALLBACK sections show.
  let featureRules=[];
  try{
    const pids=[...new Set(list.map(u=>u.project_id))];
    let q=sb.schema('cust').from('feature_access').select('feature,project_id,tower,enabled');
    q=pids.length?q.or('project_id.is.null,project_id.in.('+pids.join(',')+')'):q.is('project_id',null);
    const {data,error}=await q;
    if(!error)featureRules=data||[];
  }catch(e){}
  CUST_DATA={customerId,units:list,contactByUnit,hasReferred,featureRules};
  return CUST_DATA;
}
window.custSwitchUnit=function(id){CUST_SELECTED_UNIT=Number(id);route();};
// Farvision's Typology column comes through as e.g. "3.00BHK" (always two decimals, even for a
// whole number) - a customer doesn't need to see that precision. Left as-is for anything that
// isn't the plain "<number>BHK" shape (the staff admin screens keep showing/editing the raw value,
// since that's the actual source-of-truth field).
function custFormatUnitType(t){
  if(!t)return t;
  const m=String(t).trim().match(/^(\d+(?:\.\d+)?)\s*BHK$/i);
  if(!m)return t;
  return (parseFloat(m[1]))+' BHK';
}
/* Farvision stores names as "Mr. AKSHAY DEBNATH" - shouted back at a customer that reads like a
   demand letter, so the greeting uses just the given name, title-cased. */
function custGreeting(fullName,unit){
  const h=new Date().getHours();
  const hi=h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  const name=custFirstName(fullName);
  const proj=projShortName((unit&&unit.projects&&unit.projects.name)||'');
  const where=[unit&&unit.unit_code,unit&&unit.tower].filter(Boolean).join(' · ');
  return '<div class="cust-greet">'+
    (proj?'<div class="cust-greet-kicker">The Jain Group · '+esc(proj)+'</div>':'')+
    '<div class="cust-greet-hi">'+hi+(name?', '+esc(name):'')+'</div>'+
    '<div class="cust-greet-sub">Welcome back'+
      (proj?' — your home at <b>'+esc(proj)+'</b>'+(where?', '+esc(where):''):'')+'.</div>'+
  '</div>';
}
/* Jain Group's own official renders, hotlinked from each project's own marketing microsite - not a
   generic stock photo, the actual building the customer bought into. Same company, same asset,
   reused on its own customer portal: no licensing question the way an arbitrary web image would
   raise. Keyed on cust.projects.name exactly as Farvision sends it, same as everywhere else in this
   file that reads a project by name. A project with no entry here (Dream Ananta has no dedicated
   microsite yet) falls back to the plain navy card - never another project's building. */
const CUST_PROJECT_HERO_IMG={
  'DREAM GURUKUL(DOLTALA MADHYAMGRAM)':'https://thejaingroup.com/dreamgurukul/assets/images/elevation/Dream%20Gurukul%20elevation%20vertical%201.webp'
};
/* A looping site/elevation video, Home page only - not the rest of the portal, which stays plain
   white so ledgers, statements and cost sheets keep the readability a moving video behind them
   would cost. Hosted in its own public `project-hero` Storage bucket rather than hotlinked, since
   it did not already live on a public URL the way the hero photos above do - it is a one-off file,
   not an asset already published on Jain Group's own site. (Landed in its own bucket rather than a
   folder inside `branding` as first set up - Storage's "Create folder" in the dashboard can create
   a sibling bucket instead depending on which button is used; verified with a live curl against the
   public URL before treating either the path or the bucket's public flag as correct.)
   Used as the `poster` too: the still frame shown before the video can play, and what renders for
   anyone with prefers-reduced-motion set (see custLanding below - reduced motion falls back to the
   plain photo card entirely, not a paused video frame in a full-viewport layout it was never using). */
const CUST_PROJECT_HERO_VIDEO={
  'DREAM GURUKUL(DOLTALA MADHYAMGRAM)':'https://rkxsgtauigjrpcjkmccu.supabase.co/storage/v1/object/public/project-hero/dream-gurukul.mp4'
};
/* A faint (see .cust-tab-bg's opacity in nexus.css) version of the project's own render sits behind
   every non-Home tab - Statement, Ledger, Cost Sheet etc. - so the portal doesn't go flat and blank
   the moment a customer leaves the hero. Deliberately its own map, not a reuse of CUST_PROJECT_HERO_IMG:
   the Home hero and this backdrop are different renders of the same project (dusk elevation vs. a
   daytime shot with the playground/garden), so a project could in principle only have one of the two. */
const CUST_PROJECT_TAB_BG={
  'DREAM GURUKUL(DOLTALA MADHYAMGRAM)':'https://rkxsgtauigjrpcjkmccu.supabase.co/storage/v1/object/public/branding/dream%20gurukul%20statement.webp'
};
/* The landing page: a greeting standing on the project's own hero media, and nothing else. It is
   the first thing a customer sees, before they choose Statement or anything else from the sidebar. */
function custLanding(fullName,unit){
  const projName=(unit&&unit.projects&&unit.projects.name)||'';
  const heroImg=CUST_PROJECT_HERO_IMG[projName];
  const heroVideo=CUST_PROJECT_HERO_VIDEO[projName];
  const reducedMotion=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(heroVideo&&!reducedMotion){
    return '<div class="cust-landing cust-landing--video">'+
      '<video class="cust-landing-video" autoplay muted loop playsinline preload="auto"'+
        (heroImg?' poster="'+esc(heroImg)+'"':'')+'>'+
        '<source src="'+esc(heroVideo)+'" type="video/mp4">'+
      '</video>'+
      '<div class="cust-landing-scrim"></div>'+
      '<div class="cust-landing-inner">'+custGreeting(fullName,unit)+'</div>'+
    '</div>';
  }
  // A dark scrim under the greeting text, fading to nearly nothing toward the top so the render
  // itself stays the star of the panel rather than being blanketed. Gives white/gold text on the
  // photo the same contrast a solid card would, without needing one.
  const style=heroImg?' style="background-image:linear-gradient(180deg,rgba(9,15,30,.05) 0%,rgba(9,15,30,.35) 45%,rgba(7,12,25,.92) 100%),url(\''+heroImg+'\')"':'';
  return '<div class="cust-landing'+(heroImg?' cust-landing--photo':'')+'"'+style+'>'+
    '<div class="cust-landing-inner">'+custGreeting(fullName,unit)+'</div>'+
  '</div>';
}
function custUnitPicker(units,selUnitId){
  if(units.length<2)return '';
  /* An <option> cannot carry a tooltip, so the project's location suffix is dropped here rather than
     left to truncate mid-word against the dropdown arrow - the tower tells the units apart anyway. */
  return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">'+
    '<span style="font-size:12.5px;font-weight:600;color:var(--slate)">Viewing</span>'+
    `<select id="custUnitPicker" class="mu-sel" onchange="custSwitchUnit(this.value)" style="max-width:340px">`+
    units.map(u=>`<option value="${u.id}" ${u.id===selUnitId?'selected':''}>${esc(u.unit_code)}${u.tower?' · '+esc(u.tower):''} · ${esc(projShortName((u.projects&&u.projects.name)||''))}</option>`).join('')+
    '</select></div>';
}
// Farvision keeps cancelled demands in the Invoice Register with Status=Cancel (a quarter of the
// rows), and the cost sheet carries an offsetting negative against them. Showing them to a
// customer would restate demands that were withdrawn, so every customer-facing read excludes
// them - and a cancelled invoice must never be downloadable as a tax document.
const CUST_INVOICE_CANCELLED='Cancel';
// Statement of Account - modelled on Farvision's own customer portal (a Farvision export a
// customer sent us as a reference), which frames the landing tab as a bank-statement-style
// summary rather than a raw ledger: property value / paid-to-date / demand due / remaining, a
// "next demand due in N days" banner, and the 5 most recent transactions - with the exhaustive
// list left to the separate Ledger tab. Pulls entirely from data already imported by Sales
// Details / Outstanding / Invoice & Receipt Register - no new data source.
/* Does Farvision agree with what we are about to show this customer?
   cust.reconciliation compares the two per unit. Anything other than a confirmed match - including
   a unit Farvision sent no snapshot for, which is 40 of them - means nobody has verified the figure,
   so the portal says it is being updated rather than showing a number on trust.

   FAILS CLOSED on purpose. A query that errors, a row RLS hides, an unreadable view: all of them
   hide the figures rather than show them. Someone seeing "being updated" when their account is
   actually fine is an annoyance; someone paying against a wrong balance is not. */
async function custReconGate(unitId){
  try{
    const {data,error}=await sb.schema('cust').from('reconciliation')
      .select('status').eq('unit_id',unitId).maybeSingle();
    if(error||!data) return {ok:false,status:'unverified'};
    /* The six Farvision reports are the source of truth, so the question is not "do our sums agree
       with Farvision" but "do we HAVE Farvision's figures for this unit". A mismatch means our
       arithmetic disagreed with Farvision's bookkeeping - Farvision wins, and the customer is shown
       its numbers. Only 'unchecked' - no Outstanding snapshot at all - leaves us with nothing
       authoritative to show. ('no_activity' has no snapshot either, but also nothing to state.) */
    return {ok:data.status!=='unchecked',status:data.status};
  }catch(e){ return {ok:false,status:'unverified'}; }
}
const CUST_FIGURES_NOTICE='<div style="display:flex;gap:10px;align-items:flex-start;background:#fffbeb;'+
  'border:1px solid #f0dfa8;border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:13.5px;color:#92400e">'+
  '<i class="fa-solid fa-circle-info" style="margin-top:2px"></i><div><b>Your figures are being updated.</b> '+
  'We are reconciling this account against our accounting system, so the amounts are not being shown right now. '+
  'Please contact us before making any payment.</div></div>';
/* One profile row, able to turn into an input. Rendered as text; custProfileEditStart swaps in the
   field beside it rather than re-rendering the page, so a half-typed address survives a stray
   click. "Updated by you" marks a value the customer corrected, so it is obvious which figures are
   ours and which are theirs. */
function custProfileField(key,icon,label,value,delay,c){
  const edited=c&&c._edited&&c._edited[key];
  const isAddr=key==='address';
  return '<div class="cust-profile-item'+(isAddr?' cust-profile-addr':'')+'" style="animation-delay:'+delay+'">'
    +'<div class="cust-profile-icon"><i class="fa-solid '+icon+'"></i></div>'
    +'<div style="min-width:0;flex:1">'
      +'<div class="cust-profile-label">'+esc(label)
        +(edited?' <span style="color:#16855a;font-weight:600">· updated by you</span>':'')+'</div>'
      +'<div class="cust-profile-value" id="custPV_'+key+'">'+esc(value||'—')+'</div>'
      +(isAddr
        ? '<textarea id="custPI_'+key+'" rows="3" style="display:none;width:100%;margin-top:4px;padding:7px 9px;border:1px solid var(--line);border-radius:8px;font:inherit;font-size:13.5px;resize:vertical"></textarea>'
        : '<input id="custPI_'+key+'" type="'+(key==='email'?'email':'tel')+'" style="display:none;width:100%;margin-top:4px;padding:7px 9px;border:1px solid var(--line);border-radius:8px;font:inherit;font-size:13.5px">')
    +'</div></div>';
}
const CUST_PROFILE_KEYS=['phone','email','address'];
function custProfileToggle(editing){
  CUST_PROFILE_KEYS.forEach(function(k){
    const v=$('custPV_'+k), i=$('custPI_'+k);
    if(!v||!i)return;
    if(editing){ i.value=(v.textContent==='—'?'':v.textContent); }
    v.style.display=editing?'none':'';
    i.style.display=editing?'':'none';
  });
  ['custProfileCancel','custProfileSave','custProfileHint'].forEach(function(id){
    const el=$(id); if(el) el.style.display=editing?'':'none';
  });
  const e=$('custProfileEdit'); if(e) e.style.display=editing?'none':'';
}
window.custProfileEditStart=function(){ custProfileToggle(true); const p=$('custPI_phone'); if(p)try{p.focus();}catch(_e){} };
window.custProfileEditCancel=function(){ custProfileToggle(false); };
window.custProfileSave=async function(unitId){
  const btn=$('custProfileSave');
  const vals={}; CUST_PROFILE_KEYS.forEach(function(k){ const i=$('custPI_'+k); vals[k]=i?i.value.trim():''; });
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…'; }
  try{
    const {error}=await sb.schema('cust').rpc('save_my_contact',
      {p_unit_id:unitId,p_phone:vals.phone,p_email:vals.email,p_address:vals.address});
    if(error)throw error;
  }catch(e){
    if(btn){ btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-check"></i> Save'; }
    // The database writes these messages for the customer to read, so show it rather than a generic one.
    toast((e&&e.message)||'Could not save your details','err');
    return;
  }
  toast('Your details have been updated','ok');
  // Re-read so the page shows what was actually stored, not what was typed.
  CUST_DATA=null;
  renderPage();
};
async function custTabOverview(data,unit){
  const c=data.contactByUnit[unit.id];
  const [{data:invRows},{data:rcptRows},{data:revRows},{data:snapRows},{data:costItemRows},{data:osRows}]=await Promise.all([
    sb.schema('cust').from('invoices').select('id,document_no,document_date,due_date,invoice_type,invoice_items(net_amount)').eq('unit_id',unit.id).eq('is_current',true).neq('status',CUST_INVOICE_CANCELLED).order('document_date'),
    sb.schema('cust').from('money_receipts').select('*,receipt_items(against_demand_no,amount)').eq('unit_id',unit.id).eq('is_current',true).order('receipt_date'),
    sb.schema('cust').from('receipt_reversals').select('reversal_amount').eq('unit_id',unit.id).eq('is_current',true),
    sb.schema('cust').from('outstanding_snapshot').select('*').eq('unit_id',unit.id).eq('is_current',true).maybeSingle(),
    sb.schema('cust').from('cost_sheet_items').select('*').eq('unit_id',unit.id).eq('is_current',true).order('sort_order'),
    sb.schema('cust').from('outstanding_items').select('document_no,schedule,bill_amount').eq('unit_id',unit.id).eq('is_current',true)
  ]);
  const snap=snapRows||null;
  const invoices=invRows||[], receiptRows=rcptRows||[], reversalRows=revRows||[], costItems=costItemRows||[], osItems=osRows||[];
  /* Per-invoice amount for the "Recent transactions" list below. It used to come from
     outstanding_items, which carries only currently-UNPAID documents - so every demand a customer
     had already settled showed as a blank. That was not a rare edge: 1,615 of 1,678 invoices, on
     295 of 296 units, have no outstanding row at all, so almost every demand in this list was
     empty. The demand's own line items are what it was raised for, paid or not, and they are what
     the Ledger has always used; outstanding_items stays only as a fallback for the handful of
     imported invoices that arrived without item rows. */
  const osTotals={};
  osItems.forEach(o=>{const d=o.document_no||'';osTotals[d]=(osTotals[d]||0)+Number(o.bill_amount||0);});
  const invTotal=inv=>{
    const items=inv.invoice_items||[];
    const fromItems=items.reduce((s,it)=>s+Number(it.net_amount||0),0);
    return fromItems||Number(osTotals[inv.document_no]||0);
  };
  // "Demand due" must compare like with like: total ever billed (cost_sheet_items.bill_amount,
  // which already accounts for every invoice raised to date) against total ever actually
  // received (money_receipts minus receipt_reversals). Comparing outstanding_items (which only
  // lists currently-unpaid documents) against all-time gross receipts - the old formula here -
  // guarantees a false ~0 for anyone who has ever fully paid off an earlier invoice.
  const totalBilled=costItems.reduce((s,i)=>s+Number(i.bill_amount||0),0);
  // Total property cost, computed live from the cost sheet (Basic + Extra + Adhoc + Tax) rather
  // than the units.agreement_value column - keeps every figure on this page traceable to the
  // same imported Sales Details cost sheet the customer's own charge breakdown comes from.
  const totalCostWithTax=costItems.reduce((s,i)=>s+Number(i.amount||0)+Number(i.tax_amount||0),0);
  const grossReceipts=receiptRows.reduce((s,r)=>s+Number(r.total_amount||0),0);
  const grossReversals=reversalRows.reduce((s,rv)=>s+Number(rv.reversal_amount||0),0);
  const netReceived=grossReceipts-grossReversals;
  const csiReceived=costItems.reduce((s,i)=>s+Number(i.received_amount||0),0);
  const csiBalance=costItems.reduce((s,i)=>s+Number(i.balance_amount||0),0);
  const csiOnaccount=costItems.reduce((s,i)=>s+Number(i.onaccount_amount||0),0);
  /* Farvision omits a unit from the Outstanding Summary when it has nothing outstanding - Mr
     Aniruddha Mukherjee's 5D is billed 62,47,674 and received 62,47,674, so no row exists for him.
     Its Sales Details cost sheet still carries billed/received/balance per component and is equally
     Farvision's, so it stands in whenever the snapshot is absent. This used to require the unit to
     have NO invoices and NO receipts, which is exactly the case it never applies to - any real
     customer has both - so those 39 units fell through to our own arithmetic instead. */
  const useCostSheet=costItems.length>0;
  /* Farvision's total_consideration is the basic amount EXCLUDING GST - for 6N it is 92,72,740
     against a cost sheet grand total of 98,09,442, the difference being exactly its 5,36,702 of tax.
     Using it here put an ex-tax value beside a tax-inclusive "Paid to date", so Remaining understated
     what the customer still owes by the whole tax component, and it disagreed with the Cost Sheet
     tab's Grand Total. The cost sheet's own tax-inclusive total is the figure that compares like with
     like, and is equally Farvision's. */
  const propertyValue=costItems.length?totalCostWithTax:Number((snap&&snap.total_consideration)||0);
  /* Farvision's own received figure (Sales Details -> cost_sheet_items.received_amount) in
     preference to summing our receipt rows. Every other KPI here already reads from the Outstanding
     snapshot, and mixing one locally-computed number in among them is what let "Paid to date" and
     "Remaining" drift away from "Demand due" on the same card row. */
  const totalReceivedFinal=costItems.length?csiReceived:netReceived;
  const billOutstanding=snap?Number(snap.bill_outstanding||0):(useCostSheet?csiBalance:Math.max(0,totalBilled-netReceived));
  const lateFee=snap?Number(snap.late_fee_accrued||0):0;
  const onAccount=snap?Number(snap.on_account||0):(useCostSheet?csiOnaccount:0);
  const remaining=Math.max(0,propertyValue-totalReceivedFinal);
  const paidPct=propertyValue?Math.round(totalReceivedFinal/propertyValue*100):(totalBilled?Math.round(totalReceivedFinal/totalBilled*100):0);

  const lastInv=invoices.slice().sort((a,b)=>new Date(b.document_date||0)-new Date(a.document_date||0))[0];
  let dueBanner='';
  if(lastInv&&billOutstanding>0){
    const due=lastInv.due_date?new Date(lastInv.due_date):null;
    const days=due?Math.round((due-new Date(new Date().toDateString()))/86400000):null;
    const dueText=days==null?'':(days<0?Math.abs(days)+' day'+(Math.abs(days)===1?'':'s')+' overdue':days===0?'due today':'due in '+days+' day'+(days===1?'':'s'));
    const osScheds=osItems.filter(o=>o.document_no===lastInv.document_no&&o.schedule).map(o=>o.schedule);
    const schedules=[...new Set(osScheds)];
    dueBanner=`<div class="card card-pad" style="background:${days!=null&&days<0?'#fef2f2':'#eff4ff'};border-color:${days!=null&&days<0?'#fecaca':'#cfe0ef'};margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div><i class="fa-solid fa-file-invoice-dollar" style="color:${days!=null&&days<0?'#c83232':'#1d4ed8'}"></i> <b>Amount due now — ${custInr(billOutstanding)}</b> <span style="color:var(--slate);font-size:13px">${esc(schedules.join(', ')||lastInv.document_no||'')}${lastInv.due_date?' · due '+fmtDate(lastInv.due_date):''}</span></div>
      ${dueText?`<span class="tag ${days!=null&&days<0?'t-red':'t-blue'}">${esc(dueText)}</span>`:''}
    </div>`;
  }

  const gate=await custReconGate(unit.id);
  /* Named for the customer, not the accounts team. "Property value", "Demand due" and "Remaining"
     read as three versions of one number; these say what each one is, and the four now add up
     cleanly: Total flat cost = Amount paid + Amount due now + Future demands.

     The last tile used to be "Balance to pay" and INCLUDED the amount already due now, so a
     customer with money payable today saw it counted twice - once under Amount due now and again
     inside the balance. It is now what it says: only the part not payable yet. 46 units have
     something due today, and for them this figure is lower than the old one by exactly that
     amount; for everyone else nothing changed. */
  const futureDemands=Math.max(0,remaining-billOutstanding);
  const kpis=[
    ['Total flat cost',custInr(propertyValue),'incl. GST and all charges'],
    ['Amount paid',custInr(totalReceivedFinal),paidPct+'% of total cost'+(receiptRows.length?' · '+receiptRows.length+' receipt'+(receiptRows.length===1?'':'s'):''),'#16855a'],
    ['Amount due now',custInr(billOutstanding),billOutstanding>0?'billed to you, not yet paid':'nothing to pay right now',billOutstanding>0?'#e08600':'#16855a'],
    ['Future demands not payable now',custInr(futureDemands),lateFee?'+ '+custInr(lateFee)+' late fee':(onAccount?custInr(onAccount)+' on account':
      (futureDemands>0?'billed as construction progresses — no action needed yet':'nothing further to be billed'))]
  ];
  // Every figure here derives from the same imported rows, so if the unit does not reconcile there is
  // no subset of them that is safe to keep showing.
  if(!gate.ok) kpis.forEach(k=>{k[1]='—';k[2]='being updated';k[3]=undefined;});

  const entries=[];
  invoices.forEach(inv=>{
    const total=invTotal(inv);
    const osScheds2=osItems.filter(o=>o.document_no===inv.document_no&&o.schedule).map(o=>o.schedule);
    entries.push({date:inv.document_date,type:'Demand',desc:[...new Set(osScheds2)].join(', ')||inv.document_no,amount:total});
  });
  // Same rule as the Ledger: credit only what was applied to a demand this list shows, or money with
  // no allocation at all. Otherwise this preview would show receipts the full ledger omits.
  const ovLiveDocs=new Set(invoices.map(i=>i.document_no));
  receiptRows.forEach(r=>{
    const ri=r.receipt_items||[];
    const amt=ri.length
      ? ri.reduce((s,x)=>s+(x.against_demand_no==null||ovLiveDocs.has(x.against_demand_no)?Number(x.amount||0):0),0)
      : Number(r.total_amount||0);
    if(amt) entries.push({date:r.receipt_date,type:'Receipt',desc:(r.payment_mode||'')+(r.instrument_no?' · '+r.instrument_no:''),amount:-amt});
  });
  // PTC (transfer/refund) - see the fuller note in custTabLedger. Included here too so this preview
  // cannot omit an entry the full Ledger shows for the same unit.
  const [{data:ovPtcOut},{data:ovPtcIn}]=await Promise.all([
    sb.schema('cust').from('ptc_transfers').select('document_date,amount,narration').eq('source_unit_id',unit.id).eq('is_reversed',false).is('deleted_at',null),
    sb.schema('cust').from('ptc_transfers').select('document_date,amount,narration').eq('transferee_unit_id',unit.id).eq('is_reversed',false).is('deleted_at',null)
  ]);
  (ovPtcOut||[]).forEach(p=>entries.push({date:p.document_date,type:'PTC',desc:p.narration||'Transfer / refund',amount:Number(p.amount||0)}));
  (ovPtcIn||[]).forEach(p=>entries.push({date:p.document_date,type:'PTC',desc:p.narration||'Transfer in',amount:-Number(p.amount||0)}));
  entries.sort((a,b)=>new Date(a.date||0)-new Date(b.date||0));
  // No running balance: the KPIs above are Farvision's position, and this list's own tally would be
  // a second answer to the same question. It showed -51,62,707 on one unit whose Demand due, taken
  // from Farvision, was nothing of the sort.
  const recent=entries.slice(-5).reverse();
  const typeTag={Demand:'<span class="tag t-amber">Demand</span>',Receipt:'<span class="tag t-green">Receipt</span>',PTC:'<span class="tag t-blue">Transfer</span>'};
  const recentRows=recent.map(e=>[fmtDate(e.date),typeTag[e.type]||esc(e.type),
    esc(e.desc||'—'),e.amount>0?custInr(e.amount):'—',e.amount<0?custInr(-e.amount):'—']);

  // Until a real Invoice/Receipt Register import exists for this project, the cost sheet from
  // Sales Details is the only per-charge breakdown available - shown as its own section rather
  // than folded into "Recent transactions" above, since it has no dates, only running totals.
  const costSheetRows=costItems.map(i=>[esc(i.component),custInr(Number(i.amount||0)+Number(i.tax_amount||0)),
    custInr(i.bill_amount||0),custInr(i.received_amount||0),
    Number(i.balance_amount||0)>0?'<b style="color:#e08600">'+custInr(i.balance_amount)+'</b>':custInr(i.balance_amount||0)]);
  // The per-charge breakdown is the Cost Sheet tab's whole job; repeating it here made the Statement
  // scroll past its own summary into a second copy of another page.
  const costSheetSection='';

  // Only arm the printer when the figures are safe to show. custPrintStatement already refuses
  // without these, so an unreconciled unit cannot be printed even if the button is reached some
  // other way - a PDF is the one copy that outlives the page and its notice.
  if(gate.ok){ window._custStatementUnit=unit; window._custStatementSnap={propertyValue,totalReceived:totalReceivedFinal,billOutstanding,remaining,paidPct,c}; }
  else { window._custStatementUnit=null; window._custStatementSnap=null; }
  const unitCostItem=costItems.find(i=>/unit cost/i.test(i.component||''));
  const basicAmt=Number(unitCostItem?.amount||0);
  const sba=Number(unit.super_built_up_area_sqft||0);
  const rate=sba?Math.round(basicAmt/sba):null;
  const myUnitSection='<div class="sec-title" style="margin:18px 0 8px">My unit</div>'+mTable(
    ['Unit','Project','Type','Block/Tower','Super Built-Up','Built-Up','Carpet','Rate','Booking date','Status','Total cost'],
    [[esc(unit.unit_code),esc((unit.projects&&unit.projects.name)||'—'),esc(custFormatUnitType(unit.unit_type)||'—'),
      esc(unit.tower||'—'),
      unit.super_built_up_area_sqft?unit.super_built_up_area_sqft+' sqft':'—',
      unit.built_up_area_sqft?unit.built_up_area_sqft+' sqft':'—',
      unit.carpet_area_sqft?unit.carpet_area_sqft+' sqft':'—',
      rate?custInr(rate)+'/sqft':'—',
      c?fmtDate(c.booking_date):'—',
      unit.status==='cancelled'?'<span class="tag t-red">Cancelled</span>':'—',
      custInr(propertyValue)]]);
  const custName=c?c.contact_name||'':'';
  const initials=custName.replace(/^(Mr\.|Ms\.|Mrs\.|Md\.|Dr\.)\s*/i,'').split(/\s+/).filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const profileSection=c?
    '<div class="cust-profile" style="margin:22px 0 8px;animation:custProfileSlideIn .5s ease both">'+
      '<div class="cust-profile-header">'+
        '<div class="cust-profile-avatar">'+esc(initials)+'</div>'+
        '<div class="cust-profile-name">'+
          '<h3 style="margin:0;font-size:18px;font-weight:700;color:#0f172a">'+esc(custName)+'</h3>'+
          (c.co_applicant_name?'<div style="font-size:13px;color:var(--slate);margin-top:2px"><i class="fa-solid fa-user-group" style="margin-right:4px;font-size:11px"></i>Co-Applicant: '+esc(c.co_applicant_name)+'</div>':'')+
          '<div style="font-size:12px;color:var(--slate);margin-top:4px">'+esc(unit.booking_no||'')+' · '+esc((unit.projects&&unit.projects.name)||'')+'</div>'+
        '</div>'+
      '</div>'+
      '<div class="cust-profile-details">'+
        custProfileField('phone','fa-phone','Phone',c.contact_phone,'.1s',c)+
        custProfileField('email','fa-envelope','Email',c.contact_email,'.15s',c)+
        custProfileField('address','fa-location-dot','Correspondence address',c.contact_address,'.2s',c)+
      '</div>'+
      /* The customer can correct how we reach them. The registered name is NOT here: it is the
         name on the booking and appears on receipts and demand letters, so it has to match the
         agreement rather than follow a text box. */
      '<div class="cust-profile-edit-bar" style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">'+
        '<span id="custProfileHint" style="margin-right:auto;font-size:12px;color:var(--slate);display:none">'+
          'Changing these updates how we contact you. Your name and flat details cannot be changed here — please call us for those.</span>'+
        '<button class="btn" id="custProfileEdit" onclick="custProfileEditStart('+unit.id+')"><i class="fa-solid fa-pen"></i> Update my details</button>'+
        '<button class="btn" id="custProfileCancel" style="display:none" onclick="custProfileEditCancel()">Cancel</button>'+
        '<button class="btn btn-primary" id="custProfileSave" style="display:none" onclick="custProfileSave('+unit.id+')"><i class="fa-solid fa-check"></i> Save</button>'+
      '</div>'+
    '</div>'
    :'<div class="card card-pad empty">Profile not yet available — this updates after our next records sync.</div>';
  // The due banner is a call to pay a specific amount - it must not survive a failed reconciliation.
  /* Everything money-related goes together when the unit does not reconcile. Masking the KPIs alone
     left the transaction table showing a running balance, the cost sheet showing billed/received per
     component, and - worst - the Print button still building its PDF from the unmasked figures, which
     carries them out of the portal entirely. The unit details and profile stay: they are contractual,
     not a payment position. */
  const moneySections=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin:18px 0 8px"><div class="sec-title" style="margin:0">Recent transactions</div>'+
    (custTabAllowed(3,unit)?'<a href="javascript:void(0)" onclick="navTo(\'customer/3\')" style="font-size:12.5px;font-weight:600">View full ledger →</a>':'')+'</div>'+
    (recentRows.length?mTable(['Date','Type','Details','Debit','Credit'],recentRows):
      '<div class="card card-pad empty">No demand or receipt records yet for this unit.</div>')+
    costSheetSection+
    '<div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">'+
    '<button class="btn" onclick="custPrintStatement()"><i class="fa-solid fa-print"></i> Print / Download PDF</button>'+
    '</div>';
  return (gate.ok?dueBanner:CUST_FIGURES_NOTICE)+mKpis(kpis)+
    myUnitSection+
    (gate.ok?moneySections:'')+
    profileSection;
}
// Opens a print-friendly statement in a new tab, reusing the wfPrintCase pattern (open the tab
// synchronously, before anything is awaited, or the popup blocker eats it) - the browser's own
// print dialog covers "Download PDF" too (Save as PDF is a print destination in every browser),
// so one button serves both actions without pulling in a PDF-generation library.
window.custPrintStatement=function(){
  const unit=window._custStatementUnit,snap=window._custStatementSnap;
  if(!unit||!snap){toast('Nothing to print yet','err');return;}
  const w=window.open('','_blank');
  if(!w){toast('Please allow popups to print','err');return;}
  const tableHtml=document.querySelector('#view .card table')?document.querySelector('#view .card table').outerHTML:'';
  const html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Statement of Account — '+esc(unit.unit_code)+'</title><style>'+
    'body{margin:32px;font-family:Inter,system-ui,sans-serif;color:#0f172a}'+
    'h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;color:#64748b;font-weight:500;margin:0 0 20px}'+
    'table{width:100%;border-collapse:collapse;margin-top:8px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12.5px}'+
    'th{color:#64748b;font-weight:600;text-transform:uppercase;font-size:10.5px;letter-spacing:.03em}'+
    '.kpis{display:flex;gap:18px;margin:18px 0;flex-wrap:wrap}.kpi{flex:1;min-width:140px}'+
    '.kpi .lbl{font-size:10.5px;color:#64748b;text-transform:uppercase;letter-spacing:.03em}.kpi .val{font-size:19px;font-weight:700;margin-top:2px}'+
    '</style></head><body>'+
    '<h1>Statement of Account — '+esc(unit.unit_code)+(unit.tower?', '+esc(unit.tower):'')+'</h1>'+
    '<h2>'+esc((unit.projects&&unit.projects.name)||'')+' · '+esc((snap.c&&snap.c.contact_name)||'')+' · as on '+fmtDate(new Date())+'</h2>'+
    '<div class="kpis">'+
      '<div class="kpi"><div class="lbl">Total flat cost</div><div class="val">'+custInr(snap.propertyValue)+'</div></div>'+
      '<div class="kpi"><div class="lbl">Amount paid</div><div class="val">'+custInr(snap.totalReceived)+'</div></div>'+
      '<div class="kpi"><div class="lbl">Amount due now</div><div class="val">'+custInr(snap.billOutstanding)+'</div></div>'+
      '<div class="kpi"><div class="lbl">Future demands not payable now</div><div class="val">'+custInr(Math.max(0,Number(snap.remaining||0)-Number(snap.billOutstanding||0)))+'</div></div>'+
    '</div>'+
    (tableHtml||'<p>No transactions recorded yet.</p>')+
    '</body></html>';
  try{ w.document.open(); w.document.write(html); w.document.close(); }
  catch(_e){ toast('Could not build the printout','err'); return; }
  setTimeout(function(){ try{w.focus();w.print();}catch(_e){} },350);
};
async function custTabLedger(unit){
  const [{data:rcptRows},{data:revRows},{data:csiRows},{data:invRows},{data:ptcOutRows},{data:ptcInRows}]=await Promise.all([
    sb.schema('cust').from('money_receipts').select('*,receipt_items(against_demand_no,amount)').eq('unit_id',unit.id).eq('is_current',true).order('receipt_date'),
    sb.schema('cust').from('receipt_reversals').select('*').eq('unit_id',unit.id).eq('is_current',true).order('receipt_reversal_date'),
    sb.schema('cust').from('cost_sheet_items').select('component,bill_amount').eq('unit_id',unit.id).eq('is_current',true),
    sb.schema('cust').from('invoices').select('id,document_no,document_date,invoice_type,due_date,invoice_items(schedule,net_amount)').eq('unit_id',unit.id).eq('is_current',true).neq('status',CUST_INVOICE_CANCELLED).order('document_date'),
    sb.schema('cust').from('ptc_transfers').select('*').eq('source_unit_id',unit.id).eq('is_reversed',false).is('deleted_at',null),
    sb.schema('cust').from('ptc_transfers').select('*').eq('transferee_unit_id',unit.id).eq('is_reversed',false).is('deleted_at',null)
  ]);
  const receipts=rcptRows||[], reversals=revRows||[], costItems=csiRows||[], invoices=invRows||[];
  const ptcOut=ptcOutRows||[], ptcIn=ptcInRows||[];
  const entries=[];
  invoices.forEach(inv=>{
    // Farvision's real Applicant Ledger shows one row per (Document No x Schedule) -
    // never merged/summed across schedules even when they share a document number
    // (confirmed against two real Farvision PDF exports).
    const items=inv.invoice_items||[];
    if(!items.length) return;
    const bySchedule={};
    const order=[];
    items.forEach(it=>{
      const s=it.schedule||inv.invoice_type||'—';
      if(!(s in bySchedule)){bySchedule[s]=0;order.push(s);}
      bySchedule[s]+=Number(it.net_amount||0);
    });
    order.forEach(s=>{
      const amt=bySchedule[s];
      if(amt>0) entries.push({date:inv.document_date,type:'INV',ref:inv.document_no,iid:inv.id,desc:s,debit:amt,credit:0});
    });
  });
  /* Credit only the part of a receipt that was applied to a demand this ledger actually shows.
     Farvision's own Customer Ledger for 2D/BLOCK A2 totals 6,173,042 in credits; crediting whole
     receipts gave 6,730,255, over by exactly the 557,213 paid against her cancelled demand
     OHINV/0015524-25, which Farvision leaves out. Summing the receipt_items allocated to live
     demands gives 5,963,042 - Farvision's figure once its 210,000 PTC transfer is set aside.
     Money with no allocation at all is genuine on-account payment and is credited. */
  const liveDocs=new Set(invoices.map(i=>i.document_no));
  receipts.forEach(r=>{
    const items=r.receipt_items||[];
    const credit=items.length
      ? items.reduce((s,ri)=>s+(ri.against_demand_no==null||liveDocs.has(ri.against_demand_no)?Number(ri.amount||0):0),0)
      : Number(r.total_amount||0);
    if(!credit) return;
    entries.push({date:r.receipt_date,type:'RECEIPT',ref:r.receipt_no,rid:r.id,desc:(r.payment_mode||'')+(r.instrument_no?' · '+r.instrument_no:'')+(r.drawn_on?' · '+r.drawn_on:''),debit:0,credit:credit});
  });
  // Group reversals by reversal_no — one ledger row per cheque bounce, not per revenue-head line
  const revByNo={};
  reversals.forEach(rv=>{
    const k=rv.receipt_reversal_no;
    if(!revByNo[k]) revByNo[k]={date:rv.receipt_reversal_date,ref:k,instrument:rv.instrument_no,total:0};
    revByNo[k].total+=Number(rv.reversal_amount||0);
  });
  Object.values(revByNo).forEach(rv=>{
    entries.push({date:rv.date,type:'CQRV',ref:rv.ref,desc:'Cheque return'+(rv.instrument?' · '+rv.instrument:''),debit:rv.total,credit:0});
  });
  /* PTC (Payment To Customer) - Farvision's transfer/refund document, the fourth type on its own
     Customer Ledger and the one report of the seven that arrives filed under the SOURCE booking
     rather than the unit the money actually affects. A transfer debits this unit when it is the
     source (money leaving) and credits it when it is the transferee (money arriving) - a refund is
     just the same debit with no transferee, so no separate handling is needed here. */
  ptcOut.forEach(p=>{
    entries.push({date:p.document_date,type:'PTC',ref:p.document_no,desc:p.narration||'Transfer / refund',debit:Number(p.amount||0),credit:0});
  });
  ptcIn.forEach(p=>{
    entries.push({date:p.document_date,type:'PTC',ref:p.document_no,desc:p.narration||'Transfer in',debit:0,credit:Number(p.amount||0)});
  });
  entries.sort((a,b)=>new Date(a.date||0)-new Date(b.date||0));
  const tags={INV:'<span class="tag t-amber">Invoice</span>',RECEIPT:'<span class="tag t-green">Receipt</span>',CQRV:'<span class="tag t-red">Reversal</span>',PTC:'<span class="tag t-blue">Transfer</span>'};
  const seenInvoice={};
  const pick=(kind,id)=>'<input type="checkbox" class="rcpt-pick" data-kind="'+kind+'" value="'+id+'" onchange="custDocPickChanged()">';
  const refCell=e=>{
    if(e.rid) return '<span class="rcpt-ref">'+pick('receipt',e.rid)+
      esc(e.ref||'—')+'<button class="btn btn-sm rcpt-view" title="View / download this receipt" onclick="custViewReceipt('+e.rid+')"><i class="fa-solid fa-file-arrow-down"></i></button></span>';
    if(e.iid){
      const first=!seenInvoice[e.iid]; seenInvoice[e.iid]=1;
      return '<span class="rcpt-ref">'+(first?pick('invoice',e.iid):'')+
        esc(e.ref||'—')+(first?'<button class="btn btn-sm rcpt-view" title="View / download this invoice" onclick="custViewInvoice('+e.iid+')"><i class="fa-solid fa-file-arrow-down"></i></button>':'')+'</span>';
    }
    return esc(e.ref||'—');
  };
  /* Running balance over the rows listed, exactly as Farvision's own Applicant Ledger prints it -
     each demand adds, each receipt subtracts, and the closing figure is where the account stands on
     this list. What is NOT rebuilt here is the old "Total billed / Net received / Balance" summary,
     which mixed cost_sheet totals with our receipt sums and so answered a different question from
     the Statement's Farvision-sourced Demand due. */
  let runBal=0;
  const balCell=b=>b>0
    ?'<span style="white-space:nowrap;display:inline-flex;align-items:center;gap:6px"><b style="color:#e08600">'+custInr(b)+'</b><span class="tag t-amber" style="padding:1px 8px;font-size:10px">Due</span></span>'
    :b<0
    ?'<span style="white-space:nowrap;display:inline-flex;align-items:center;gap:6px"><b style="color:#16855a">'+custInr(Math.abs(b))+'</b><span class="tag t-green" style="padding:1px 8px;font-size:10px">Adv</span></span>'
    :'<span style="white-space:nowrap;color:#16855a;font-weight:600">0.00</span>';
  const rows=entries.map(e=>{runBal+=e.debit-e.credit;
    return [fmtDate(e.date),tags[e.type]||esc(e.type),refCell(e),esc(e.desc||'—'),e.debit?custInr(e.debit):'—',e.credit?custInr(e.credit):'—',balCell(runBal)];});
  if(!receipts.length&&!costItems.length) return '<div class="card card-pad empty">No financial records yet for this unit.</div>';
  const totalDebit=entries.reduce((s,e)=>s+e.debit,0), totalCredit=entries.reduce((s,e)=>s+e.credit,0);
  const totalRow=entries.length?['<b>Total</b>','—','—','—','<b>'+custInr(totalDebit)+'</b>','<b>'+custInr(totalCredit)+'</b>','<b>'+balCell(runBal)+'</b>']:null;
  /* The whole ledger is withheld when the unit does not reconcile, not just its balance column: a
     statement missing some of its receipts still reads as a complete account and under-credits the
     customer. Checked before the print globals are set, so custPrintLedger - which refuses without
     them - cannot produce a PDF of figures the page itself is withholding. */
  const gate=await custReconGate(unit.id);
  if(!gate.ok){ window._custLedgerUnit=null; window._custLedgerEntries=null; return CUST_FIGURES_NOTICE; }
  window._custLedgerUnit=unit; window._custLedgerEntries=entries;
  const summary='<div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center;margin-bottom:12px;font-size:13.5px">'+
    '<span style="color:var(--slate)">Every demand raised and payment received on this unit, in date order.</span>'+
    '<span style="color:var(--slate)">'+entries.length+' entries</span>'+
    '<span style="margin-left:auto;display:inline-flex;gap:8px;flex-wrap:wrap;align-items:center">'+
    '<button class="btn" id="custBulkDlBtn" style="display:none" onclick="custDownloadSelectedDocs()"><i class="fa-solid fa-file-arrow-down"></i> <span id="custBulkDlLabel">Download</span></button>'+
    '<button class="btn" onclick="custPrintLedger()"><i class="fa-solid fa-print"></i> Print / Download PDF</button>'+
    /* People were not finding the per-row download at all, because nothing on the page said a
       single receipt or demand could be opened on its own - the only visible control printed the
       whole ledger. The note says where to click, and the footnote covers the tick-boxes, which
       are the part nobody discovers by accident. */
    '<button class="btn" type="button" aria-label="How to download your documents" '+
      'title="How to download your documents" onclick="custLedgerHelp()" '+
      'style="padding-left:11px;padding-right:11px;color:var(--brand)">'+
      '<i class="fa-solid fa-circle-info"></i></button>'+
    '</span></div>';
  return summary+mTable(['Date','Type','Reference','Details','Debit','Credit','Balance'],totalRow?rows.concat([totalRow]):rows);
}
window.custLedgerHelp=function(){
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-circle-info" style="color:var(--brand)"></i> Downloading your documents</h3>'
      +'<span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="width:min(94vw,560px);font-size:13.5px;line-height:1.65;color:#334155">'
      +'<p style="margin:0 0 14px">Every line in this ledger is a document you can open and keep.</p>'
      +'<div style="display:grid;gap:12px">'
        +'<div style="display:flex;gap:11px"><i class="fa-solid fa-receipt" style="color:#16855a;margin-top:3px;width:16px;text-align:center"></i>'
          +'<div><b>Receipts</b><br>Click any <b>Receipt</b> row to open it, then use <b>Print / Download PDF</b> inside. This is your proof of payment.</div></div>'
        +'<div style="display:flex;gap:11px"><i class="fa-solid fa-file-invoice" style="color:#e08600;margin-top:3px;width:16px;text-align:center"></i>'
          +'<div><b>Demands and invoices</b><br>Click any <b>Demand</b> row to open the demand letter with its full breakdown of charges.</div></div>'
        +'<div style="display:flex;gap:11px"><i class="fa-solid fa-print" style="color:#1d4ed8;margin-top:3px;width:16px;text-align:center"></i>'
          +'<div><b>The whole ledger</b><br><b>Print / Download PDF</b> at the top gives you every demand and payment on this flat in one statement.</div></div>'
      +'</div>'
      +'<div style="margin-top:16px;padding:11px 13px;background:#f1f5f9;border-left:3px solid var(--brand);border-radius:7px;font-size:13px">'
        +'<b>Need several at once?</b> Tick the box on each row you want, then press the <b>Download</b> button that appears at the top. '
        +'They come down together as a single ZIP file.</div>'
      +'<p style="margin:14px 0 0;font-size:12.5px;color:var(--slate)">If a document will not open, your browser may be blocking pop-ups for this site — allow them and try again.</p>'
    +'</div>'
    +'<div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Got it</button></div>','md');
};
window.custPrintLedger=function(){
  const unit=window._custLedgerUnit,entries=window._custLedgerEntries;
  if(!unit){toast('Nothing to print yet','err');return;}
  const w=window.open('','_blank');
  if(!w){toast('Please allow popups to print','err');return;}
  // D / C suffixes rather than the screen's Due/Adv tags - this is the format Farvision's own
  // Applicant Ledger printout uses, and a printed copy is the one people put side by side with it.
  let runBal=0;
  const balText=b=>b>0?custInr(b)+' D':b<0?custInr(Math.abs(b))+' C':'0.00';
  const totalDebit=(entries||[]).reduce((s,e)=>s+(e.debit||0),0);
  const totalCredit=(entries||[]).reduce((s,e)=>s+(e.credit||0),0);
  const trs=(entries||[]).map(e=>{runBal+=e.debit-e.credit;
    return '<tr><td>'+fmtDate(e.date)+'</td><td>'+esc(e.type)+'</td><td>'+esc(e.ref||'—')+'</td><td>'+esc(e.desc||'—')+'</td><td style="text-align:right">'+(e.debit?custInr(e.debit):'')+'</td><td style="text-align:right">'+(e.credit?custInr(e.credit):'')+'</td><td style="text-align:right">'+balText(runBal)+'</td></tr>';
  }).join('');
  const html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Applicant Ledger — '+esc(unit.unit_code)+'</title><style>'+
    'body{margin:32px;font-family:Inter,system-ui,sans-serif;color:#0f172a}'+
    'h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;color:#64748b;font-weight:500;margin:0 0 16px}'+
    '.summary{font-size:13px;margin-bottom:14px}'+
    'table{width:100%;border-collapse:collapse}th,td{padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:11.5px}'+
    'th{color:#64748b;font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.03em;background:#f8fafc}'+
    'td:nth-child(5),td:nth-child(6),td:nth-child(7),th:nth-child(5),th:nth-child(6),th:nth-child(7){text-align:right}'+
    'tfoot td{font-weight:700;border-top:2px solid #334155}'+
    '@media print{body{margin:16px}}'+
    '</style></head><body>'+
    '<h1>Applicant Ledger — '+esc(unit.unit_code)+(unit.tower?', '+esc(unit.tower):'')+'</h1>'+
    '<h2>'+esc((unit.projects&&unit.projects.name)||'')+' · Generated on '+fmtDate(new Date())+'</h2>'+
    '<div class="summary">Every demand raised and payment received on this unit, in date order.</div>'+
    '<table><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Details</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>'+
    '<tbody>'+trs+'</tbody>'+
    '<tfoot><tr><td colspan="4">Periodic Ledger Total</td><td style="text-align:right">'+custInr(totalDebit)+'</td><td style="text-align:right">'+custInr(totalCredit)+'</td><td style="text-align:right">'+balText(runBal)+'</td></tr></tfoot>'+
    '</table></body></html>';
  try{w.document.open();w.document.write(html);w.document.close();}
  catch(_e){toast('Could not build the printout','err');return;}
  setTimeout(function(){try{w.focus();w.print();}catch(_e){}},350);
};

/* ---------- Money receipt (viewed / downloaded from a ledger receipt row) ----------
   Every figure below comes from the Farvision Receipt Register import - money_receipts for the
   header, receipt_items for the allocation lines - so the portal never invents a receipt number,
   date, amount or adjustment. The issuer block is the only static part: it is the company
   letterhead, identical on every Farvision receipt, not per-customer data. */
const CUST_RECEIPT_ISSUER={
  name:'DREAM GATEWAY HOTELS LIMITED',
  address:'JAIN GROUP, 44/2A, HAZRA ROAD, KOLKATA-19, KOLKATA, WEST BENGAL, INDIA, PIN:700019',
  gstin:'19AADCD0692H1ZL',
  pan:'AADCD0692H'
};
// Indian-system amount in words ("Rupees One Lac Eighty Four Thousand Six Hundred Eighty Four Only"),
// matching how Farvision spells the total on its own receipt.
function custAmountInWords(n){
  n=Math.floor(Math.abs(Number(n)||0));
  if(!n) return 'Rupees Zero Only';
  const ones=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve',
    'Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const two=v=>v<20?ones[v]:(tens[Math.floor(v/10)]+(v%10?' '+ones[v%10]:''));
  const three=v=>(v>=100?ones[Math.floor(v/100)]+' Hundred'+(v%100?' ':''):'')+(v%100?two(v%100):'');
  const parts=[];
  const crore=Math.floor(n/10000000); n%=10000000;
  const lac=Math.floor(n/100000);     n%=100000;
  const thou=Math.floor(n/1000);      n%=1000;
  if(crore) parts.push(three(crore)+' Crore');
  if(lac)   parts.push(three(lac)+' Lac');
  if(thou)  parts.push(three(thou)+' Thousand');
  if(n)     parts.push(three(n));
  return 'Rupees '+parts.join(' ')+' Only';
}
// Builds the receipt document once; the modal preview and the printable page share it so what a
// customer sees on screen is exactly what downloads.
function custReceiptDocHtml(r,items,unit,contact,forPrint){
  const c=contact||{}, p=(unit&&unit.projects&&unit.projects.name)||'';
  const field=(l,v)=>'<div class="rcpt-f"><span>'+esc(l)+'</span><b>'+(v?esc(v):'—')+'</b></div>';
  const left=[
    field('Email',c.contact_email),
    field('Contact No',c.contact_phone),
    field('Booking No',unit&&unit.booking_no),
    field('Customer No',unit&&unit.application_no)
  ].join('');
  // Farvision prints the unit's category letter (its Level4 in the ERP hierarchy). That letter is
  // the tail of the unit code - checked against all 145 rows of the Sales Details export, where
  // Level4 equalled the unit-code tail every time - so it needs no separate column.
  const category=String((unit&&unit.unit_code)||'').replace(/^\d+/,'').trim().toUpperCase();
  const right=[
    field('Receipt No',r.receipt_no),
    field('Receipt Date',r.receipt_date?fmtDate(r.receipt_date):''),
    field('Project',p),
    field('Category',category),
    field('Unit No',unit&&unit.unit_code),
    field('Payment Mode',r.payment_mode),
    field('Drawn On',r.drawn_on),
    field('Instn. No.',r.instrument_no),
    field('Instn. Date',r.instrument_date?fmtDate(r.instrument_date):'')
  ].join('');
  const rowsHtml=custAnantaReceiptItems(unit,items).map((it,i)=>'<tr>'+
    '<td>'+(i+1)+'</td>'+
    '<td>'+(it.line_type==='on_account'?'On Account':'Bill')+'</td>'+
    '<td>'+esc(it.schedule||'—')+'</td>'+
    '<td>'+esc(it.revenue_head||'—')+'</td>'+
    '<td>'+esc(it.against_demand_no||'—')+'</td>'+
    '<td>'+(it.invoice_date?fmtDate(it.invoice_date):'—')+'</td>'+
    '<td>'+esc(it.particulars||'—')+'</td>'+
    '<td class="amt">'+custInr(it.amount||0)+'</td></tr>').join('');
  const total=Number(r.total_amount||0);
  const badge=r.is_reversed?'<span class="tag t-red">Reversed</span>':'';
  return ''+
    '<div class="rcpt-doc'+(forPrint?' print':'')+'">'+
      '<div class="rcpt-issuer"><h2>'+esc(CUST_RECEIPT_ISSUER.name)+'</h2>'+
        '<div class="rcpt-addr">'+esc(CUST_RECEIPT_ISSUER.address)+'</div>'+
        '<div class="rcpt-addr">GSTIN : '+esc(CUST_RECEIPT_ISSUER.gstin)+' &nbsp;·&nbsp; PAN : '+esc(CUST_RECEIPT_ISSUER.pan)+'</div>'+
      '</div>'+
      '<div class="rcpt-title">Receipt '+badge+'</div>'+
      '<div class="rcpt-grid">'+
        '<div><div class="rcpt-name">'+esc((c.contact_name)||(unit&&unit.customer_name)||'')+'</div>'+
          (c.contact_address?'<div class="rcpt-addr">'+esc(c.contact_address)+'</div>':'')+left+'</div>'+
        '<div>'+right+'</div>'+
      '</div>'+
      (r.narration?'<div class="rcpt-remarks"><span>Remarks :</span> <b>'+esc(r.narration)+'</b></div>':'')+
      '<div class="rcpt-tblwrap"><table class="rcpt-tbl"><thead><tr>'+
        '<th>Sl. #</th><th>Type</th><th>Schedule Name</th><th>Revenue Name</th>'+
        '<th>Invoice No</th><th>Invoice Dt</th><th>Particulars</th><th class="amt">Total Amt</th>'+
      '</tr></thead><tbody>'+(rowsHtml||'<tr><td colspan="8" style="text-align:center;color:#64748b">No allocation lines recorded for this receipt.</td></tr>')+'</tbody>'+
      '<tfoot><tr><td colspan="7">Total Receipt Amount</td><td class="amt">'+custInr(total)+'</td></tr>'+
      '<tr><td colspan="8" class="rcpt-words">Amount in Words : '+esc(custAmountInWords(total))+'</td></tr></tfoot>'+
      '</table></div>'+
      '<div class="rcpt-sign">For, '+esc(CUST_RECEIPT_ISSUER.name)+'</div>'+
    '</div>';
}
// Styles are shared by the on-screen modal and the printable window.
const CUST_RECEIPT_CSS=
  '.rcpt-doc{color:#0f172a;font-size:12.5px}'+
  '.rcpt-issuer{border-bottom:1px solid #e2e8f0;padding-bottom:10px;margin-bottom:12px}'+
  '.rcpt-issuer h2{margin:0 0 3px;font-size:16px;letter-spacing:.01em}'+
  '.rcpt-addr{color:#64748b;font-size:11.5px;line-height:1.5}'+
  '.rcpt-title{text-align:center;font-size:14px;font-weight:700;letter-spacing:.06em;margin:0 0 14px;display:flex;align-items:center;justify-content:center;gap:10px}'+
  '.rcpt-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:12px}'+
  '.rcpt-name{font-weight:700;margin-bottom:3px}'+
  '.rcpt-f{display:flex;gap:8px;padding:1.5px 0;font-size:12px}'+
  '.rcpt-f span{color:#64748b;min-width:96px;flex:0 0 96px}'+
  '.rcpt-f b{font-weight:600;word-break:break-word}'+
  '.rcpt-remarks{margin:0 0 10px;font-size:12px}.rcpt-remarks span{color:#64748b}'+
  '.rcpt-tblwrap{overflow-x:auto}'+
  '.rcpt-tbl{width:100%;border-collapse:collapse;font-size:11.5px;min-width:660px}'+
  '.rcpt-tbl th,.rcpt-tbl td{border:1px solid #e2e8f0;padding:5px 7px;text-align:left;vertical-align:top}'+
  '.rcpt-tbl thead th{background:#f8fafc;color:#475569;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em}'+
  '.rcpt-tbl .amt{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}'+
  '.rcpt-tbl tfoot td{font-weight:700;background:#f8fafc}'+
  '.rcpt-tbl tfoot td:first-child{text-align:right}'+
  '.rcpt-tbl tfoot tr.rcpt-strong td{background:#f1f5f9}'+
  '.rcpt-tbl tfoot .rcpt-words{font-weight:600;text-align:left;background:#fff}'+
  // Demand-letter terms: small print, and it must not be split mid-clause across printed pages.
  '.rcpt-terms{margin-top:18px;font-size:11px;line-height:1.55;color:#334155;break-inside:avoid}'+
  '.rcpt-terms h4{margin:12px 0 4px;font-size:11.5px;font-weight:700;color:#0f172a}'+
  '.rcpt-terms p{margin:0 0 6px;text-align:justify}'+
  '.rcpt-terms ul{margin:0 0 6px;padding-left:16px}.rcpt-terms li{margin-bottom:3px}'+
  '.rcpt-sign{margin-top:26px;text-align:right;font-weight:700;font-size:12px}'+
  // On a phone the two header columns cannot sit side by side without clipping the right one.
  '@media(max-width:640px){.rcpt-grid{grid-template-columns:1fr;gap:12px}'+
  '.rcpt-f span{min-width:82px;flex:0 0 82px}.rcpt-title{font-size:13px}}';

window.custViewReceipt=async function(id){
  const unit=window._custLedgerUnit;
  if(!unit){toast('Open the ledger first','err');return;}
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-receipt"></i> Money Receipt</h3><span class="x" onclick="closeModal()">&times;</span></div>'+
    '<div class="modal-body"><div class="loader"><div class="spin"></div></div></div>','lg');
  const [{data:rcpt,error:re},{data:its},{data:cts}]=await Promise.all([
    sb.schema('cust').from('money_receipts').select('*').eq('id',id).maybeSingle(),
    sb.schema('cust').from('receipt_items').select('*').eq('receipt_id',id).order('sort_order'),
    sb.schema('cust').from('farvision_contacts').select('*').eq('unit_id',unit.id).eq('is_current',true).limit(1)
  ]);
  if(re||!rcpt){openModal('<div class="modal-head"><h3>Money Receipt</h3><span class="x" onclick="closeModal()">&times;</span></div>'+
    '<div class="modal-body"><div class="card card-pad empty">This receipt could not be loaded.</div></div>','lg');return;}
  /* receipt_items.invoice_date exists but nothing fills it - the Receipt Register export gives the
     invoice NUMBER a receipt was applied to, not its date, so the column printed "—" on every line.
     The date is the document_date of that invoice, which we already hold: all 14,403 allocation
     lines match an invoice we have, so this resolves for every line rather than most of them. */
  const items=its||[];
  const docNos=[...new Set(items.map(i=>i.against_demand_no).filter(Boolean))];
  const dateByDoc={};
  if(docNos.length){
    const {data:invs}=await sb.schema('cust').from('invoices')
      .select('document_no,document_date').eq('unit_id',unit.id).eq('is_current',true).in('document_no',docNos);
    (invs||[]).forEach(v=>{dateByDoc[v.document_no]=v.document_date;});
  }
  const lines=items.map(i=>Object.assign({},i,{invoice_date:i.invoice_date||dateByDoc[i.against_demand_no]||null}));
  window._custReceiptCache={r:rcpt,items:lines,unit:unit,contact:(cts&&cts[0])||null};
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-receipt"></i> Money Receipt</h3><span class="x" onclick="closeModal()">&times;</span></div>'+
    '<div class="modal-body"><style>'+CUST_RECEIPT_CSS+'</style>'+
      custReceiptDocHtml(rcpt,lines,unit,(cts&&cts[0])||null,false)+'</div>'+
    '<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button>'+
    '<button class="btn btn-primary" onclick="custPrintReceipt()"><i class="fa-solid fa-download"></i> Download PDF</button></div>','lg');
};

window.custPrintReceipt=function(){
  const s=window._custReceiptCache;
  if(!s){toast('Open a receipt first','err');return;}
  const w=window.open('','_blank');
  if(!w){toast('Please allow popups to download','err');return;}
  const fileName='Money-Receipt-'+String(s.r.receipt_no||'').replace(/[^A-Za-z0-9]+/g,'-');
  const html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+esc(fileName)+'</title><style>'+
    'body{margin:26px;font-family:Inter,system-ui,sans-serif}'+CUST_RECEIPT_CSS+
    '.rcpt-tbl{min-width:0}.rcpt-tblwrap{overflow:visible}'+
    '@media print{body{margin:12px}}'+
    '</style></head><body>'+custReceiptDocHtml(s.r,s.items,s.unit,s.contact,true)+'</body></html>';
  try{w.document.open();w.document.write(html);w.document.close();}
  catch(_e){toast('Could not build the receipt','err');return;}
  setTimeout(function(){try{w.focus();w.print();}catch(_e){}},350);
};

window.custDocPickChanged=function(){
  const picks=Array.from(document.querySelectorAll('.rcpt-pick'));
  const checked=picks.filter(p=>p.checked);
  const n=checked.length;
  // Determine which kind is being selected — lock out the other kind
  const activeKind=checked.length?checked[0].dataset.kind:null;
  picks.forEach(p=>{
    if(activeKind&&p.dataset.kind!==activeKind){p.disabled=true;p.checked=false;}
    else p.disabled=false;
  });
  const btn=document.getElementById('custBulkDlBtn');
  const lbl=document.getElementById('custBulkDlLabel');
  if(btn){
    btn.style.display=n?'':'none';
    if(lbl) lbl.textContent='Download '+(activeKind==='invoice'?'invoices':'receipts')+' ('+n+')';
  }
};

// Bulk download: multiple receipts OR multiple invoices as one multi-page PDF.
// Receipts and invoices are never mixed — the checkbox handler enforces same-type selection.
window.custDownloadSelectedDocs=async function(){
  const unit=window._custLedgerUnit;
  if(!unit){toast('Open the ledger first','err');return;}
  const checked=Array.from(document.querySelectorAll('.rcpt-pick:checked'));
  const kind=checked.length?checked[0].dataset.kind:null;
  const rcptIds=kind==='receipt'?checked.map(p=>Number(p.value)).filter(Boolean):[];
  const invIds=kind==='invoice'?checked.map(p=>Number(p.value)).filter(Boolean):[];
  if(!rcptIds.length&&!invIds.length){toast('Tick the documents you want to download','err');return;}
  const w=window.open('','_blank');
  if(!w){toast('Please allow popups to download','err');return;}
  const total=rcptIds.length+invIds.length;
  try{w.document.write('<!DOCTYPE html><title>Documents</title><body style="font:14px Inter,system-ui,sans-serif;margin:26px;color:#475569">Preparing '+total+' document'+(total===1?'':'s')+'…');}catch(_e){}
  const [{data:cts},{data:csi},{data:snap}]=await Promise.all([
    sb.schema('cust').from('farvision_contacts').select('*').eq('unit_id',unit.id).eq('is_current',true).limit(1),
    sb.schema('cust').from('cost_sheet_items').select('component,amount').eq('unit_id',unit.id).eq('is_current',true),
    sb.schema('cust').from('outstanding_snapshot').select('late_fee_accrued').eq('unit_id',unit.id).eq('is_current',true).maybeSingle()
  ]);
  const contact=(cts&&cts[0])||null;
  const pages=[];
  // Receipts
  if(rcptIds.length){
    const [{data:rcpts},{data:rItems}]=await Promise.all([
      sb.schema('cust').from('money_receipts').select('*').in('id',rcptIds).eq('unit_id',unit.id).eq('is_current',true),
      sb.schema('cust').from('receipt_items').select('*').in('receipt_id',rcptIds).order('sort_order')
    ]);
    // Same invoice-date fill as the single-receipt view - a bulk download must not print "—" where
    // opening the receipt on screen shows a date.
    const bulkDocNos=[...new Set((rItems||[]).map(i=>i.against_demand_no).filter(Boolean))];
    const bulkDateByDoc={};
    if(bulkDocNos.length){
      const {data:bInvs}=await sb.schema('cust').from('invoices')
        .select('document_no,document_date').eq('unit_id',unit.id).eq('is_current',true).in('document_no',bulkDocNos);
      (bInvs||[]).forEach(v=>{bulkDateByDoc[v.document_no]=v.document_date;});
    }
    const byReceipt={};
    (rItems||[]).forEach(it=>{
      const line=Object.assign({},it,{invoice_date:it.invoice_date||bulkDateByDoc[it.against_demand_no]||null});
      (byReceipt[it.receipt_id]=byReceipt[it.receipt_id]||[]).push(line);
    });
    const rank={}; rcptIds.forEach((id,i)=>{rank[id]=i;});
    (rcpts||[]).slice().sort((a,b)=>rank[a.id]-rank[b.id]).forEach(r=>{
      pages.push(custReceiptDocHtml(r,byReceipt[r.id]||[],unit,contact,true));
    });
  }
  // Invoices (as Tax Invoice format)
  if(invIds.length){
    const [{data:invs},{data:allInv},{data:rcpts2}]=await Promise.all([
      sb.schema('cust').from('invoices').select('*').in('id',invIds).eq('unit_id',unit.id).eq('is_current',true),
      sb.schema('cust').from('invoices').select('document_no,document_date,due_date,invoice_items(schedule,revenue_head,amount,tax,net_amount,sort_order)')
        .eq('unit_id',unit.id).eq('is_current',true).neq('status',CUST_INVOICE_CANCELLED).order('due_date'),
      sb.schema('cust').from('money_receipts').select('id,receipt_date').eq('unit_id',unit.id).eq('is_current',true)
    ]);
    const rids2=(rcpts2||[]).map(r=>r.id).filter(Boolean);
    const {data:alloc2}=rids2.length
      ? await sb.schema('cust').from('receipt_items').select('against_demand_no,schedule,revenue_head,amount,line_type,particulars,receipt_id').in('receipt_id',rids2)
      : {data:[]};
    const receiptDates={};(rcpts2||[]).forEach(r=>{receiptDates[r.id]=r.receipt_date;});
    const rate=custDocRate(unit,csi);
    const lateFee=Number((snap&&snap.late_fee_accrued)||0);
    (invs||[]).forEach(inv=>{
      const {data:its}={data:(allInv||[]).find(a=>a.document_no===inv.document_no)};
      const items=its&&its.invoice_items?its.invoice_items:[];
      const {plan,prevDues}=custBuildPlan(allInv,alloc2,inv.document_date,receiptDates);
      pages.push(custInvoiceDocHtml({inv:inv,items:items,plan:plan,prevDues:prevDues,lateFee:lateFee,rate:rate,unit:unit,contact:contact},'invoice',true));
    });
  }
  if(!pages.length){try{w.close();}catch(_e){} toast('No documents could be loaded','err');return;}
  const fileName='Documents-'+String(unit.unit_code||'').replace(/[^A-Za-z0-9]+/g,'-')+'-'+pages.length;
  const html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+esc(fileName)+'</title><style>'+
    'body{margin:26px;font-family:Inter,system-ui,sans-serif}'+CUST_RECEIPT_CSS+
    '.rcpt-tbl{min-width:0}.rcpt-tblwrap{overflow:visible}'+
    '.rcpt-page+.rcpt-page{margin-top:34px;border-top:1px dashed #cbd5e1;padding-top:34px}'+
    '@media print{body{margin:12px}'+
    '.rcpt-page{page-break-after:always;break-after:page}'+
    '.rcpt-page:last-child{page-break-after:auto;break-after:auto}'+
    '.rcpt-page+.rcpt-page{margin-top:0;border-top:0;padding-top:0}}'+
    '</style></head><body>'+
    pages.map(p=>'<div class="rcpt-page">'+p+'</div>').join('')+
    '</body></html>';
  try{w.document.open();w.document.write(html);w.document.close();}
  catch(_e){toast('Could not build the documents','err');return;}
  setTimeout(function(){try{w.focus();w.print();}catch(_e){}},450);
};

/* --------------------------- Tax Invoice / Demand Letter ---------------------------
   One invoice, two printable formats - the same choice Farvision's Document Print dialog
   offers. Both are built from cust.invoices + invoice_items, verified line for line against
   Farvision's own PDF exports for OHINV/0008725-26.

   The GST column is deliberately Amount / GST / Total rather than Farvision's HSN +
   CGST/SGST + taxable-value breakup: we hold a single tax figure per line, and the taxable
   value cannot be derived from it reliably - Unit Cost is taxed at 7.5% on two-thirds of
   value (land abatement) while Legal Documentation is 18% on the full value. Reconstructing
   the split lands ~0.07% off the filed GSTR1 figure, which is not good enough for a tax
   document, so it is omitted rather than guessed. */
const CUST_INVOICE_FORMATS={invoice:'Tax Invoice',demand:'Demand Letter'};

// Reproduced from Farvision's own demand letter template, which is the wording the company
// already sends - not drafted here. The bank-details block that follows it on the Farvision
// printout is blank at source, so it is omitted rather than printed as empty labels.
const CUST_DEMAND_TERMS=[
  'The above mentioned total due amount is excluding interest for late payment. You are therefore requested to remit/pay the above mentioned amount immediately to avoid further interest accrual @ 18 % p.a. However, interest on previous outstanding shall be payable till the date of payment. Please ignore this demand letter, if already paid. Demand letter does not mean revocation of termination. If you have been issued termination letter, kindly contact us immediately at 033-40319999'
];
const CUST_DEMAND_NOTES=[
  'Jain Group is committed towards transparency, customer satisfaction and highest ethics. Please mail assistant.md@thejaingroup.com or call 9330026077, if any Jain Group employee requests cash, gifts or any benefits whatsover.',
  'Bank charges (if any) will also be payable plus GST.',
  'Interest @ 18% p.a. will be charged as applicable.',
  'If your accounts do not tally with our records, please contact us immediately.',
  'Please mention Customer Name, Customer Code, Project Name & Payment details behind your cheque / DD.',
  'Status of Project Completion ( As per Demand).'
];

// ctx: {inv, items, prevDues, plan, lateFee, unit, contact, rate}
//   inv/items - the selected invoice, for the Tax Invoice format
//   plan      - every non-cancelled billed line for the unit with what has been paid against it,
//               for the Demand format, which Farvision issues over the whole payment plan rather
//               than a single invoice
function custInvoiceDocHtml(ctx,fmt,forPrint){
  const inv=ctx.inv||{}, unit=ctx.unit||{}, c=ctx.contact||{};
  const p=(unit.projects&&unit.projects.name)||'';
  const demand=fmt==='demand';
  const field=(l,v)=>'<div class="rcpt-f"><span>'+esc(l)+'</span><b>'+(v?esc(v):'—')+'</b></div>';
  // Same derivation the money receipt uses: the category letter is the tail of the unit code.
  const category=String(unit.unit_code||'').replace(/^\d+/,'').trim().toUpperCase();
  const sba=Number(unit.super_built_up_area_sqft||0);
  // Farvision labels the co-applicant differently on the two documents, and prints the line only
  // when there is one - 95 of our 145 bookings have one, so an always-present empty row would be
  // wrong on a third of them.
  const left=[
    c.co_applicant_name?field(demand?'Co Applicant(S)':'Co Applicant Name',c.co_applicant_name):'',
    field('Email',c.contact_email),
    field('Contact No',c.contact_phone),
    field('GSTIN',inv.gstin),
    field(demand?'Application Code No.':'Booking No',unit.booking_no),
    field('Customer No',unit.application_no)
  ].join('');
  // Farvision dates a demand letter to the invoice it was raised against while reporting paid
  // amounts as they stand now - confirmed against its own export for OHINV/0008725-26, dated
  // 05/05/2025 yet carrying today's payment position. Mirrored here rather than "corrected".
  const right=(demand?[
    field('Dated',inv.document_date?fmtDate(inv.document_date):fmtDate(new Date())),
    field('Demand Against',inv.document_no),
    field('Project',p),
    field('Category',category),
    field('Unit No',unit.unit_code),
    sba?field('Total Sale Area',sba+' SQ. FT.'):'',
    ctx.rate?field('Rate',ctx.rate+' per SQ.FT.'):''
  ]:[
    field('Invoice No',inv.document_no),
    field('Invoice Date',inv.document_date?fmtDate(inv.document_date):''),
    field('Due Date',inv.due_date?fmtDate(inv.due_date):''),
    field('Project',p),
    field('Category',category),
    field('Unit No',unit.unit_code),
    field('Invoice Type',inv.invoice_type)
  ]).join('');

  let head,rowsHtml,foot,tail='';
  if(demand){
    head='<th>Due Date</th><th>Description</th><th>Charge Type</th>'+
      '<th class="amt">Amount Due</th><th class="amt">Amount Paid</th><th class="amt">Amount Payable</th>';
    let due=0,paid=0;
    rowsHtml=custAnantaPlan(unit,ctx.plan).map(r=>{
      due+=r.due; paid+=r.paid;
      return '<tr><td>'+(r.dueDate?fmtDate(r.dueDate):'—')+'</td>'+
        '<td>'+esc(r.schedule||'—')+'</td><td>'+esc(r.head||'—')+'</td>'+
        '<td class="amt">'+custInr(r.due)+'</td><td class="amt">'+custInr(r.paid)+'</td>'+
        '<td class="amt">'+custInr(r.due-r.paid)+'</td></tr>';
    }).join('');
    // On-account receipts are rows in the table above, so the totals already account for them.
    const payable=due-paid;
    foot='<tr><td colspan="3">Total Amount Due</td><td class="amt">'+custInr(due)+'</td>'+
      '<td class="amt">'+custInr(paid)+'</td><td class="amt">'+custInr(payable)+'</td></tr>'+
      '<tr><td colspan="6" class="rcpt-words">Amount payable in words : '+esc(custAmountInWords(Math.max(0,payable)))+'</td></tr>';
    tail='<div class="rcpt-terms">'+
      '<h4>Terms &amp; Condition:</h4>'+
      CUST_DEMAND_TERMS.map(t=>'<p>'+esc(t)+'</p>').join('')+
      '<h4>Note :</h4><ul>'+CUST_DEMAND_NOTES.map(n=>'<li>'+esc(n)+'</li>').join('')+'</ul>'+
      '<p>Expecting your prompt action in this regard, and assuring you of our best services always, we remain.</p>'+
      '<p>Yours faithfully,</p></div>';
  }else{
    head='<th>Sl. #</th><th>Schedule Name</th><th>Revenue Name</th>'+
      '<th class="amt">Amount</th><th class="amt">GST</th><th class="amt">Total Amt</th>';
    let amt=0,tax=0,net=0;
    rowsHtml=custAnantaInvoiceItems(unit,ctx.items).map((it,i)=>{
      amt+=Number(it.amount||0); tax+=Number(it.tax||0); net+=Number(it.net_amount||0);
      return '<tr><td>'+(i+1)+'</td><td>'+esc(it.schedule||'—')+'</td><td>'+esc(it.revenue_head||'—')+'</td>'+
        '<td class="amt">'+custInr(it.amount||0)+'</td><td class="amt">'+custInr(it.tax||0)+'</td>'+
        '<td class="amt">'+custInr(it.net_amount||0)+'</td></tr>';
    }).join('');
    // Previous dues is what is still unpaid on invoices raised before this one. It can only be
    // stated as a single figure: receipts allocate against the net of a line, never split across
    // its basic and tax, so an amount/GST breakup of a part-paid line would be invented.
    const prev=Number(ctx.prevDues||0);
    const lateFee=Number(ctx.lateFee||0);
    const sumRow=(label,a,t,n,strong)=>'<tr'+(strong?' class="rcpt-strong"':'')+'><td colspan="3">'+esc(label)+'</td>'+
      '<td class="amt">'+a+'</td><td class="amt">'+t+'</td><td class="amt">'+n+'</td></tr>';
    // Previous dues and late fees carry no basic/GST split of their own, so a running total can
    // only show those two columns while both are nil - which is the normal case, and then the
    // running totals simply repeat the invoice's own figures, exactly as Farvision prints them.
    // Once either is non-nil the split is genuinely unknown and the column shows a dash rather
    // than a made-up number.
    const carry=(v,blocked)=>blocked?'—':custInr(v);
    foot=
      sumRow('Total Invoice Amount :',custInr(amt),custInr(tax),custInr(net))+
      sumRow('Previous dues :',carry(0,prev),carry(0,prev),custInr(prev))+
      sumRow('Total Payable :',carry(amt,prev),carry(tax,prev),custInr(net+prev),true)+
      sumRow('Late Payment fees :',carry(0,lateFee),carry(0,lateFee),custInr(lateFee))+
      sumRow('Total payable with interest :',carry(amt,prev||lateFee),carry(tax,prev||lateFee),custInr(net+prev+lateFee),true)+
      '<tr><td colspan="6" class="rcpt-words">Amount in Words : '+esc(custAmountInWords(net+prev+lateFee))+'</td></tr>';
  }
  return ''+
    '<div class="rcpt-doc'+(forPrint?' print':'')+'">'+
      '<div class="rcpt-issuer"><h2>'+esc(CUST_RECEIPT_ISSUER.name)+'</h2>'+
        '<div class="rcpt-addr">'+esc(CUST_RECEIPT_ISSUER.address)+'</div>'+
        '<div class="rcpt-addr">GSTIN : '+esc(CUST_RECEIPT_ISSUER.gstin)+' &nbsp;·&nbsp; PAN : '+esc(CUST_RECEIPT_ISSUER.pan)+'</div>'+
      '</div>'+
      '<div class="rcpt-title">'+(demand?'DEMAND LETTER':'TAX INVOICE')+'</div>'+
      '<div class="rcpt-grid">'+
        '<div><div class="rcpt-name">'+esc(c.contact_name||'')+'</div>'+
          (c.contact_address?'<div class="rcpt-addr">'+esc(c.contact_address)+'</div>':'')+left+'</div>'+
        '<div>'+right+'</div>'+
      '</div>'+
      (demand?'<div class="rcpt-remarks">Dear Sir / Madam,<br>We wish to inform you that your following installments are falling due on the dates indicated against them.</div>':'')+
      '<div class="rcpt-tblwrap"><table class="rcpt-tbl"><thead><tr>'+head+'</tr></thead>'+
      '<tbody>'+(rowsHtml||'<tr><td colspan="6" style="text-align:center;color:#64748b">No charge lines recorded.</td></tr>')+'</tbody>'+
      '<tfoot>'+foot+'</tfoot></table></div>'+
      tail+
      '<div class="rcpt-sign">For, '+esc(CUST_RECEIPT_ISSUER.name)+'</div>'+
      '<div class="rcpt-addr" style="margin-top:14px">PAN NO : '+esc(CUST_RECEIPT_ISSUER.pan)+' &nbsp;·&nbsp; GSTIN : '+esc(CUST_RECEIPT_ISSUER.gstin)+'</div>'+
      '<div class="rcpt-addr">This is a system generated document. No signature required.</div>'+
    '</div>';
}

// Every billed line for the unit with what has been paid against it, plus what was still unpaid
// on invoices raised before `beforeDate`. Receipts are matched the way Farvision allocates them:
// against the invoice number, then the schedule and revenue head within it. Kept pure so it can
// be checked against the ledger and against Farvision's own demand letter without a round trip.
function custBuildPlan(allInv,alloc,beforeDate,receiptDates){
  const SEP=String.fromCharCode(31);
  const key=(doc,sch,head)=>[String(doc||''),String(sch||''),String(head||'')].join(SEP);
  // An "On Account" receipt line is money received against the unit but not applied to any
  // particular demand, so it has no invoice number to match on. It still belongs in the table as
  // a payment in its own right - dated by the receipt it came in on, which is what our data
  // records - rather than being spread across plan lines by guesswork or bolted on as a footer
  // adjustment. Nothing owes against it, so it carries no Amount Due.
  const paidByKey={}; let onAccount=0; const onAccountRows=[];
  (alloc||[]).forEach(a=>{
    const amt=Number(a.amount||0);
    if(a.line_type==='on_account'||!a.against_demand_no){
      onAccount+=amt;
      onAccountRows.push({dueDate:new Date().toISOString().slice(0,10),
        schedule:a.particulars||'On Account',head:'',due:0,paid:amt});
      return;
    }
    const k=key(a.against_demand_no,a.schedule,a.revenue_head);
    paidByKey[k]=(paidByKey[k]||0)+amt;
  });
  const plan=[]; let prevDues=0;
  (allInv||[]).forEach(iv=>{
    (iv.invoice_items||[]).slice().sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)).forEach(it=>{
      const due=Number(it.net_amount||0);
      const paid=Math.min(due,Number(paidByKey[key(iv.document_no,it.schedule,it.revenue_head)]||0));
      plan.push({doc:iv.document_no,dueDate:iv.due_date||iv.document_date,schedule:it.schedule,head:it.revenue_head,due:due,paid:paid});
      if(beforeDate&&iv.document_date&&iv.document_date<beforeDate) prevDues+=Math.max(0,due-paid);
    });
  });
  onAccountRows.forEach(r=>plan.push(r));
  plan.sort((a,b)=>String(a.dueDate||'').localeCompare(String(b.dueDate||''))||
    String(a.schedule||'').localeCompare(String(b.schedule||''))||
    String(a.head||'').localeCompare(String(b.head||'')));
  // Money on account is available to settle what is outstanding, so it reduces previous dues
  // before any of it is left over.
  return {plan:plan,prevDues:Math.max(0,prevDues-onAccount),onAccount:onAccount};
}

window.custViewInvoice=async function(id){
  const unit=window._custLedgerUnit;
  if(!unit){toast('Open the ledger first','err');return;}
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-file-invoice"></i> Invoice</h3><span class="x" onclick="closeModal()">&times;</span></div>'+
    '<div class="modal-body"><div class="loader"><div class="spin"></div></div></div>','lg');
  const [{data:inv,error:ie},{data:its},{data:cts},{data:allInv},{data:rcpts},{data:csi},{data:snap}]=await Promise.all([
    sb.schema('cust').from('invoices').select('*').eq('id',id).eq('unit_id',unit.id).neq('status',CUST_INVOICE_CANCELLED).maybeSingle(),
    sb.schema('cust').from('invoice_items').select('*').eq('invoice_id',id).order('sort_order'),
    sb.schema('cust').from('farvision_contacts').select('*').eq('unit_id',unit.id).eq('is_current',true).limit(1),
    sb.schema('cust').from('invoices').select('document_no,document_date,due_date,invoice_items(schedule,revenue_head,amount,tax,net_amount,sort_order)')
      .eq('unit_id',unit.id).eq('is_current',true).neq('status',CUST_INVOICE_CANCELLED).order('due_date'),
    sb.schema('cust').from('money_receipts').select('id,receipt_date').eq('unit_id',unit.id).eq('is_current',true),
    sb.schema('cust').from('cost_sheet_items').select('component,amount').eq('unit_id',unit.id).eq('is_current',true),
    sb.schema('cust').from('outstanding_snapshot').select('late_fee_accrued').eq('unit_id',unit.id).eq('is_current',true).maybeSingle()
  ]);
  if(ie||!inv){openModal('<div class="modal-head"><h3>Invoice</h3><span class="x" onclick="closeModal()">&times;</span></div>'+
    '<div class="modal-body"><div class="card card-pad empty">This invoice could not be loaded.</div></div>','lg');return;}

  // Fetched by receipt id rather than by filtering an embedded money_receipts join: the embed
  // form returned nothing here, which silently made every earlier invoice look unpaid and put a
  // phantom "Previous dues" on the printed invoice.
  const rids=(rcpts||[]).map(r=>r.id).filter(Boolean);
  const {data:alloc}=rids.length
    ? await sb.schema('cust').from('receipt_items').select('against_demand_no,schedule,revenue_head,amount,line_type,particulars,receipt_id').in('receipt_id',rids)
    : {data:[]};
  const receiptDates={};
  (rcpts||[]).forEach(r=>{receiptDates[r.id]=r.receipt_date;});
  const {plan,prevDues,onAccount}=custBuildPlan(allInv,alloc,inv.document_date,receiptDates);

  window._custInvoiceCache={
    inv:inv, items:its||[], plan:plan, prevDues:prevDues, onAccount:onAccount,
    lateFee:Number((snap&&snap.late_fee_accrued)||0),
    rate:custDocRate(unit,csi),
    unit:unit, contact:(cts&&cts[0])||null, fmt:'invoice'
  };
  custRenderInvoiceModal();
};
function custRenderInvoiceModal(){
  const s=window._custInvoiceCache;
  if(!s) return;
  // A segmented control rather than a dropdown: there are exactly two formats, and which one is
  // about to be downloaded should be readable at a glance instead of hidden behind a closed
  // select. Uses the portal's own .seg component so it matches every other switcher.
  const icons={invoice:'fa-file-invoice',demand:'fa-file-lines'};
  const seg=Object.keys(CUST_INVOICE_FORMATS).map(k=>
    '<button type="button" class="seg-btn'+(k===s.fmt?' on':'')+'" aria-pressed="'+(k===s.fmt)+'"'+
    ' onclick="custSetInvoiceFormat(\''+k+'\')"><i class="fa-solid '+icons[k]+'"></i> '+
    esc(CUST_INVOICE_FORMATS[k])+'</button>').join('');
  openModal('<div class="modal-head"><h3><i class="fa-solid '+icons[s.fmt]+'"></i> '+esc(CUST_INVOICE_FORMATS[s.fmt])+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'+
    '<div class="modal-body"><style>'+CUST_RECEIPT_CSS+'</style>'+
      '<div class="rcpt-fmt">'+
        '<span class="rcpt-fmt-lbl">Format</span>'+
        '<div class="seg" role="group" aria-label="Document format">'+seg+'</div>'+
        '<span class="rcpt-fmt-hint">'+(s.fmt==='demand'
          ? 'Whole payment plan for this unit, with what has been paid against each instalment'
          : 'This invoice only — '+esc(s.inv.document_no||''))+'</span>'+
      '</div>'+
      custInvoiceDocHtml(s,s.fmt,false)+'</div>'+
    '<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button>'+
    '<button class="btn btn-primary" onclick="custPrintInvoice()"><i class="fa-solid fa-download"></i> Download '+esc(CUST_INVOICE_FORMATS[s.fmt])+'</button></div>','lg');
}

window.custSetInvoiceFormat=function(fmt){
  const s=window._custInvoiceCache;
  if(!s||!CUST_INVOICE_FORMATS[fmt]) return;
  s.fmt=fmt;
  custRenderInvoiceModal();
};

// Prints whatever format is currently selected - the preview and the download are always the
// same document, so choosing "Tax Invoice" can never hand the customer a demand letter.
window.custPrintInvoice=function(){
  const s=window._custInvoiceCache;
  if(!s){toast('Open an invoice first','err');return;}
  const w=window.open('','_blank');
  if(!w){toast('Please allow popups to download','err');return;}
  const label=s.fmt==='demand'?'Demand-Letter':'Tax-Invoice';
  const fileName=label+'-'+String(s.inv.document_no||'').replace(/[^A-Za-z0-9]+/g,'-');
  const html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+esc(fileName)+'</title><style>'+
    'body{margin:26px;font-family:Inter,system-ui,sans-serif}'+CUST_RECEIPT_CSS+
    '.rcpt-tbl{min-width:0}.rcpt-tblwrap{overflow:visible}'+
    '@media print{body{margin:12px}}'+
    '</style></head><body>'+custInvoiceDocHtml(s,s.fmt,true)+'</body></html>';
  try{w.document.open();w.document.write(html);w.document.close();}
  catch(_e){toast('Could not build the document','err');return;}
  setTimeout(function(){try{w.focus();w.print();}catch(_e){}},350);
};

/* Cost sheet rows with a Rate, as the CRM cost sheet prints them.
   RATE is per sq ft of super built-up area - how the CRM's 5150 / 350 / 100 come out of
   48,92,500 / 3,32,500 / 95,000 on 950 sq ft. Farvision's files carry no per-charge rate, so it is
   worked out from the amount:
     * Unit Cost, Floor Escalation (FLC) and PLC always have one - the CRM prices all three per
       sq ft - even when a discount leaves paise (FLC 2,49,536 on 860 sq ft = 290.16);
     * any other charge shows one only when it divides by the area into whole rupees - legal 25,
       generator 35, club infrastructure 65... A lump sum (association formation 15,000, cheque
       dishonoured 2,000) does not, and shows "-";
     * parking never does: it is priced per slot, and 4,00,000 on a 1,000 sq ft flat would
       otherwise read as a rate of 400.
   A table shows the Rate column only if at least one of its rows has a rate.
   DREAM ANANTA's CRM sheet prints Unit Cost, Floor Escalation (FLC), PLC and Vehicle Parking as ONE
   line, "Unit Price (Add On Premium Specification Pack)" (D/8G: 58,20,000 on 950 sq ft = 6,126.32).
   Every other project keeps Farvision's own line-by-line split. */
const CUST_ANANTA_UNIT_PRICE=/^unit cost$|flc charges|plc charge|vehicle parking/i;
const CUST_ANANTA_UNIT_PRICE_LABEL='Unit Price (Add On Premium Specification Pack)';
function custIsAnanta(unit){ return /^dream ananta$/i.test(String((unit&&unit.projects&&unit.projects.name)||'').trim()); }
/* The same one line on DREAM ANANTA's Tax Invoice and Demand Letter as on its cost sheet: Farvision
   bills Unit Cost, FLC, PLC and Vehicle Parking as separate revenue heads of one schedule, and the
   CRM shows them as "Unit Price (Add On Premium Specification Pack)". Lines are merged within the
   same schedule (and, on the demand letter, the same invoice), so each instalment's total and what
   has been paid against it are unchanged - only how many rows it takes to say it. The merged line
   sits where the first of its parts was. Every other project is returned untouched. */
function custAnantaInvoiceItems(unit,items){
  if(!custIsAnanta(unit)) return items||[];
  const out=[],at={};
  (items||[]).forEach(it=>{
    if(!CUST_ANANTA_UNIT_PRICE.test(String(it.revenue_head||'').trim())){ out.push(it); return; }
    const k=String(it.schedule||'');
    if(at[k]==null){ at[k]=out.length; out.push(Object.assign({},it,{revenue_head:CUST_ANANTA_UNIT_PRICE_LABEL,amount:0,tax:0,net_amount:0})); }
    const m=out[at[k]];
    m.amount=Number(m.amount)+Number(it.amount||0); m.tax=Number(m.tax)+Number(it.tax||0); m.net_amount=Number(m.net_amount)+Number(it.net_amount||0);
  });
  return out;
}
function custAnantaPlan(unit,plan){
  if(!custIsAnanta(unit)) return plan||[];
  const out=[],at={};
  (plan||[]).forEach(r=>{
    if(!CUST_ANANTA_UNIT_PRICE.test(String(r.head||'').trim())){ out.push(r); return; }
    const k=String(r.doc||'')+'|'+String(r.dueDate||'')+'|'+String(r.schedule||'');
    if(at[k]==null){ at[k]=out.length; out.push(Object.assign({},r,{head:CUST_ANANTA_UNIT_PRICE_LABEL,due:0,paid:0})); }
    const m=out[at[k]]; m.due+=Number(r.due||0); m.paid+=Number(r.paid||0);
  });
  return out;
}
/* Money Receipt lines for DREAM ANANTA: what was paid against Unit Cost, FLC, PLC and Vehicle Parking
   of the same invoice and schedule is one "Unit Price" line, as on its invoice. Lines are only merged
   when they agree on Bill/On Account and on their particulars, so nothing a receipt line says
   separately is lost; the receipt's total is its own figure and is unaffected. */
function custAnantaReceiptItems(unit,items){
  if(!custIsAnanta(unit)) return items||[];
  const out=[],at={};
  (items||[]).forEach(it=>{
    if(!CUST_ANANTA_UNIT_PRICE.test(String(it.revenue_head||'').trim())){ out.push(it); return; }
    const k=[it.line_type,it.against_demand_no,it.schedule,it.particulars].map(v=>String(v||'')).join('|');
    if(at[k]==null){ at[k]=out.length; out.push(Object.assign({},it,{revenue_head:CUST_ANANTA_UNIT_PRICE_LABEL,amount:0})); }
    out[at[k]].amount=Number(out[at[k]].amount)+Number(it.amount||0);
  });
  return out;
}
// The Rate printed on a demand letter: Unit Cost per sq ft, or for DREAM ANANTA the whole Unit Price
// (Unit Cost + FLC + PLC + parking) per sq ft - the same 6,126.32 its cost sheet shows for D/8G.
function custDocRate(unit,csi){
  const sba=Number(unit&&unit.super_built_up_area_sqft||0);
  if(!sba) return null;
  if(custIsAnanta(unit)){
    const amt=(csi||[]).filter(i=>CUST_ANANTA_UNIT_PRICE.test(String(i.component||'').trim())).reduce((s,i)=>s+Number(i.amount||0),0);
    return amt?custFmtRate(amt/sba):null;
  }
  const unitCost=(csi||[]).find(i=>/unit cost/i.test(i.component||''));
  return unitCost?Math.round(Number(unitCost.amount||0)/sba):null;
}
function custCostRows(unit,list,isUnitGroup){
  const sbu=Number(unit.super_built_up_area_sqft||0);
  const sum=(l,k)=>l.reduce((s,i)=>s+Number(i[k]||0),0);
  const itemRate=i=>{const amt=Number(i.amount||0);
    if(!sbu||!amt||/parking/i.test(i.component||'')) return null;
    const r=amt/sbu;
    if(/^unit cost$|flc charge|plc charge/i.test(String(i.component||'').trim())) return r;
    return Math.abs(r-Math.round(r))<1e-9?Math.round(r):null;};
  let rows;
  const isAnanta=/^dream ananta$/i.test(String((unit.projects&&unit.projects.name)||'').trim());
  if(isUnitGroup&&isAnanta){
    const price=list.filter(i=>CUST_ANANTA_UNIT_PRICE.test(i.component||''));
    const rest=list.filter(i=>!CUST_ANANTA_UNIT_PRICE.test(i.component||''));
    rows=(price.length?[{label:'Unit Price (Add On Premium Specification Pack)',amount:sum(price,'amount'),tax:sum(price,'tax_amount'),
        rate:sbu?sum(price,'amount')/sbu:null}]:[])
      .concat(rest.map(i=>({label:i.component,amount:Number(i.amount||0),tax:Number(i.tax_amount||0),rate:itemRate(i)})));
  }else rows=list.map(i=>({label:i.component,amount:Number(i.amount||0),tax:Number(i.tax_amount||0),rate:itemRate(i)}));
  return {showRate:rows.some(r=>r.rate!=null),rows,amount:sum(list,'amount'),tax:sum(list,'tax_amount')};
}
function custFmtRate(r){return r==null?'—':Number(r).toLocaleString('en-IN',{maximumFractionDigits:2});}
async function custTabCostSheet(data,unit){
  const c=data.contactByUnit[unit.id];
  const [{data:costItemRows},{data:invRows},{data:uploadedDocs}]=await Promise.all([
    sb.schema('cust').from('cost_sheet_items').select('*').eq('unit_id',unit.id).eq('is_current',true).order('sort_order'),
    sb.schema('cust').from('invoices').select('document_no,document_date,due_date,invoice_type,invoice_items(schedule,net_amount)').eq('unit_id',unit.id).eq('is_current',true).neq('status',CUST_INVOICE_CANCELLED).order('document_date'),
    sb.schema('cust').from('customer_documents').select('*').eq('unit_id',unit.id).eq('doc_type','cost_sheet').is('deleted_at',null).order('created_at',{ascending:false})
  ]);
  const items=costItemRows||[], invoices=invRows||[], uploaded=uploadedDocs||[];
  if(!items.length&&!uploaded.length)return '<div class="card card-pad empty">Your cost sheet hasn\'t been shared yet.</div>';

  let out='';
  if(items.length){
    // "Cost Summary" card - mirrors the Basic/Extra/Tax breakup and Due/Received/Balance/
    // Future-dues figures a customer would see on Farvision's own Customer Ledger printout, taken
    // from cost_sheet_items alone (no guessed basic/tax split on the actuals - only the static
    // per-component agreement figures carry that split reliably).
    const unitCostItem=items.find(i=>/unit cost/i.test(i.component||''));
    const basicCost=Number(unitCostItem?.amount||0);
    // The standard, recurring per-unit charge types that make up every Dream project's cost
    // sheet (verified against Farvision's own "Cost breakup" printout). Anything outside this
    // set - e.g. a one-off "Cheque Dishonoured Charges" penalty - is a later ad-hoc charge, not
    // part of the original agreement cost, and Farvision itself reports it as a separate figure.
    const STANDARD_COMPONENTS=/legal documentation|advance maintenance|maintenance deposit|generator charges|flc charges|plc charge|vehicle parking|club membership|infrastructure for club facility|infrastructure for electricity|electricity charges|association formation charges/i;
    const extraCharges=items.reduce((s,i)=>s+(i===unitCostItem||!STANDARD_COMPONENTS.test(i.component||'')?0:Number(i.amount||0)),0);
    const adhocCharges=items.reduce((s,i)=>s+(i===unitCostItem||STANDARD_COMPONENTS.test(i.component||'')?0:Number(i.amount||0)),0);
    const totalTax=items.reduce((s,i)=>s+Number(i.tax_amount||0),0);
    const totalWithoutTax=basicCost+extraCharges+adhocCharges;
    const totalWithTax=totalWithoutTax+totalTax;
    /* Every figure on this card is Farvision's own, per component, rather than our sums of
       money_receipts and receipt_reversals. bill_amount - received_amount = balance_amount holds on
       all 1,180 current rows, so this card now agrees with the Statement by construction instead of
       offering a third answer to what the customer owes. */
    const totalBilled=items.reduce((s,i)=>s+Number(i.bill_amount||0),0);
    const onAccount=items.reduce((s,i)=>s+Number(i.onaccount_amount||0),0);
    const netReceived=items.reduce((s,i)=>s+Number(i.received_amount||0),0);
    const balance=items.reduce((s,i)=>s+Number(i.balance_amount||0),0);
    const futureDue=Math.max(0,totalWithTax-netReceived);
    const duePct=totalWithTax?Math.round(totalBilled/totalWithTax*1000)/10:0;
    const recdPct=totalWithTax?Math.round(netReceived/totalWithTax*1000)/10:0;
    const balLabel=balance>0?'<span style="color:#e08600">'+custInr(balance)+' due</span>':balance<0?'<span style="color:#16855a">'+custInr(Math.abs(balance))+' advance</span>':'<span style="color:#16855a">0.00</span>';
    const stat=(label,val,sub,color)=>'<div><div style="font-size:11px;color:var(--slate);text-transform:uppercase;letter-spacing:.03em">'+label+'</div>'+
      '<div style="font-size:19px;font-weight:700;margin-top:3px'+(color?';color:'+color:'')+'">'+val+'</div>'+
      (sub?'<div style="font-size:11.5px;color:var(--slate);margin-top:1px">'+sub+'</div>':'')+'</div>';
    const costSummary='<div class="card card-pad" style="margin-bottom:18px;background:#f8fafc">'+
      '<div class="sec-title" style="margin:0 0 14px">Cost Summary</div>'+
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px;margin-bottom:16px">'+
        stat('Due as on '+fmtDate(new Date()),custInr(totalBilled),duePct+'% of agreement value')+
        stat('Received till '+fmtDate(new Date()),custInr(netReceived),recdPct+'%'+(onAccount?' · '+custInr(onAccount)+' on account':''),'#16855a')+
        stat('Balance',balLabel,'')+
        stat('Total due (incl. future bills)',custInr(futureDue),'against full agreement value')+
      '</div>'+
      '<div style="border-top:1px solid #e2e8f0;padding-top:12px;font-size:13px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">'+
        '<span><b>Basic Cost:</b> '+custInr(basicCost)+'</span><span style="color:var(--slate)">+</span>'+
        '<span><b>Extra Charges:</b> '+custInr(extraCharges)+'</span><span style="color:var(--slate)">+</span>'+
        (adhocCharges?'<span><b>Contracted Extra Charges:</b> '+custInr(adhocCharges)+'</span><span style="color:var(--slate)">+</span>':'')+
        '<span><b>Taxes:</b> '+custInr(totalTax)+'</span><span style="color:var(--slate)">=</span>'+
        '<span><b>Total (excl. tax):</b> '+custInr(totalWithoutTax)+'</span>'+
        '<span style="margin-left:auto"><b>Total (incl. tax):</b> '+custInr(totalWithTax)+'</span>'+
      '</div></div>';
    /* Same gate as the Statement. Without this a withheld customer could read their Due/Received/
       Balance here instead - the Cost Breakup below stays either way, being the agreement's own
       cost estimate rather than a payment position. */
    const gate=await custReconGate(unit.id);
    out+=gate.ok?costSummary:CUST_FIGURES_NOTICE;

    // Cost Breakup below shows the agreement's cost estimate itself (Amount/GST/Gross per
    // charge, grouped like Farvision's own "Estimated Offer Price" sheet into Unit Charges vs
    // Extra Development Charges) - not payment status, which already lives in the Cost Summary
    // card above (Billed/Received/Balance).
    const UNIT_GROUP=/^unit cost$|flc charges|plc charge|vehicle parking/i;
    const unitGroupItems=items.filter(i=>UNIT_GROUP.test(i.component||''));
    const edcGroupItems=items.filter(i=>!UNIT_GROUP.test(i.component||'')&&STANDARD_COMPONENTS.test(i.component||''));
    const adhocGroupItems=items.filter(i=>!UNIT_GROUP.test(i.component||'')&&!STANDARD_COMPONENTS.test(i.component||''));
    // One table per group; the Rate column appears only where some row has a rate (custCostRows).
    const breakupTable=(list,isUnitGroup,totalLabel)=>{
      const g=custCostRows(unit,list,isUnitGroup), rc=g.showRate;
      const cells=(r)=>{const gstPct=r.amount?Math.round(r.tax/r.amount*1000)/10:0;
        return [esc(r.label)].concat(rc?[custFmtRate(r.rate)]:[]).concat([custInr(r.amount),gstPct+'%',custInr(r.tax),custInr(r.amount+r.tax)]);};
      return mTable(['Particulars'].concat(rc?['Rate']:[]).concat(['Amount','GST','GST Amount','Gross Amount']),
        g.rows.map(cells).concat([['<b>'+totalLabel+'</b>'].concat(rc?['']:[]).concat(['<b>'+custInr(g.amount)+'</b>','','<b>'+custInr(g.tax)+'</b>','<b>'+custInr(g.amount+g.tax)+'</b>'])]));
    };
    const groupTitle=t=>'<div style="font-size:12px;font-weight:700;color:var(--slate);text-transform:uppercase;letter-spacing:.03em;margin:16px 0 6px">'+t+'</div>';
    window._custCostSheetUnit=unit; window._custCostSheetContact=c; window._custCostSheetItems=items;
    out+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div class="sec-title" style="margin:0">Cost Breakup</div>'+
      '<button class="btn" onclick="custPrintCostSheet()"><i class="fa-solid fa-print"></i> Print / Download PDF</button></div>';
    if(unitGroupItems.length) out+=groupTitle('Unit Charges')+breakupTable(unitGroupItems,true,'Total Flat Value');
    if(edcGroupItems.length) out+=groupTitle('Extra Development Charges (EDC)')+breakupTable(edcGroupItems,false,'Total EDC');
    if(adhocGroupItems.length) out+=groupTitle('Contracted Extra Charges')+breakupTable(adhocGroupItems,false,'Total Contracted Extra Charges');
    out+='<div style="margin-top:8px;padding-top:10px;border-top:2px solid #334155;text-align:right;font-size:14.5px"><b>Grand Total: '+custInr(totalWithTax)+'</b></div>';
  }
  if(invoices.length){
    const schedRows=[];
    invoices.forEach(inv=>{
      const lineItems=inv.invoice_items||[];
      if(!lineItems.length) return;
      const bySchedule={};
      lineItems.forEach(li=>{const s=li.schedule||'—';bySchedule[s]=(bySchedule[s]||0)+Number(li.net_amount||0);});
      Object.keys(bySchedule).forEach(s=>{schedRows.push([fmtDate(inv.document_date),esc(s),custInr(bySchedule[s]),fmtDate(inv.due_date),'<span class="tag t-green">Raised</span>']);});
    });
    out+='<div class="sec-title" style="margin:22px 0 8px">Payment Schedule</div>'+
      mTable(['Invoice date','Milestone','Amount','Due date','Status'],schedRows);
  }
  if(uploaded.length){
    const docRows=uploaded.map(d=>[fileIcon(d.file_type||'')+' '+esc(d.title||d.file_name||'Cost Sheet'),fmtDate(d.created_at),
      `<button class="btn btn-sm btn-primary" onclick="s3OpenSigned('${d.storage_path.replace(/'/g,"\\'")}','${(d.file_name||'cost-sheet').replace(/'/g,"\\'")}')"><i class="fa-solid fa-download"></i> Download</button>`]);
    out+='<div class="sec-title" style="margin:22px 0 8px">Signed document'+(uploaded.length>1?'s':'')+'</div>'+cpaTable(['Document','Shared on','Download'],docRows);
  }
  return out;
}
window.custPrintCostSheet=function(){
  const unit=window._custCostSheetUnit,c=window._custCostSheetContact,items=window._custCostSheetItems;
  if(!unit||!items){toast('Nothing to print yet','err');return;}
  const w=window.open('','_blank');
  if(!w){toast('Please allow popups to print','err');return;}
  const STANDARD_COMPONENTS=/legal documentation|advance maintenance|maintenance deposit|generator charges|flc charges|plc charge|vehicle parking|club membership|infrastructure for club facility|infrastructure for electricity|electricity charges|association formation charges/i;
  const UNIT_GROUP=/^unit cost$|flc charges|plc charge|vehicle parking/i;
  const unitGroupItems=items.filter(i=>UNIT_GROUP.test(i.component||''));
  const edcGroupItems=items.filter(i=>!UNIT_GROUP.test(i.component||'')&&STANDARD_COMPONENTS.test(i.component||''));
  const adhocGroupItems=items.filter(i=>!UNIT_GROUP.test(i.component||'')&&!STANDARD_COMPONENTS.test(i.component||''));
  // Same rows and Rate column as the screen (custCostRows).
  const groupTable=(label,list,totalLabel,isUnitGroup)=>{
    if(!list.length) return '';
    const g=custCostRows(unit,list,isUnitGroup), rc=g.showRate;
    return '<h3>'+label+'</h3><table><thead><tr><th>Particulars</th>'+(rc?'<th>Rate</th>':'')+'<th>Amount</th><th>GST</th><th>GST Amount</th><th>Gross Amount</th></tr></thead><tbody>'+
      g.rows.map(r=>{const p=r.amount?Math.round(r.tax/r.amount*1000)/10:0;
        return '<tr><td>'+esc(r.label)+'</td>'+(rc?'<td>'+custFmtRate(r.rate)+'</td>':'')+'<td>'+custInr(r.amount)+'</td><td>'+p+'%</td><td>'+custInr(r.tax)+'</td><td>'+custInr(r.amount+r.tax)+'</td></tr>';}).join('')+
      '<tr style="font-weight:700"><td>'+totalLabel+'</td>'+(rc?'<td></td>':'')+'<td>'+custInr(g.amount)+'</td><td></td><td>'+custInr(g.tax)+'</td><td>'+custInr(g.amount+g.tax)+'</td></tr></tbody></table>';
  };
  const grandTotal=items.reduce((s,i)=>s+Number(i.amount||0)+Number(i.tax_amount||0),0);
  const html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Cost Sheet — '+esc(unit.unit_code)+'</title><style>'+
    'body{margin:32px;font-family:Inter,system-ui,sans-serif;color:#0f172a}'+
    'h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;color:#64748b;font-weight:500;margin:0 0 20px}'+
    'h3{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.03em;margin:20px 0 4px}'+
    'table{width:100%;border-collapse:collapse;margin-top:4px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12.5px}'+
    'th{color:#64748b;font-weight:600;text-transform:uppercase;font-size:10.5px;letter-spacing:.03em}'+
    '.grand{margin-top:14px;padding-top:10px;border-top:2px solid #334155;text-align:right;font-size:14px;font-weight:700}'+
    '</style></head><body>'+
    '<h1>Cost Sheet — '+esc(unit.unit_code)+(unit.tower?', '+esc(unit.tower):'')+'</h1>'+
    '<h2>'+esc((unit.projects&&unit.projects.name)||'')+' · '+esc((c&&c.contact_name)||'')+(unit.booking_no?' · Booking No '+esc(unit.booking_no):'')+' · as on '+fmtDate(new Date())+'</h2>'+
    groupTable('Unit Charges',unitGroupItems,'Total Flat Value',true)+
    groupTable('Extra Development Charges (EDC)',edcGroupItems,'Total EDC',false)+
    groupTable('Contracted Extra Charges',adhocGroupItems,'Total Contracted Extra Charges',false)+
    '<div class="grand">Grand Total: '+custInr(grandTotal)+'</div>'+
    '</body></html>';
  try{ w.document.open(); w.document.write(html); w.document.close(); }
  catch(_e){ toast('Could not build the printout','err'); return; }
  setTimeout(function(){ try{w.focus();w.print();}catch(_e){} },350);
};
// Shared photo/video grid used by every construction-media level (project, tower, floor, unit)
// and by the inspection-update trail - a card per file, showing a real thumbnail for images and
// a play-icon placeholder for video (signing a video's URL up front isn't needed for the
// thumbnail, only when the customer actually opens it via s3OpenSigned).
async function custMediaGrid(list){
  const urls=await Promise.all(list.map(p=>{const isVideo=(p.file_type||'').indexOf('video')===0;return isVideo?Promise.resolve(null):s3SignedUrl(p.storage_path);}));
  return '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">'+
    list.map((p,i)=>{const isVideo=(p.file_type||'').indexOf('video')===0;const url=urls[i];
      const thumb=url
        ?`<img src="${url}" alt="" style="width:100%;height:110px;object-fit:cover;border-radius:6px;display:block">`
        :`<div style="background:#eef2f7;border-radius:6px;height:110px;display:flex;align-items:center;justify-content:center;color:#94a3b8"><i class="fa-solid ${isVideo?'fa-circle-play':'fa-image'} fa-lg"></i></div>`;
      return `<div class="card" style="padding:8px"><div style="cursor:pointer" onclick="s3OpenSigned('${p.storage_path.replace(/'/g,"\\'")}')">${thumb}</div>
    <div style="font-size:12px;margin-top:6px;font-weight:600">${fmtDate(p.taken_on)}</div>${p.caption?`<div style="font-size:11.5px;color:var(--slate)">${esc(p.caption)}</div>`:''}</div>`;}).join('')+'</div>';
}
/* CONSTRUCTION PROGRESS - what the customer sees: their BLOCK and their FLAT, nothing else.

   Project-wide photos are not shown here any more, by request: a customer's question is "how is
   my building doing, how is my flat doing", and a gallery of the whole site answered neither. The
   floor level went with the Photos & Videos redesign (it was guessed from digits in a unit code
   and never held a photo).

   Layout: a summary card (where, how many, when it was last updated), then the block's updates
   grouped by the date the photos were taken - so it reads as a progress diary, newest first - then
   the flat, filterable by room (Common area / Bathroom / Kitchen) because "is my kitchen done yet"
   is the question people actually ask. Any photo opens full screen with next / previous, arrow
   keys and swipe; a video plays in place.

   Every read filters deleted_at itself. RLS already hides removed rows from a real customer, but
   staff (and Staff preview) pass the staff policy, which returns deleted rows too - so preview used
   to show photos an admin had removed and the customer could not see. */
const CUST_PG_AREAS=[['common','Common area','fa-couch'],['bathroom','Bathroom','fa-bath'],['kitchen','Kitchen','fa-kitchen-set']];
let CUST_PG={items:[],flat:[],room:'all'};
function custPgCss(){return `<style>
  .cpg{display:flex;flex-direction:column;gap:18px;position:relative;z-index:1}
  .cpg-hero{border-radius:16px;padding:20px 22px;color:#fff;position:relative;overflow:hidden;
    background:linear-gradient(135deg,#0f1e3d 0%,#1d4ed8 60%,#3b82f6 100%);box-shadow:0 10px 30px rgba(29,78,216,.22)}
  .cpg-hero::after{content:"";position:absolute;right:-60px;top:-60px;width:220px;height:220px;border-radius:50%;
    background:radial-gradient(circle,rgba(255,255,255,.18),transparent 70%);pointer-events:none}
  .cpg-hero h2{font-size:20px;font-weight:700;margin:0 0 4px;letter-spacing:-.2px}
  .cpg-hero .sub{font-size:13.5px;opacity:.85}
  .cpg-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
  .cpg-chip{display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);
    padding:6px 12px;border-radius:999px;font-size:12.5px;font-weight:600}
  .cpg-sec{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px 20px;box-shadow:var(--shadow)}
  .cpg-sh{display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap}
  .cpg-ic{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;
    background:var(--brand-50);color:var(--brand);font-size:17px;flex:none}
  .cpg-st{font-size:16px;font-weight:700;color:var(--ink);line-height:1.2}
  .cpg-ss{font-size:12.5px;color:var(--slate);margin-top:2px}
  .cpg-count{margin-left:auto;font-size:12px;font-weight:700;color:var(--brand);background:var(--brand-50);
    padding:4px 11px;border-radius:999px;white-space:nowrap}
  .cpg-day{display:flex;align-items:center;gap:10px;margin:18px 0 10px;font-size:12.5px;font-weight:700;color:var(--ink)}
  .cpg-body>.cpg-day:first-child{margin-top:2px}
  .cpg-day .dot{width:9px;height:9px;border-radius:50%;background:var(--brand);box-shadow:0 0 0 4px var(--brand-50);flex:none}
  .cpg-day .n{font-weight:500;color:var(--slate)}
  .cpg-day::after{content:"";flex:1;height:1px;background:var(--line-2)}
  .cpg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}
  .cpg-tile{position:relative;aspect-ratio:4/3;border-radius:12px;overflow:hidden;cursor:pointer;background:#e9eef6;
    border:0;padding:0;display:block;width:100%;box-shadow:0 1px 3px rgba(16,24,40,.08);transition:transform .15s,box-shadow .15s}
  .cpg-tile:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(16,24,40,.16)}
  .cpg-tile:focus-visible{outline:3px solid var(--brand);outline-offset:2px}
  .cpg-tile img,.cpg-tile video{width:100%;height:100%;object-fit:cover;display:block;transition:transform .35s}
  .cpg-tile:hover img,.cpg-tile:hover video{transform:scale(1.05)}
  .cpg-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:22px}
  .cpg-play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
  .cpg-play span{width:46px;height:46px;border-radius:50%;background:rgba(15,23,42,.62);color:#fff;display:flex;
    align-items:center;justify-content:center;font-size:16px;padding-left:3px}
  .cpg-tag{position:absolute;left:8px;bottom:8px;font-size:11px;font-weight:600;color:#fff;background:rgba(15,23,42,.62);
    padding:3px 9px;border-radius:999px}
  .cpg-rooms{display:flex;gap:6px;flex-wrap:wrap;background:#f1f5f9;padding:4px;border-radius:12px;margin-bottom:6px;width:fit-content;max-width:100%}
  .cpg-room{display:inline-flex;align-items:center;gap:7px;border:0;background:transparent;border-radius:9px;padding:8px 14px;
    font:600 13px Inter,system-ui,sans-serif;color:var(--slate);cursor:pointer;transition:.12s}
  .cpg-room .n{font-size:11px;background:#e2e8f0;color:var(--slate);border-radius:999px;padding:1px 7px}
  .cpg-room:hover{color:var(--ink)}
  .cpg-room.on{background:#fff;color:var(--brand);box-shadow:0 1px 3px rgba(15,23,42,.12)}
  .cpg-room.on .n{background:var(--brand-50);color:var(--brand)}
  .cpg-empty{text-align:center;padding:28px 16px;border:1.5px dashed var(--line);border-radius:14px;background:#fafbfd}
  .cpg-empty i{font-size:26px;color:#cbd5e1;margin-bottom:10px;display:block}
  .cpg-empty b{display:block;font-size:14px;color:var(--ink);margin-bottom:4px}
  .cpg-empty span{font-size:12.5px;color:var(--slate)}
  /* full-screen viewer */
  .cpg-lb{position:fixed;inset:0;z-index:9500;background:rgba(6,10,20,.98);display:flex;flex-direction:column}
  .cpg-lbbar{display:flex;align-items:center;gap:12px;padding:14px 18px;color:#e5e7eb;font-size:13.5px}
  .cpg-lbbar .t{font-weight:600;color:#fff}
  .cpg-lbbar .c{margin-left:auto;opacity:.75;white-space:nowrap}
  .cpg-lbx{border:0;background:rgba(255,255,255,.12);color:#fff;width:38px;height:38px;border-radius:10px;cursor:pointer;font-size:18px;flex:none}
  .cpg-lbx:hover{background:rgba(255,255,255,.24)}
  .cpg-lbstage{flex:1;display:flex;align-items:center;justify-content:center;position:relative;min-height:0;padding:0 64px 24px}
  .cpg-lbstage img,.cpg-lbstage video{max-width:100%;max-height:100%;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.5);background:#000}
  .cpg-lbnav{position:absolute;top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:50%;border:0;cursor:pointer;
    background:rgba(255,255,255,.14);color:#fff;font-size:17px}
  .cpg-lbnav:hover{background:rgba(255,255,255,.28)}
  .cpg-lbnav.prev{left:10px}.cpg-lbnav.next{right:10px}
  @media(max-width:760px){
    .cpg-hero{padding:18px}.cpg-hero h2{font-size:18px}
    .cpg-sec{padding:14px}
    .cpg-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .cpg-tile{border-radius:10px}
    .cpg-rooms{width:100%}.cpg-room{flex:1;justify-content:center;padding:9px 6px;font-size:12.5px}
    .cpg-count{margin-left:0}
    .cpg-lbstage{padding:0 0 84px}
    .cpg-lbnav{top:auto;bottom:22px;transform:none}
    .cpg-lbnav.prev{left:calc(50% - 58px)}.cpg-lbnav.next{right:calc(50% - 58px)}
  }
</style>`;}

// One tile. `i` indexes CUST_PG.items, which is what the viewer walks through.
function custPgTile(it,i,showRoom){
  const media=it.url
    ?(it.isVideo?'<video src="'+it.url+'#t=0.5" muted playsinline preload="metadata"></video>':'<img src="'+it.url+'" alt="" loading="lazy">')
    :'<div class="cpg-ph"><i class="fa-solid '+(it.isVideo?'fa-film':'fa-image')+'"></i></div>';
  return '<button type="button" class="cpg-tile" onclick="custPgOpen('+i+')" aria-label="Open '+esc(it.label)+' '+(it.isVideo?'video':'photo')+' of '+esc(fmtDate(it.date))+'">'
    +media+(it.isVideo?'<div class="cpg-play"><span><i class="fa-solid fa-play"></i></span></div>':'')
    +(showRoom&&it.room?'<span class="cpg-tag">'+esc(it.room)+'</span>':'')+'</button>';
}
// Newest day first, one heading per day - reads as a progress diary.
function custPgByDay(idxs,showRoom){
  const days={},order=[];
  idxs.forEach(i=>{const d=CUST_PG.items[i].date||'';if(!(d in days)){days[d]=[];order.push(d);}days[d].push(i);});
  return '<div class="cpg-body">'+order.map(d=>{const l=days[d],v=l.filter(i=>CUST_PG.items[i].isVideo).length,ph=l.length-v;
    const n=[ph?ph+' photo'+(ph===1?'':'s'):'',v?v+' video'+(v===1?'':'s'):''].filter(Boolean).join(' · ');
    return '<div class="cpg-day"><span class="dot"></span>'+esc(d?fmtDate(d):'Undated')+' <span class="n">'+n+'</span></div>'
      +'<div class="cpg-grid">'+l.map(i=>custPgTile(CUST_PG.items[i],i,showRoom)).join('')+'</div>';}).join('')+'</div>';
}
function custPgEmpty(icon,title,text){return '<div class="cpg-empty"><i class="fa-solid '+icon+'"></i><b>'+esc(title)+'</b><span>'+esc(text)+'</span></div>';}
function custPgFlatIdx(){
  return CUST_PG.room==='all'?CUST_PG.flat:CUST_PG.flat.filter(i=>CUST_PG.items[i].roomKey===CUST_PG.room);
}
function custPgFlatBody(){
  const idxs=custPgFlatIdx();
  return idxs.length?custPgByDay(idxs,CUST_PG.room==='all'):custPgEmpty('fa-camera','Nothing here yet','Photos of this room will appear as soon as they are taken.');
}
window.custPgRoom=function(k){
  CUST_PG.room=k;
  document.querySelectorAll('.cpg-room').forEach(b=>b.classList.toggle('on',b.getAttribute('data-k')===k));
  const host=$('cpgFlatBody'); if(host) host.innerHTML=custPgFlatBody();
};

async function custTabProgress(unit){
  /* Flat photos have their own Customer Features switch ('flat_photos'). The customer read policy
     already returns none when it is off; checking here as well keeps a staff preview - which reads
     through the staff policy - showing exactly what the customer sees. */
  const flatOn=custFeatureOn(CUST_DATA&&CUST_DATA.featureRules,'flat_photos',unit.project_id,unit.tower);
  const [{data:tPhotos},{data:uPhotos}]=await Promise.all([
    // Published only: customers' RLS already says so; the filter keeps a staff preview the same.
    unit.tower?sb.schema('cust').from('tower_photos').select('*').eq('project_id',unit.project_id).eq('tower',unit.tower).eq('status','published').is('deleted_at',null).order('taken_on',{ascending:false}).order('created_at',{ascending:false}):Promise.resolve({data:[]}),
    flatOn?sb.schema('cust').from('unit_photos').select('*').eq('unit_id',unit.id).eq('status','published').is('deleted_at',null).order('taken_on',{ascending:false}).order('created_at',{ascending:false}):Promise.resolve({data:[]})
  ]);
  const block=tPhotos||[], flat=uPhotos||[];
  const roomOf=k=>(CUST_PG_AREAS.find(a=>a[0]===k)||CUST_PG_AREAS[0]);
  const raw=block.map(p=>({p,label:'Block',roomKey:null,room:null}))
    .concat(flat.map(p=>{const r=roomOf(p.area||'common');return {p,label:r[1],roomKey:r[0],room:r[1]};}));
  const urls=await Promise.all(raw.map(r=>s3SignedUrl(r.p.storage_path).catch(()=>null)));
  CUST_PG.items=raw.map((r,i)=>({url:urls[i],isVideo:(r.p.file_type||'').indexOf('video')===0,
    date:r.p.taken_on,label:r.label,roomKey:r.roomKey,room:r.room,where:r.roomKey?'Your flat':'Your block'}));
  CUST_PG.flat=CUST_PG.items.map((it,i)=>it.roomKey?i:-1).filter(i=>i>=0);
  CUST_PG.room='all';
  const blockIdx=CUST_PG.items.map((it,i)=>it.roomKey?-1:i).filter(i=>i>=0);

  const total=CUST_PG.items.length, vids=CUST_PG.items.filter(i=>i.isVideo).length, pics=total-vids;
  const latest=CUST_PG.items.reduce((m,i)=>i.date&&(!m||i.date>m)?i.date:m,null);
  const projName=(unit.projects&&unit.projects.name)||'';
  const where=[unit.tower,unit.unit_code?'Flat '+unit.unit_code:''].filter(Boolean).join(' · ');
  const upd=n=>n+' update'+(n===1?'':'s');

  let out=custPgCss()+'<div class="cpg">';
  out+='<div class="cpg-hero"><h2>Construction progress</h2><div class="sub">'+esc(projName)+(where?' — '+esc(where):'')+'</div>'
    +'<div class="cpg-chips">'
      +'<span class="cpg-chip"><i class="fa-solid fa-clock-rotate-left"></i>'+(latest?'Last update '+esc(fmtDate(latest)):'Updates coming soon')+'</span>'
      +(total?'<span class="cpg-chip"><i class="fa-solid fa-images"></i>'+[pics?pics+' photo'+(pics===1?'':'s'):'',vids?vids+' video'+(vids===1?'':'s'):''].filter(Boolean).join(' · ')+'</span>':'')
    +'</div></div>';

  /* Set expectations before anyone opens a photo: these are working site pictures, taken by the site
     team on a phone amid dust, poor light and scaffolding - some are not sharp - and they show work in
     progress, not the finished flat. Asked for on 5 Oct 2026, once flat photos began to be published. */
  if(total) out+='<div style="display:flex;gap:12px;align-items:flex-start;margin:0 0 18px;padding:14px 16px;border-radius:12px;'
    +'background:#fffbeb;border:1px solid #f0dfa8;color:#78350f;font-size:13.5px;line-height:1.6">'
    +'<i class="fa-solid fa-circle-info" style="color:#d97706;font-size:17px;margin-top:2px"></i>'
    +'<div><b style="color:#92400e">About these photos</b><br>'
    +'These photos and videos are taken on site by our construction team while work is going on. Because of dust, '
    +'lighting and site conditions, some may look unclear or slightly blurred. They show work in progress, not the '
    +'finished home — colours, finishes and fittings may look different at handover. If you have any question about '
    +'your flat, please contact your relationship manager.</div></div>';

  // A section with nothing in it is not shown at all - no "No photos yet" boxes. Only when there is
  // nothing anywhere does the customer get one short line, so the tab is never blank.
  if(blockIdx.length) out+='<div class="cpg-sec"><div class="cpg-sh"><div class="cpg-ic"><i class="fa-solid fa-building"></i></div>'
    +'<div><div class="cpg-st">Your block'+(unit.tower?' — '+esc(unit.tower):'')+'</div><div class="cpg-ss">How your building is coming along</div></div>'
    +'<span class="cpg-count">'+upd(blockIdx.length)+'</span></div>'
    +custPgByDay(blockIdx,false)+'</div>';

  if(CUST_PG.flat.length){
    const counts={}; CUST_PG.flat.forEach(i=>{const k=CUST_PG.items[i].roomKey;counts[k]=(counts[k]||0)+1;});
    const rooms=CUST_PG_AREAS.filter(a=>counts[a[0]]);
    out+='<div class="cpg-sec"><div class="cpg-sh"><div class="cpg-ic"><i class="fa-solid fa-door-open"></i></div>'
      +'<div><div class="cpg-st">Your flat'+(unit.unit_code?' — '+esc(unit.unit_code):'')+'</div><div class="cpg-ss">Room by room, as it is built</div></div>'
      +'<span class="cpg-count">'+upd(CUST_PG.flat.length)+'</span></div>';
    // Only rooms that have something get a button, and the row only appears when there is a choice.
    if(rooms.length>1) out+='<div class="cpg-rooms"><button type="button" class="cpg-room on" data-k="all" onclick="custPgRoom(\'all\')">All <span class="n">'+CUST_PG.flat.length+'</span></button>'
      +rooms.map(a=>'<button type="button" class="cpg-room" data-k="'+a[0]+'" onclick="custPgRoom(\''+a[0]+'\')"><i class="fa-solid '+a[2]+'"></i>'+esc(a[1])+' <span class="n">'+counts[a[0]]+'</span></button>').join('')+'</div>';
    out+='<div id="cpgFlatBody">'+custPgFlatBody()+'</div></div>';
  }

  if(!total) out+='<div class="cpg-sec">'+custPgEmpty('fa-helmet-safety','Photos are on their way','Our site team will share photos of your block and your flat here as construction progresses.')+'</div>';
  out+='</div>';
  return out;
}

/* Full-screen viewer: next / previous, arrow keys, swipe, Esc. It walks only the section the tile
   came from (the block, or the flat under the current room filter), so "next" never jumps from the
   kitchen to the building's facade. */
window.custPgOpen=function(start){
  const it0=CUST_PG.items[start]; if(!it0) return;
  const list=it0.roomKey?custPgFlatIdx():CUST_PG.items.map((it,i)=>it.roomKey?-1:i).filter(i=>i>=0);
  let pos=Math.max(0,list.indexOf(start));
  const box=document.createElement('div'); box.className='cpg-lb';
  const go=function(d){ if(list.length<2) return; pos=(pos+d+list.length)%list.length; draw(); };
  const onKey=function(e){ if(e.key==='Escape') shut(); else if(e.key==='ArrowRight') go(1); else if(e.key==='ArrowLeft') go(-1); };
  function shut(){ document.removeEventListener('keydown',onKey); if(box.parentNode) box.parentNode.removeChild(box); document.body.style.overflow=''; }
  function draw(){
    const it=CUST_PG.items[list[pos]];
    box.innerHTML='<div class="cpg-lbbar"><span class="t">'+esc(it.where)+(it.room?' · '+esc(it.room):'')+'</span><span>'+esc(fmtDate(it.date))+'</span>'
      +'<span class="c">'+(pos+1)+' / '+list.length+'</span><button class="cpg-lbx" title="Close">&times;</button></div>'
      +'<div class="cpg-lbstage">'
        +(it.url?(it.isVideo?'<video src="'+it.url+'" controls autoplay playsinline></video>':'<img src="'+it.url+'" alt="">'):'<div style="color:#94a3b8">This file could not be loaded.</div>')
        +(list.length>1?'<button class="cpg-lbnav prev" title="Previous"><i class="fa-solid fa-chevron-left"></i></button><button class="cpg-lbnav next" title="Next"><i class="fa-solid fa-chevron-right"></i></button>':'')
      +'</div>';
    box.querySelector('.cpg-lbx').onclick=shut;
    const pv=box.querySelector('.prev'), nx=box.querySelector('.next');
    if(pv) pv.onclick=function(e){e.stopPropagation();go(-1);};
    if(nx) nx.onclick=function(e){e.stopPropagation();go(1);};
  }
  box.onclick=function(e){ if(e.target===box||e.target.classList.contains('cpg-lbstage')) shut(); };
  let sx=null;
  box.addEventListener('touchstart',function(e){ sx=e.touches[0].clientX; },{passive:true});
  box.addEventListener('touchend',function(e){ if(sx==null) return; const dx=e.changedTouches[0].clientX-sx; sx=null; if(Math.abs(dx)>50) go(dx<0?1:-1); });
  document.addEventListener('keydown',onKey);
  document.body.style.overflow='hidden';
  draw(); document.body.appendChild(box);
};
async function custTabDocuments(unit){
  const [{data:pDocs},{data:cDocs}]=await Promise.all([
    sb.schema('cust').from('project_documents').select('*').eq('project_id',unit.project_id).is('deleted_at',null),
    sb.schema('cust').from('customer_documents').select('*').eq('unit_id',unit.id).is('deleted_at',null)
  ]);
  const docRow=d=>[fileIcon(d.file_type||'')+' '+esc(d.title||d.file_name||'Document'),fmtDate(d.created_at),
    `<button class="btn btn-sm btn-primary" onclick="s3OpenSigned('${d.storage_path.replace(/'/g,"\\'")}','${(d.file_name||'download').replace(/'/g,"\\'")}')"><i class="fa-solid fa-download"></i> Download</button>`];
  const pRows=(pDocs||[]).map(docRow),cRows=(cDocs||[]).map(docRow);
  return '<div class="sec-title" style="margin:0 0 10px">Project documents</div>'+
    (pRows.length?cpaTable(['Document','Shared on','Download'],pRows):'<div class="card card-pad empty">No project documents shared yet.</div>')+
    '<div class="sec-title" style="margin:20px 0 10px">My documents</div>'+
    (cRows.length?cpaTable(['Document','Shared on','Download'],cRows):'<div class="card card-pad empty">No personal documents shared yet.</div>');
}
async function custTabInspection(unit){
  const [{data:checklist},{data:updates}]=await Promise.all([
    sb.schema('cust').from('inspection_checklists').select('*').eq('unit_id',unit.id).maybeSingle(),
    sb.schema('cust').from('inspection_updates').select('*').eq('unit_id',unit.id).is('deleted_at',null).order('taken_on',{ascending:false})
  ]);
  const checklistSection='<div class="sec-title" style="margin:0 0 10px">Inspection checklist</div>'+
    (checklist?
      `<div class="card card-pad" style="display:flex;justify-content:space-between;align-items:center">${fileIcon(checklist.file_type||'')} ${esc(checklist.file_name||'Inspection checklist')}<button class="btn btn-sm btn-primary" onclick="s3OpenSigned('${checklist.storage_path.replace(/'/g,"\\'")}','${(checklist.file_name||'checklist').replace(/'/g,"\\'")}')"><i class="fa-solid fa-download"></i> Download</button></div>`:
      '<div class="card card-pad empty">Your inspection checklist hasn\u2019t been uploaded yet.</div>');
  const updatesSection='<div class="sec-title" style="margin:20px 0 10px">Updates against the checklist</div>'+
    ((updates&&updates.length)?await custMediaGrid(updates):'<div class="card card-pad empty">No updates yet — photo or video updates against your checklist will appear here.</div>');
  return checklistSection+updatesSection;
}
async function custTabVideos(){
  const {data}=await sb.schema('cust').from('process_videos').select('*').is('deleted_at',null).order('category').order('created_at',{ascending:false});
  const byCat={};(data||[]).forEach(v=>{(byCat[v.category]=byCat[v.category]||[]).push(v);});
  return Object.keys(CPA_VIDEO_CATEGORIES).map(cat=>{
    const vids=byCat[cat]||[];
    return '<div class="sec-title" style="margin:0 0 10px">'+esc(CPA_VIDEO_CATEGORIES[cat])+'</div>'+
      (vids.length?cpaTable(['Video','Added','Watch'],vids.map(v=>[esc(v.title||v.file_name||'Video'),fmtDate(v.created_at),
        `<button class="btn btn-sm btn-primary" onclick="s3OpenSigned('${v.storage_path.replace(/'/g,"\\'")}')"><i class="fa-solid fa-circle-play"></i> Watch</button>`]))
      :'<div class="card card-pad empty">Not available yet.</div>')+'<div style="margin-bottom:20px"></div>';
  }).join('');
}
async function custTabSupport(unit){
  const {data:tickets}=await sb.schema('cust').from('support_tickets').select('*').eq('unit_id',unit.id).order('created_at',{ascending:false});
  const ticketIds=(tickets||[]).map(t=>t.id);
  const {data:atts}=ticketIds.length?await sb.schema('cust').from('support_ticket_attachments').select('*').in('ticket_id',ticketIds).is('deleted_at',null):{data:[]};
  const attsByTicket={};(atts||[]).forEach(a=>{(attsByTicket[a.ticket_id]=attsByTicket[a.ticket_id]||[]).push(a);});
  const rows=(tickets||[]).map(t=>[esc(t.subject),fmtDate(t.created_at),esc(t.zoho_ticket_number||'—'),supportStatusTag(t),
    (attsByTicket[t.id]||[]).map(a=>`<button class="btn btn-sm" onclick="s3OpenSigned('${a.storage_path.replace(/'/g,"\\'")}','${esc(a.file_name||'file').replace(/'/g,"\\'")}')" title="${esc(a.file_name||'')}"><i class="fa-solid fa-paperclip"></i></button>`).join(' ')||'—',
    (t.zoho_ticket_id?`<button class="btn btn-sm" onclick="custTicketDetail(${t.id})"><i class="fa-solid fa-comments"></i> Conversation</button> <button class="btn btn-sm" onclick="custSyncTicket(${t.id})"><i class="fa-solid fa-rotate"></i> Refresh</button>`:`<button class="btn btn-sm" onclick="custRetryTicket(${t.id})"><i class="fa-solid fa-rotate-right"></i> Retry</button>`)]);
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div class="sec-title" style="margin:0">Support tickets</div><button class="btn btn-primary" onclick="custNewTicketModal()"><i class="fa-solid fa-plus"></i> Raise a ticket</button></div>`+
    (rows.length?cpaTable(['Subject','Raised','Ticket #','Status','Attachments','Actions'],rows):'<div class="card card-pad empty">No support tickets yet.</div>');
}
function custBuildBubbles(t,threads,comments){
  const msgs=[{time:t.created_at,mine:true,author:'You',content:t.description||t.subject}]
    .concat((threads||[]).map(m=>({time:m.zoho_created_time||m.created_at,mine:m.direction!=='out',author:m.direction==='out'?'Support team':'You',content:m.content})))
    .concat((comments||[]).map(m=>({time:m.zoho_commented_time||m.created_at,mine:m.posted_by_customer,author:m.posted_by_customer?'You':'Support team',content:m.content})));
  msgs.sort((a,b)=>new Date(a.time||0)-new Date(b.time||0));
  return msgs.map(m=>`<div style="margin-bottom:10px;display:flex;flex-direction:column;align-items:${m.mine?'flex-end':'flex-start'}"><div style="font-size:11.5px;color:var(--slate);margin-bottom:2px">${esc(m.author)} · ${fmtDate(m.time)}</div><div class="card card-pad" style="white-space:pre-wrap;font-size:13.5px;max-width:85%;background:${m.mine?'var(--brand-50)':'#fff'}">${esc(m.content||'')}</div></div>`).join('')||'<div class="card card-pad empty">No messages yet.</div>';
}
// While this modal is open, silently re-syncs from Zoho every 20s so a customer sees a new agent
// reply without needing to click Refresh - the customer typed their own reply into cust.support_
// ticket_comments already via 'reply', so the only thing a tick can surface that they don't already
// have is something Zoho-side (an agent's reply, or a status change). Paused when the tab is hidden
// so a background tab doesn't keep burning Zoho API calls, and self-stops the moment the container
// it writes into is gone (modal closed, or replaced by a different one).
let CUST_TICKET_POLL_TIMER=null;
window.custTicketDetail=async function(id){
  openModal('<div class="loader"><div class="spin"></div></div>');
  const {data:t}=await sb.schema('cust').from('support_tickets').select('*').eq('id',id).maybeSingle();
  const [{data:threads},{data:comments}]=await Promise.all([
    sb.schema('cust').from('support_ticket_threads').select('*').eq('ticket_id',id),
    sb.schema('cust').from('support_ticket_comments').select('*').eq('ticket_id',id)
  ]);
  openModal(`<div class="modal-head"><h3>${esc(t.subject)}</h3><span class="x" onclick="custTicketDetailClose()">&times;</span></div>
    <div class="modal-body frm">
    <div id="custMsgsContainer" style="max-height:340px;overflow-y:auto;padding-right:4px">${custBuildBubbles(t,threads,comments)}</div>
    <label>Reply</label><textarea id="custReplyMsg" placeholder="Type your reply…"></textarea></div>
    <div class="modal-foot"><button class="btn" onclick="custTicketDetailClose()">Close</button><button class="btn btn-primary" id="custReplyBtn" onclick="custSendReply(${id})">Send</button></div>`,'lg');
  if(CUST_TICKET_POLL_TIMER)clearInterval(CUST_TICKET_POLL_TIMER);
  CUST_TICKET_POLL_TIMER=setInterval(()=>custTicketPollTick(id),20000);
};
window.custTicketDetailClose=function(){
  if(CUST_TICKET_POLL_TIMER){clearInterval(CUST_TICKET_POLL_TIMER);CUST_TICKET_POLL_TIMER=null;}
  closeModal();
};
async function custTicketPollTick(id){
  const container=$('custMsgsContainer');
  if(!container){if(CUST_TICKET_POLL_TIMER){clearInterval(CUST_TICKET_POLL_TIMER);CUST_TICKET_POLL_TIMER=null;}return;}
  if(document.hidden)return;
  try{
    const {data:{session}}=await sb.auth.getSession();const token=session&&session.access_token;
    await fetch(SUPABASE_URL+'/functions/v1/zoho-desk',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({action:'sync',ticketId:id})});
  }catch(e){/* silent - next tick retries */}
  const stillThere=$('custMsgsContainer');if(!stillThere)return;
  const [{data:t},{data:threads},{data:comments}]=await Promise.all([
    sb.schema('cust').from('support_tickets').select('*').eq('id',id).maybeSingle(),
    sb.schema('cust').from('support_ticket_threads').select('*').eq('ticket_id',id),
    sb.schema('cust').from('support_ticket_comments').select('*').eq('ticket_id',id)
  ]);
  const container2=$('custMsgsContainer');
  if(container2&&t)container2.innerHTML=custBuildBubbles(t,threads,comments);
}
window.custSendReply=async function(id){
  const message=$('custReplyMsg').value.trim();
  if(!message){toast('Type a message first','err');return;}
  const btn=$('custReplyBtn');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Sending…';
  try{
    const {data:{session}}=await sb.auth.getSession();const token=session&&session.access_token;
    const res=await fetch(SUPABASE_URL+'/functions/v1/zoho-desk',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({action:'reply',ticketId:id,message})});
    const out=await res.json().catch(()=>({}));
    if(!res.ok||out.error){toast('Could not send: '+(out.error||res.status),'err');btn.disabled=false;btn.innerHTML='Send';return;}
    toast('Reply sent','ok');
    custTicketDetail(id);
  }catch(e){toast('Could not send: '+e.message,'err');btn.disabled=false;btn.innerHTML='Send';}
};
window.custNewTicketModal=function(){
  openModal(`<div class="modal-head"><h3>Raise a support ticket</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm"><label>Subject</label><input id="custTkSubject" placeholder="Brief summary">
    <label>Details</label><textarea id="custTkDesc" placeholder="Describe the issue…"></textarea>
    <label>Attachments (optional — photo, PDF, etc.)</label><input type="file" id="custTkFiles" multiple accept="application/pdf,image/*"></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="custTkBtn" onclick="custNewTicketSave()">Submit</button></div>`);
};
window.custNewTicketSave=async function(){
  const subject=$('custTkSubject').value.trim(),description=$('custTkDesc').value.trim();
  if(!subject){toast('Enter a subject','err');return;}
  const files=[...$('custTkFiles').files];
  const unit=CUST_DATA.units.find(u=>u.id===CUST_SELECTED_UNIT);
  const btn=$('custTkBtn');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';
  const {data:ins,error}=await sb.schema('cust').from('support_tickets').insert({unit_id:unit.id,subject,description,created_by:state.email}).select('id').single();
  if(error){toast('Could not raise ticket: '+error.message,'err');btn.disabled=false;btn.innerHTML='Submit';return;}
  for(const f of files){
    btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading attachment…';
    const {data,error:upErr}=await uploadFileToS3(s3KeyForSupportAttachment(ins.id,f.name),f);
    if(upErr){toast('Ticket raised, but attachment "'+f.name+'" failed to upload: '+upErr.message,'err');continue;}
    const {error:insErr}=await sb.schema('cust').from('support_ticket_attachments').insert({ticket_id:ins.id,storage_path:data.path,file_name:f.name,file_size:f.size,file_type:f.type,uploaded_by:state.email});
    if(insErr)toast('Ticket raised, but attachment "'+f.name+'" failed to save: '+insErr.message,'err');
  }
  try{
    btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Sending to Zoho Desk…';
    const {data:{session}}=await sb.auth.getSession();const token=session&&session.access_token;
    const res=await fetch(SUPABASE_URL+'/functions/v1/zoho-desk',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({action:'create',ticketId:ins.id})});
    const out=await res.json().catch(()=>({}));
    if(!res.ok||out.error){toast('Ticket saved, but Zoho Desk sync failed: '+(out.error||res.status),'err');}
    else if(out.attachmentErrors&&out.attachmentErrors.length){toast('Ticket raised, but some attachments did not reach Zoho Desk: '+out.attachmentErrors.join('; '),'err');}
  }catch(e){toast('Ticket saved, but Zoho Desk sync failed: '+e.message,'err');}
  closeModal();toast('Ticket raised','ok');route();
};
window.custSyncTicket=async function(id){
  toast('Refreshing status…','');
  try{
    const {data:{session}}=await sb.auth.getSession();const token=session&&session.access_token;
    const res=await fetch(SUPABASE_URL+'/functions/v1/zoho-desk',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({action:'sync',ticketId:id})});
    const out=await res.json().catch(()=>({}));
    if(!res.ok||out.error){toast('Refresh failed: '+(out.error||res.status),'err');return;}
    if(out.attachmentErrors&&out.attachmentErrors.length)toast('Status updated, but some attachments still haven’t reached Zoho Desk: '+out.attachmentErrors.join('; '),'err');
    else toast('Status updated','ok');
    route();
  }catch(e){toast('Refresh failed: '+e.message,'err');}
};
window.custRetryTicket=async function(id){
  toast('Retrying…','');
  try{
    const {data:{session}}=await sb.auth.getSession();const token=session&&session.access_token;
    const res=await fetch(SUPABASE_URL+'/functions/v1/zoho-desk',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({action:'create',ticketId:id})});
    const out=await res.json().catch(()=>({}));
    if(!res.ok||out.error){toast('Retry failed: '+(out.error||res.status),'err');return;}
    toast('Ticket created','ok');route();
  }catch(e){toast('Retry failed: '+e.message,'err');}
};
async function custTabAmenities(unit){
  if(unit.status!=='possession'){
    return '<div class="card card-pad empty"><i class="fa-solid fa-lock"></i><div style="margin-top:6px">Amenity booking becomes available once you have taken possession of your flat.</div></div>';
  }
  const {data:amenities}=await sb.schema('cust').from('amenities').select('*').eq('project_id',unit.project_id);
  const amenityIds=(amenities||[]).map(a=>a.id);
  const [{data:bookings},{data:pay}]=await Promise.all([
    amenityIds.length?sb.schema('cust').from('amenity_bookings').select('*').in('amenity_id',amenityIds).neq('status','cancelled'):Promise.resolve({data:[]}),
    sb.schema('cust').from('payment_settings').select('*').eq('id',1).maybeSingle()
  ]);
  if(!(amenities&&amenities.length))return '<div class="card card-pad empty">No amenities have been added for your project yet.</div>';
  const takenByAmenity={};(bookings||[]).forEach(b=>{(takenByAmenity[b.amenity_id]=takenByAmenity[b.amenity_id]||[]).push(b.booking_date);});
  const myBookings=(bookings||[]).filter(b=>b.unit_id===unit.id);
  const amenityCards=amenities.map(a=>{
    const taken=(takenByAmenity[a.id]||[]).map(d=>fmtDateShort(d)).join(', ')||'None yet';
    return `<div class="card card-pad" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div><b>${esc(a.name)}</b>${a.description?`<div style="font-size:12.5px;color:var(--slate);margin-top:4px">${esc(a.description)}</div>`:''}
      <div style="font-size:12px;color:var(--slate);margin-top:6px">Already booked: ${esc(taken)}</div></div>
      <div style="text-align:right">${a.rental_amount!=null?`<div style="font-weight:700">${custInr(a.rental_amount)}</div>`:''}
      <button class="btn btn-sm btn-primary" style="margin-top:6px" onclick="custBookAmenityModal(${a.id},'${esc(a.name).replace(/'/g,"\\'")}',${a.rental_amount==null?'null':a.rental_amount})">Book a date</button></div>
      </div></div>`;
  }).join('');
  const myRows=myBookings.map(b=>{
    const a=amenities.find(x=>x.id===b.amenity_id);
    return [esc((a&&a.name)||'—'),fmtDate(b.booking_date),b.amount!=null?custInr(b.amount):'—',
      b.status==='confirmed'?'<span class="tag t-green">Confirmed</span>':b.status==='cancelled'?'<span class="tag t-gray">Cancelled</span>':'<span class="tag t-amber">Pending payment</span>',
      esc(b.payment_reference||'—'),
      b.status==='pending_payment'?`<button class="btn btn-sm" onclick="custSetAmenityPaymentRef(${b.id},'${(b.payment_reference||'').replace(/'/g,"\\'")}')">Add reference</button>`:'—'];
  });
  return '<div class="sec-title" style="margin:0 0 10px">Amenities</div>'+amenityCards+
    '<div class="sec-title" style="margin:20px 0 10px">My bookings</div>'+
    (myRows.length?cpaTable(['Amenity','Date','Amount','Status','Payment ref','Action'],myRows):'<div class="card card-pad empty">You haven’t booked anything yet.</div>')+
    (pay&&(pay.upi_id||pay.qr_storage_path)?`<div class="sec-title" style="margin:20px 0 10px">Payment</div><div class="card card-pad" style="font-size:13px">Pay via ${pay.upi_id?`UPI ID <b>${esc(pay.upi_id)}</b>`:''}${pay.upi_id&&pay.qr_storage_path?' or ':''}${pay.qr_storage_path?`<button class="btn btn-sm" onclick="s3OpenSigned('${pay.qr_storage_path.replace(/'/g,"\\'")}')"><i class="fa-solid fa-qrcode"></i> View QR code</button>`:''}, then let us know the reference — we’ll confirm your booking once we see it.</div>`:'');
}
window.custBookAmenityModal=function(amenityId,name,rentalAmount){
  const today=new Date().toISOString().slice(0,10);
  openModal(`<div class="modal-head"><h3>Book ${esc(name)}</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm"><label>Date</label><input type="date" id="custAmDate" min="${today}">
    ${rentalAmount!=null?`<p style="font-size:13px;color:var(--slate)">Rental amount: <b>${custInr(rentalAmount)}</b></p>`:''}
    <label>Payment reference (optional — fill in after you pay)</label><input id="custAmRef" placeholder="UTR / transaction ID"></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="custAmBtn" onclick="custBookAmenitySave(${amenityId},${rentalAmount==null?'null':rentalAmount})">Book</button></div>`);
};
window.custBookAmenitySave=async function(amenityId,rentalAmount){
  const bookingDate=$('custAmDate').value,paymentReference=$('custAmRef').value.trim()||null;
  if(!bookingDate){toast('Choose a date','err');return;}
  const unit=CUST_DATA.units.find(u=>u.id===CUST_SELECTED_UNIT);
  const btn=$('custAmBtn');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Booking…';
  const {error}=await sb.schema('cust').from('amenity_bookings').insert({amenity_id:amenityId,unit_id:unit.id,booking_date:bookingDate,amount:rentalAmount,payment_reference:paymentReference,created_by:state.email});
  if(error){toast(error.code==='23505'?'That date is already booked — pick another.':'Could not book: '+error.message,'err');btn.disabled=false;btn.innerHTML='Book';return;}
  closeModal();toast('Booking submitted — pending payment confirmation','ok');route();
};
window.custSetAmenityPaymentRef=function(bookingId,current){
  openModal(`<div class="modal-head"><h3>Payment reference</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm"><label>UTR / transaction ID</label><input id="custAmRefEdit" value="${esc(current)}"></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="custSetAmenityPaymentRefSave(${bookingId})">Save</button></div>`);
};
window.custSetAmenityPaymentRefSave=async function(bookingId){
  const reference=$('custAmRefEdit').value.trim()||null;
  const {error}=await sb.schema('cust').rpc('set_amenity_booking_payment_ref',{p_booking_id:bookingId,p_reference:reference});
  if(error){toast('Could not save: '+error.message,'err');return;}
  closeModal();toast('Payment reference saved','ok');route();
};
async function custTabSubmeter(unit){
  const [{data:requests},{data:pay}]=await Promise.all([
    sb.schema('cust').from('submeter_requests').select('*').eq('unit_id',unit.id).order('requested_at',{ascending:false}),
    sb.schema('cust').from('payment_settings').select('*').eq('id',1).maybeSingle()
  ]);
  const tagFor={requested:'<span class="tag t-amber">Requested</span>',invoiced:'<span class="tag t-blue">Invoiced — payment due</span>',paid:'<span class="tag t-green">Paid</span>',completed:'<span class="tag t-green">Completed</span>',cancelled:'<span class="tag t-gray">Cancelled</span>'};
  const rows=(requests||[]).map(r=>[fmtDate(r.requested_at),r.invoice_amount!=null?custInr(r.invoice_amount):'—',tagFor[r.status]||esc(r.status),
    r.invoice_storage_path?`<button class="btn btn-sm" onclick="s3OpenSigned('${r.invoice_storage_path.replace(/'/g,"\\'")}','invoice')"><i class="fa-solid fa-download"></i> Invoice</button>`:'—',
    esc(r.payment_reference||'—'),
    r.status==='invoiced'?`<button class="btn btn-sm" onclick="custSetSubmeterPaymentRef(${r.id},'${(r.payment_reference||'').replace(/'/g,"\\'")}')">Add reference</button>`:'—'
  ]);
  const canApply=!(requests||[]).some(r=>['requested','invoiced'].includes(r.status));
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div class="sec-title" style="margin:0">Sub-meter fixing</div>${canApply?'<button class="btn btn-primary" onclick="custSubmeterApply()"><i class="fa-solid fa-plus"></i> Apply</button>':''}</div>`+
    (rows.length?cpaTable(['Requested','Invoice amount','Status','Invoice','Payment ref','Action'],rows):'<div class="card card-pad empty">No requests yet.</div>')+
    (pay&&(pay.upi_id||pay.qr_storage_path)?`<div class="sec-title" style="margin:20px 0 10px">Payment</div><div class="card card-pad" style="font-size:13px">Once invoiced, pay via ${pay.upi_id?`UPI ID <b>${esc(pay.upi_id)}</b>`:''}${pay.upi_id&&pay.qr_storage_path?' or ':''}${pay.qr_storage_path?`<button class="btn btn-sm" onclick="s3OpenSigned('${pay.qr_storage_path.replace(/'/g,"\\'")}')"><i class="fa-solid fa-qrcode"></i> View QR code</button>`:''}.</div>`:'');
}
window.custSubmeterApply=async function(){
  const unit=CUST_DATA.units.find(u=>u.id===CUST_SELECTED_UNIT);
  const {error}=await sb.schema('cust').from('submeter_requests').insert({unit_id:unit.id,requested_by:state.email});
  if(error){toast('Could not submit request: '+error.message,'err');return;}
  toast('Request submitted','ok');route();
};
window.custSetSubmeterPaymentRef=function(requestId,current){
  openModal(`<div class="modal-head"><h3>Payment reference</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm"><label>UTR / transaction ID</label><input id="custSmRefEdit" value="${esc(current)}"></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="custSetSubmeterPaymentRefSave(${requestId})">Save</button></div>`);
};
window.custSetSubmeterPaymentRefSave=async function(requestId){
  const reference=$('custSmRefEdit').value.trim()||null;
  const {error}=await sb.schema('cust').rpc('set_submeter_payment_ref',{p_request_id:requestId,p_reference:reference});
  if(error){toast('Could not save: '+error.message,'err');return;}
  closeModal();toast('Payment reference saved','ok');route();
};
/* Each stage gets its own colour, and the same colour everywhere it appears - the pill, the
   progress rail, the stat tile. A referral's whole story is "how far along is it", so the stages
   run cool-to-warm-to-green and a reader can tell where one has reached without reading a word.
   Not-interested is deliberately the only grey: it is the one outcome that has stopped moving. */
function custRefStage(k){ return CUST_REFERRAL_STAGES.filter(function(s){return s.k===k;})[0]||CUST_REFERRAL_STAGES[0]; }

/* The styles live here rather than in nexus.css because they are this one tab's and nothing else
   reads them. Injected once; the id is the guard. */
function custReferralCss(){
  if(document.getElementById('custRefCss')) return;
  const s=document.createElement('style'); s.id='custRefCss';
  s.textContent=`
  .cref-hero{position:relative;overflow:hidden;border-radius:16px;padding:30px 32px;margin-bottom:18px;
    background:linear-gradient(125deg,#0f1e3d 0%,#16294f 38%,#1d4ed8 100%);color:#fff;
    box-shadow:0 14px 34px -14px rgba(15,30,61,.55)}
  /* A slow sheen travelling across the banner. It is the only moving thing on the page, which is
     what makes it read as "look here" rather than as decoration competing with the content. */
  .cref-hero::after{content:'';position:absolute;top:-60%;left:-30%;width:40%;height:220%;
    background:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.16) 50%,rgba(255,255,255,0) 100%);
    transform:rotate(18deg);animation:crefSheen 5.5s ease-in-out infinite}
  @keyframes crefSheen{0%{left:-35%}55%{left:115%}100%{left:115%}}
  .cref-hero-in{position:relative;z-index:1;display:flex;gap:26px;align-items:center;flex-wrap:wrap}
  .cref-hero-txt{flex:1 1 320px;min-width:0}
  .cref-eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:800;
    letter-spacing:.14em;text-transform:uppercase;color:#f0c964;margin-bottom:11px}
  .cref-hero h2{font-size:26px;line-height:1.2;font-weight:800;margin:0 0 9px;letter-spacing:-.02em;text-wrap:balance}
  .cref-hero p{font-size:14.5px;line-height:1.6;color:#c9d6f0;margin:0;max-width:52ch}
  .cref-cta{display:inline-flex;align-items:center;gap:10px;border:0;cursor:pointer;
    font-family:inherit;font-size:15px;font-weight:800;letter-spacing:.01em;color:#25324a;
    padding:15px 28px;border-radius:999px;white-space:nowrap;
    background:linear-gradient(135deg,#ffd97a 0%,#f0c964 45%,#dCA93a 100%);
    box-shadow:0 8px 22px -6px rgba(240,201,100,.65);transition:transform .16s,box-shadow .16s}
  .cref-cta:hover{transform:translateY(-2px);box-shadow:0 12px 28px -6px rgba(240,201,100,.8)}
  .cref-cta:active{transform:translateY(0)}
  .cref-cta i{font-size:14px}
  /* The pulse stops the moment there is anything in the list - it is there to get a first referral
     out of somebody, not to keep nagging a customer who has already used the thing. */
  .cref-cta.pulse{animation:crefPulse 2.4s ease-out infinite}
  @keyframes crefPulse{
    0%{box-shadow:0 8px 22px -6px rgba(240,201,100,.65),0 0 0 0 rgba(240,201,100,.55)}
    70%{box-shadow:0 8px 22px -6px rgba(240,201,100,.65),0 0 0 16px rgba(240,201,100,0)}
    100%{box-shadow:0 8px 22px -6px rgba(240,201,100,.65),0 0 0 0 rgba(240,201,100,0)}}

  .cref-stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}
  .cref-stat{flex:1 1 150px;background:var(--card);border:1px solid var(--line);border-radius:13px;
    padding:15px 17px;position:relative;overflow:hidden}
  .cref-stat::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--cref-c,#1d4ed8)}
  .cref-stat b{display:block;font-size:27px;font-weight:800;line-height:1.1;color:var(--cref-c,#1d4ed8);
    font-variant-numeric:tabular-nums}
  .cref-stat span{display:block;font-size:12px;color:var(--slate);margin-top:3px;font-weight:600}

  .cref-steps{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:22px}
  .cref-step{flex:1 1 200px;display:flex;gap:12px;align-items:flex-start;background:var(--card);
    border:1px solid var(--line);border-radius:13px;padding:15px 16px}
  .cref-step-n{flex:none;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;
    background:var(--brand-50);color:var(--brand);font-weight:800;font-size:13px}
  .cref-step b{display:block;font-size:13.5px;margin-bottom:2px}
  .cref-step span{font-size:12.5px;color:var(--slate);line-height:1.5}

  .cref-list{display:flex;flex-direction:column;gap:11px}
  .cref-card{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--cref-c,#6366f1);
    border-radius:13px;padding:15px 17px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;
    transition:box-shadow .16s,transform .16s}
  .cref-card:hover{box-shadow:var(--shadow-lg);transform:translateY(-1px)}
  .cref-who{flex:1 1 220px;min-width:0}
  .cref-name{font-size:15.5px;font-weight:700;letter-spacing:-.01em}
  .cref-meta{font-size:12.5px;color:var(--slate);margin-top:3px;display:flex;gap:14px;flex-wrap:wrap}
  .cref-meta i{width:12px;text-align:center;margin-right:4px;opacity:.75}
  .cref-pill{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:700;
    padding:7px 14px;border-radius:999px;white-space:nowrap}
  .cref-pill i{font-size:11px}
  /* The whole journey on every row, so a customer can see there are stages beyond the one they are
     at - a referral sitting at "Contacted" reads as progress rather than as nothing happening. */
  .cref-rail{display:flex;gap:5px;align-items:center;flex:1 1 150px;min-width:120px}
  .cref-seg{height:5px;border-radius:99px;flex:1;background:var(--line)}
  .cref-seg.on{background:var(--cref-c,#6366f1)}
  .cref-when{font-size:12px;color:var(--slate);white-space:nowrap}

  .cref-empty{text-align:center;padding:38px 24px;background:var(--card);border:1px dashed var(--line-2);
    border-radius:14px}
  .cref-empty i{font-size:30px;color:var(--brand);opacity:.35}
  .cref-empty b{display:block;margin-top:12px;font-size:16px}
  .cref-empty span{display:block;margin-top:5px;font-size:13px;color:var(--slate)}
  @media(max-width:620px){
    .cref-hero{padding:24px 20px}
    .cref-hero h2{font-size:21px}
    .cref-cta{width:100%;justify-content:center}
  }
  /* Somebody who has asked the operating system to stop animations gets a page that still works and
     still looks like this - only the sheen and the pulse go. */
  @media(prefers-reduced-motion:reduce){
    .cref-hero::after{animation:none;display:none}
    .cref-cta.pulse{animation:none}
    .cref-card,.cref-cta{transition:none}
  }`;
  document.head.appendChild(s);
}

async function custTabReferrals(unit){
  custReferralCss();
  const {data:referrals}=await sb.schema('cust').from('referrals').select('*').eq('unit_id',unit.id).order('created_at',{ascending:false});
  const list=referrals||[];
  const stageIndex=function(k){ const i=CUST_REFERRAL_STAGES.findIndex(function(s){return s.k===k;}); return i<0?0:i; };
  const booked=list.filter(function(r){return r.status==='booked';}).length;
  const moving=list.filter(function(r){return ['contacted','interested','visited_site'].indexOf(r.status)!==-1;}).length;

  const hero=`<div class="cref-hero"><div class="cref-hero-in">
      <div class="cref-hero-txt">
        <div class="cref-eyebrow"><i class="fa-solid fa-gift"></i> Refer &amp; earn</div>
        <h2>Know someone looking for a home?</h2>
        <p>Tell us who they are and our sales team takes it from there — you can watch every
           referral move along right here, from first call to booking.</p>
      </div>
      <button class="cref-cta${list.length?'':' pulse'}" onclick="custNewReferralModal()">
        <i class="fa-solid fa-user-plus"></i> Refer someone
      </button>
    </div></div>`;

  /* The counts only appear once there is something to count. On an empty tab they would be three
     zeroes, which says "this is not worth using" at exactly the moment it needs to say the
     opposite. */
  const stats=list.length?`<div class="cref-stats">
      <div class="cref-stat" style="--cref-c:#1d4ed8"><b>${list.length}</b><span>Referred by you</span></div>
      <div class="cref-stat" style="--cref-c:#d97706"><b>${moving}</b><span>Being followed up</span></div>
      <div class="cref-stat" style="--cref-c:#16a34a"><b>${booked}</b><span>Booked</span></div>
    </div>`:'';

  const steps=`<div class="cref-steps">
      <div class="cref-step"><div class="cref-step-n">1</div><div><b>You refer</b>
        <span>Their name and a phone number is all we need.</span></div></div>
      <div class="cref-step"><div class="cref-step-n">2</div><div><b>We reach out</b>
        <span>Our sales team calls them and shows them around.</span></div></div>
      <div class="cref-step"><div class="cref-step-n">3</div><div><b>You follow along</b>
        <span>Every stage shows up on this page as it happens.</span></div></div>
    </div>`;

  const body=list.length
    ? `<div class="cref-list">`+list.map(function(r){
        const st=custRefStage(r.status), at=stageIndex(r.status);
        // Not-interested fills nothing: the rail is about progress, and that outcome is not progress.
        const done=(r.status==='not_interested')?0:at+1;
        const rail=CUST_REFERRAL_STAGES.slice(0,5).map(function(_,i){
          return '<div class="cref-seg'+(i<done?' on':'')+'"></div>'; }).join('');
        const phone=r.prospect_phone?`<span><i class="fa-solid fa-phone"></i>${esc(r.prospect_phone)}</span>`:'';
        const mail=r.prospect_email?`<span><i class="fa-solid fa-envelope"></i>${esc(r.prospect_email)}</span>`:'';
        return `<div class="cref-card" style="--cref-c:${st.dot}">
            <div class="cref-who">
              <div class="cref-name">${esc(r.prospect_name)}</div>
              <div class="cref-meta">${phone}${mail}${(phone||mail)?'':'<span>No contact details given</span>'}</div>
            </div>
            <div class="cref-rail">${rail}</div>
            <span class="cref-pill" style="background:${st.bg};color:${st.ink}">
              <i class="fa-solid ${st.icon}"></i>${esc(st.label)}</span>
            <span class="cref-when">${esc(fmtDate(r.created_at))}</span>
          </div>`;
      }).join('')+`</div>`
    : `<div class="cref-empty"><i class="fa-solid fa-user-group"></i>
         <b>No referrals yet</b>
         <span>Be the first — it takes about ten seconds.</span></div>`;

  return hero+stats+steps+body;
}
window.custNewReferralModal=function(){
  openModal(`<div class="modal-head"><h3>Refer a prospect</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm"><label>Name</label><input id="custRefName">
    <label>Phone</label><input id="custRefPhone">
    <label>Email (optional)</label><input id="custRefEmail"></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="custRefBtn" onclick="custNewReferralSave()">Submit</button></div>`);
};
window.custNewReferralSave=async function(){
  const prospect_name=$('custRefName').value.trim(),prospect_phone=$('custRefPhone').value.trim()||null,prospect_email=$('custRefEmail').value.trim()||null;
  if(!prospect_name){toast('Enter a name','err');return;}
  const unit=CUST_DATA.units.find(u=>u.id===CUST_SELECTED_UNIT);
  const {error}=await sb.schema('cust').from('referrals').insert({unit_id:unit.id,prospect_name,prospect_phone,prospect_email,created_by:state.email});
  if(error){toast('Could not submit: '+error.message,'err');return;}
  // Set directly rather than re-fetched: custLoadData's cache would otherwise hand route() the same
  // pre-submit CUST_DATA (same customerId, no force), and the sidebar's "Earn" badge would survive
  // the very referral that should have removed it.
  if(CUST_DATA)CUST_DATA.hasReferred=true;
  closeModal();toast('Referral submitted — thank you!','ok');route();
};
async function custTabMaintenance(unit){
  if(unit.status!=='possession'){
    return '<div class="card card-pad empty"><i class="fa-solid fa-lock"></i><div style="margin-top:6px">Maintenance billing becomes available once you have taken possession of your flat.</div></div>';
  }
  const [{data:bills},{data:receipts},{data:upcoming},{data:payments},{data:pay}]=await Promise.all([
    sb.schema('cust').from('maintenance_bills').select('*').eq('unit_id',unit.id),
    sb.schema('cust').from('maintenance_receipts').select('*').eq('unit_id',unit.id),
    sb.schema('cust').from('maintenance_upcoming').select('*').eq('unit_id',unit.id).maybeSingle(),
    sb.schema('cust').from('maintenance_payments').select('*').eq('unit_id',unit.id).order('submitted_at',{ascending:false}),
    sb.schema('cust').from('payment_settings').select('*').eq('id',1).maybeSingle()
  ]);
  const entries=[].concat((bills||[]).map(b=>({date:b.bill_date,type:'Bill',ref:b.bill_no,desc:b.bill_period,amount:Number(b.total_amount||b.amount||0)})))
    .concat((receipts||[]).map(r=>({date:r.receipt_date,type:'Receipt',ref:r.receipt_no,desc:r.mode,amount:-Number(r.amount||0)})));
  entries.sort((a,b)=>new Date(a.date||0)-new Date(b.date||0));
  let bal=0;
  const ledgerRows=entries.map(e=>{bal+=e.amount;
    return [fmtDate(e.date),e.type==='Bill'?'<span class="tag t-amber">Bill</span>':'<span class="tag t-green">Receipt</span>',
      esc(e.ref||'—'),esc(e.desc||'—'),custInr(Math.abs(e.amount)),custInr(bal)];});
  const outstanding=bal;
  const kpis=[['Outstanding',custInr(outstanding),outstanding>0?'due':'nothing pending'],
    ['Next bill',upcoming&&upcoming.amount!=null?custInr(upcoming.amount):'—','estimate'],
    ['Expected on',upcoming&&upcoming.expected_date?fmtDateShort(upcoming.expected_date):'—','']];
  const payTagFor={submitted:'<span class="tag t-amber">Awaiting confirmation</span>',confirmed:'<span class="tag t-green">Confirmed</span>',rejected:'<span class="tag t-gray">Rejected</span>'};
  const payRows=(payments||[]).map(p=>[fmtDate(p.submitted_at),custInr(p.amount),esc(p.payment_reference||'—'),
    p.receipt_storage_path?`<button class="btn btn-sm" onclick="s3OpenSigned('${p.receipt_storage_path.replace(/'/g,"\\'")}','receipt')"><i class="fa-solid fa-receipt"></i> View</button>`:'—',
    payTagFor[p.status]||esc(p.status)]);
  return mKpis(kpis)+
    '<div class="sec-title" style="margin:16px 0 10px">Bills &amp; receipts</div>'+
    (ledgerRows.length?mTable(['Date','Type','Reference','Details','Amount','Running balance'],ledgerRows):'<div class="card card-pad empty">No maintenance bills or receipts yet.</div>')+
    (upcoming&&upcoming.note?`<div class="card card-pad" style="margin-top:12px;font-size:13px"><i class="fa-solid fa-circle-info"></i> ${esc(upcoming.note)}</div>`:'')+
    `<div style="display:flex;justify-content:space-between;align-items:center;margin:20px 0 10px"><div class="sec-title" style="margin:0">My payments</div><button class="btn btn-primary" onclick="custMaintenancePayModal()"><i class="fa-solid fa-qrcode"></i> Make a payment</button></div>`+
    (payRows.length?cpaTable(['Submitted','Amount','Reference','Receipt','Status'],payRows):'<div class="card card-pad empty">No payments submitted yet.</div>')+
    (pay&&(pay.upi_id||pay.qr_storage_path)?`<div class="card card-pad" style="margin-top:12px;font-size:13px">Pay via ${pay.upi_id?`UPI ID <b>${esc(pay.upi_id)}</b>`:''}${pay.upi_id&&pay.qr_storage_path?' or ':''}${pay.qr_storage_path?`<button class="btn btn-sm" onclick="s3OpenSigned('${pay.qr_storage_path.replace(/'/g,"\\'")}')"><i class="fa-solid fa-qrcode"></i> View QR code</button>`:''}, then submit the amount, reference and a screenshot of the payment below.</div>`:'');
}
window.custMaintenancePayModal=function(){
  openModal(`<div class="modal-head"><h3>Submit a maintenance payment</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm"><label>Amount paid (₹)</label><input id="custMpAmount" type="number">
    <label>Payment reference</label><input id="custMpRef" placeholder="UTR / transaction ID">
    <label>Payment receipt (screenshot / PDF)</label><input type="file" id="custMpFile"></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="custMpBtn" onclick="custMaintenancePaySave()">Submit</button></div>`);
};
window.custMaintenancePaySave=async function(){
  const amount=Number($('custMpAmount').value||0),payment_reference=$('custMpRef').value.trim()||null;
  const f=$('custMpFile').files[0];
  if(!amount){toast('Enter the amount paid','err');return;}
  const unit=CUST_DATA.units.find(u=>u.id===CUST_SELECTED_UNIT);
  const btn=$('custMpBtn');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';
  const row={unit_id:unit.id,amount,payment_reference,submitted_by:state.email};
  if(f){
    const {data,error}=await uploadFileToS3(s3KeyForMaintenanceReceipt(unit.id,f.name),f);
    if(error){toast('Receipt upload failed: '+error.message,'err');btn.disabled=false;btn.innerHTML='Submit';return;}
    row.receipt_storage_path=data.path;
  }
  const {error}=await sb.schema('cust').from('maintenance_payments').insert(row);
  if(error){toast('Could not submit: '+error.message,'err');btn.disabled=false;btn.innerHTML='Submit';return;}
  closeModal();toast('Payment submitted — pending confirmation','ok');route();
};
const CUST_MODREQ_STATUS_LABELS={submitted:'Awaiting response',pm_responded:'Awaiting your decision',accepted:'Accepted — awaiting acknowledgement',rejected:'Rejected',acknowledged:'Acknowledged'};
async function custTabModificationRequests(unit){
  if(unit.status!=='possession'){
    return '<div class="card card-pad empty"><i class="fa-solid fa-lock"></i><div style="margin-top:6px">Modification requests become available once you have taken possession of your flat.</div></div>';
  }
  const {data:reqs}=await sb.schema('cust').from('modification_requests').select('*').eq('unit_id',unit.id).order('created_at',{ascending:false});
  const tagFor={submitted:'<span class="tag t-amber">Awaiting response</span>',pm_responded:'<span class="tag t-blue">Awaiting your decision</span>',accepted:'<span class="tag t-blue">Accepted</span>',rejected:'<span class="tag t-gray">Rejected</span>',acknowledged:'<span class="tag t-green">Acknowledged</span>'};
  const rows=(reqs||[]).map(r=>[esc(r.title),tagFor[r.status]||esc(r.status),r.estimate_amount!=null?custInr(r.estimate_amount):'—',fmtDate(r.created_at),
    `<button class="btn btn-sm" onclick="custModReqDetail(${r.id})"><i class="fa-solid fa-eye"></i> Open</button>`]);
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div class="sec-title" style="margin:0">Modification requests</div><button class="btn btn-primary" onclick="custModReqModal()"><i class="fa-solid fa-plus"></i> Raise a request</button></div>`+
    (rows.length?cpaTable(['Title','Status','Estimate','Raised',''],rows):'<div class="card card-pad empty">No modification requests yet.</div>');
}
window.custModReqModal=function(){
  openModal(`<div class="modal-head"><h3>Raise a modification request</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm"><label>Title</label><input id="custMrTitle" placeholder="Brief summary">
    <label>Details</label><textarea id="custMrDesc" placeholder="Describe what you'd like changed…"></textarea>
    <label>Photo/reference (optional)</label><input type="file" id="custMrFile"></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="custMrBtn" onclick="custModReqSave()">Submit</button></div>`);
};
window.custModReqSave=async function(){
  const title=$('custMrTitle').value.trim(),description=$('custMrDesc').value.trim()||null;
  if(!title){toast('Enter a title','err');return;}
  const f=$('custMrFile').files[0];
  const unit=CUST_DATA.units.find(u=>u.id===CUST_SELECTED_UNIT);
  const btn=$('custMrBtn');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';
  const row={unit_id:unit.id,title,description,created_by:state.email};
  if(f){
    const {data,error}=await uploadFileToS3(s3KeyForModificationRequest(unit.id,f.name),f);
    if(error){toast('Attachment upload failed: '+error.message,'err');btn.disabled=false;btn.innerHTML='Submit';return;}
    row.attachment_storage_path=data.path;
  }
  const {error}=await sb.schema('cust').from('modification_requests').insert(row);
  if(error){toast('Could not submit: '+error.message,'err');btn.disabled=false;btn.innerHTML='Submit';return;}
  closeModal();toast('Request submitted','ok');route();
};
window.custModReqDetail=async function(id){
  const {data:r}=await sb.schema('cust').from('modification_requests').select('*').eq('id',id).maybeSingle();
  if(!r){toast('Not found','err');return;}
  const canDecide=r.status==='pm_responded';
  openModal(`<div class="modal-head"><h3>${esc(r.title)}</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm">
    <p style="font-size:12.5px;color:var(--slate);margin:0 0 4px">Status: ${CUST_MODREQ_STATUS_LABELS[r.status]||esc(r.status)}</p>
    <p style="font-size:13.5px">${esc(r.description||'—')}</p>
    ${r.attachment_storage_path?`<button class="btn btn-sm" style="margin-bottom:10px" onclick="s3OpenSigned('${r.attachment_storage_path.replace(/'/g,"\\'")}')"><i class="fa-solid fa-paperclip"></i> View attachment</button>`:''}
    ${r.pm_response_text?`<div class="card card-pad" style="margin:10px 0"><b>Response from the project management team:</b> ${esc(r.pm_response_text)}${r.estimate_amount!=null?`<div style="margin-top:6px"><b>Estimate:</b> ${custInr(r.estimate_amount)}</div>`:''}</div>`:''}
    ${r.decision?`<p style="font-size:13px">You <b>${esc(r.decision)}</b> this${r.decided_at?' on '+fmtDate(r.decided_at):''}.</p>`:''}
    ${r.acknowledged_at?`<p style="font-size:13px;color:#16a34a">Acknowledged by the project management team on ${fmtDate(r.acknowledged_at)}</p>`:''}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button>
    ${canDecide?`<button class="btn btn-danger" onclick="custModReqDecide(${r.id},'rejected')">Reject</button><button class="btn btn-primary" onclick="custModReqDecide(${r.id},'accepted')">Accept</button>`:''}
    </div>`,'lg');
};
window.custModReqDecide=async function(id,decision){
  const {error}=await sb.schema('cust').rpc('decide_modification_request',{p_request_id:id,p_decision:decision});
  if(error){toast('Could not save: '+error.message,'err');return;}
  closeModal();toast(decision==='accepted'?'Accepted':'Rejected','ok');route();
};
VIEWS.customer=async function(v,seg){
  v.innerHTML='<div class="cust-building-loader"><div class="cbl-site">'+
    '<div class="cbl-crane"><div class="cbl-crane-arm"></div><div class="cbl-crane-hook"></div></div>'+
    '<div class="cbl-building"><div class="cbl-floor cbl-f1"></div><div class="cbl-floor cbl-f2"></div><div class="cbl-floor cbl-f3"></div><div class="cbl-floor cbl-f4"></div><div class="cbl-floor cbl-f5"></div></div>'+
    '<div class="cbl-ground"></div></div><div class="cbl-text">Building your experience...</div></div>';
  const tabs=CUST_TABS;
  let ti=mTab(seg,tabs.length);
  // The sidebar is rebuilt on every render (not just once at boot) so its active item tracks
  // whichever section is actually showing, including a same-page link like the Statement tab's
  // "View full ledger" jumping straight to navTo('customer/3') (was already stale here at '1'
  // before this comment was corrected - the literal itself is what actually runs, not this note).
  custSidebarTabs(ti);
  setCrumb(['Customer Portal',tabs[ti]]);
  const data=await custLoadData(state.customer&&state.customer.id);
  if(data.units.length&&(!CUST_SELECTED_UNIT||!data.units.some(u=>u.id===CUST_SELECTED_UNIT)))CUST_SELECTED_UNIT=data.units[0].id;
  // A section switched off for this flat's project or block (Customer Portal Admin > Customer
  // Features) is not listed, and reaching it anyway - an old link, a bookmark, switching to another
  // flat while on it - lands on Home instead.
  if(!custTabAllowed(ti,custCurrentUnit())){
    ti=0;
    // Keeps the path and a staff preview's ?as=<id>; only the section in the hash changes.
    if(location.hash&&location.hash!=='#/'&&location.hash!=='#/0'){ try{ history.replaceState(history.state,'',location.pathname+location.search+'#/0'); }catch(e){} }
  }
  setCrumb(['Customer Portal',tabs[ti]]);
  // Rebuilt again now that the flats, their section rules and CUST_DATA.hasReferred are known, so
  // only this flat's sections are listed and the Referrals "Earn" badge can appear (it stays off on
  // the call above rather than risk flashing on for a customer who's already referred someone).
  custSidebarTabs(ti);
  // The impersonation banner stays - it's the only thing on screen telling a staff member WHO
  // they're previewing, and it's how they get back out. The plain "signed in as you" banner for a
  // customer's own real session said nothing they don't already know from the profile menu, so it's
  // gone (hoisted above the no-units early-return too, same reasoning as before).
  const banner=state.impersonating?
    `<div class="card card-pad" style="background:#fffbeb;border-color:#f0dfa8;margin-bottom:16px;font-size:13.5px"><i class="fa-solid fa-eye"></i> Staff preview — viewing the portal as <b>${esc((state.customer&&state.customer.full_name)||'this customer')}</b>. Read-only monitoring; this is not their real session. <a href="custportal-admin.html" style="margin-left:8px;font-weight:600">Exit preview</a></div>`:'';
  if(!data.units.length){
    v.innerHTML='<div class="cust-view-fade">'+mHead('fa-user-tie','#1d4ed8','Customer Portal')+banner+
      '<div class="card card-pad empty"><i class="fa-solid fa-circle-info"></i><div style="margin-top:8px">No unit is linked to '+(state.impersonating?'this customer':'your account')+' yet'+(state.impersonating?'.':'. Please contact your relationship manager.')+'</div></div></div>';
    return;
  }
  const unit=data.units.find(u=>u.id===CUST_SELECTED_UNIT);
  let body;
  if(ti===0)body='';
  else if(ti===1)body=await custTabOverview(data,unit);
  else if(ti===2)body=await custTabProgress(unit);
  else if(ti===3)body=await custTabLedger(unit);
  else if(ti===4)body=await custTabCostSheet(data,unit);
  else if(ti===5)body=await custTabInspection(unit);
  else if(ti===6)body=await custTabDocuments(unit);
  else if(ti===7)body=await custTabVideos();
  else if(ti===8)body=await custTabSupport(unit);
  else if(ti===9)body=await custTabAmenities(unit);
  else if(ti===10)body=await custTabSubmeter(unit);
  else if(ti===11)body=await custTabReferrals(unit);
  else if(ti===12)body=await custTabMaintenance(unit);
  else body=await custTabModificationRequests(unit);
  /* The landing page is the greeting over the project's hero photo and nothing else - no page head,
     no unit picker, no body. Every other tab keeps the normal chrome, plus a faint backdrop of the
     same project's render (CUST_PROJECT_TAB_BG) so it isn't flat once the hero is behind them. */
  const tabBg=CUST_PROJECT_TAB_BG[(unit.projects&&unit.projects.name)||''];
  v.innerHTML=ti===0
    ? '<div class="cust-view-fade">'+banner+custLanding((state.customer&&state.customer.full_name)||'',unit)+'</div>'
    : '<div class="cust-view-fade">'+(tabBg?'<div class="cust-tab-bg" style="background-image:url(\''+esc(tabBg)+'\')"></div>':'')+
      mHead('fa-user-tie','#1d4ed8','Customer Portal')+
      banner+
      custUnitPicker(data.units,unit.id)+
      '<div style="margin-top:14px">'+body+'</div></div>';
  // Animated count-up on KPI values (Statement tab only)
  if(ti===1){requestAnimationFrame(function(){
    v.querySelectorAll('.cust-view-fade .kpi .val').forEach(function(el){
      var raw=el.textContent.trim();
      var m=raw.match(/[\d,.]+/);
      if(!m)return;
      var target=parseFloat(m[0].replace(/,/g,''));
      if(isNaN(target)||target===0)return;
      var prefix=raw.slice(0,raw.indexOf(m[0]));
      var suffix=raw.slice(raw.indexOf(m[0])+m[0].length);
      var duration=700,start=performance.now();
      el.textContent=prefix+'0'+suffix;
      function tick(now){
        var t=Math.min((now-start)/duration,1);
        var ease=1-Math.pow(1-t,3);
        el.textContent=prefix+Math.round(target*ease).toLocaleString('en-IN')+suffix;
        if(t<1)requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  });}
};