/* ============================ VIEWS ============================ */
const VIEWS={};

/* ---------- DASHBOARD ---------- */
VIEWS.dashboard=async function(v){
  setCrumb(['Home','Dashboard']);
  const nm=(state.profile&&state.profile.full_name)||state.email.split('@')[0];
  v.innerHTML=
   '<div class="page-head"><div><h1>Welcome back, '+esc(nm.split(' ')[0])+' 👋</h1><p>Here\'s what\'s happening across Jain Group today · '+fmtDate(new Date())+'</p></div>'+
   '<div style="display:flex;gap:10px"><button class="btn" onclick="navTo(\'reports\')"><i class="fa-solid fa-download"></i> Reports</button></div></div>'+
   '<div class="grid kpis" id="kpis" style="grid-template-columns:repeat(3,1fr)"></div>'+
   '<div class="card card-pad" style="margin-top:16px"><div class="sec-title">Sales & Collections</div><div class="sec-sub">Monthly trend across active projects</div><canvas id="chSales" height="100"></canvas></div>'+
   '<div class="card card-pad" style="margin-top:16px"><div class="sec-title">Inventory by Status</div><div class="sec-sub">Unit allocation overview</div><div style="max-width:380px;margin:8px auto 0"><canvas id="chInv" height="240"></canvas></div></div>'+
   '<div class="card card-pad" style="margin-top:16px"><div class="sec-title">Recent Documents</div><div class="sec-sub">Latest uploads across the company</div><div id="wDocs"></div></div>'+
   '<div class="card card-pad" style="margin-top:16px"><div class="sec-title">Quick Actions</div><div class="sec-sub">Jump back in</div><div id="wQuick"></div></div>'+
   '<div class="card card-pad" style="margin-top:16px"><div class="sec-title">Recent Activity</div><div class="sec-sub">Company-wide</div><div id="wAct" style="margin-top:8px"></div></div>';

  // KPIs (live counts where possible, sample otherwise)
  let docCount=48,taskOpen=0,leads=5,projects=3;
  try{const {count}=await sb.schema('doc').from('documents').select('*',{count:'exact',head:true});if(count!=null)docCount=count;}catch(e){}
  try{const {count}=await sb.schema('acc').from('tasks').select('*',{count:'exact',head:true}).neq('status','Completed');if(count!=null)taskOpen=count;}catch(e){}
  try{const {count}=await sb.schema('crm').from('leads').select('*',{count:'exact',head:true});if(count!=null)leads=count;}catch(e){}
  // Use CONS_ONGOING (the live projects array) — matches the Projects panel exactly
  projects=CONS_ONGOING.length;
  const kpis=[
    {ic:'fa-building',bg:'#eff4ff',c:'#1d4ed8',val:projects,lbl:'Active Projects',tr:'across Kolkata · Siliguri · Durgapur',up:1},
    {ic:'fa-folder-open',bg:'#f0fdf4',c:'#16a34a',val:docCount,lbl:'Documents Stored',tr:'live count',up:1},
    {ic:'fa-handshake',bg:'#f5f3ff',c:'#7c3aed',val:leads,lbl:'Active Leads',tr:'+3 today',up:1},
  ];
  $('kpis').innerHTML=kpis.map(k=>'<div class="kpi"><div class="top"><div class="ic" style="background:'+k.bg+';color:'+k.c+'"><i class="fa-solid '+k.ic+'"></i></div></div><div class="val">'+k.val+'</div><div class="lbl">'+k.lbl+'</div><div class="trend '+(k.up?'up':'down')+'"><i class="fa-solid fa-arrow-'+(k.up?'up':'down')+'"></i> '+k.tr+'</div></div>').join('');

  // charts
  new Chart($('chSales'),{type:'line',data:{labels:['Jan','Feb','Mar','Apr','May','Jun'],datasets:[
    {label:'Sales (₹ Cr)',data:[8,11,9.5,14,12,16],borderColor:'#1d4ed8',backgroundColor:'rgba(29,78,216,.08)',fill:true,tension:.4,borderWidth:2,pointRadius:3},
    {label:'Collections (₹ Cr)',data:[6,7.5,8,9,10.5,12],borderColor:'#16a34a',backgroundColor:'rgba(22,163,74,.06)',fill:true,tension:.4,borderWidth:2,pointRadius:3}
  ]},options:{plugins:{legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:7,font:{size:12}}}},scales:{y:{grid:{color:'#eef1f6'},border:{display:false}},x:{grid:{display:false}}}}});
  new Chart($('chInv'),{type:'doughnut',data:{labels:['Available','Booked','Registered','Blocked'],datasets:[{data:[42,28,18,12],backgroundColor:['#1d4ed8','#16a34a','#7c3aed','#d97706'],borderWidth:0}]},options:{cutout:'62%',plugins:{legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:7,font:{size:11.5},padding:12}}}}});

  // recent docs
  try{
    const {data}=await sb.schema('doc').from('documents').select('id,title,file_type,department,created_at').order('created_at',{ascending:false}).limit(4);
    $('wDocs').innerHTML=(data||[]).map(d=>'<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--line-2);cursor:pointer" onclick="navTo(\'documents\')">'+fileIcon(d.file_type)+'<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(d.title)+'</div><div style="color:var(--slate);font-size:11.5px">'+esc(d.department)+' · '+relTime(d.created_at)+'</div></div></div>').join('');
  }catch(e){}

  // recent activity (company-wide, live)
  try{
    let feed=[];
    const dr=await sb.schema('doc').from('documents').select('title,uploaded_by,created_at').order('created_at',{ascending:false}).limit(6);
    (dr.data||[]).forEach(d=>feed.push({t:new Date(d.created_at),ic:'fa-file-arrow-up',c:'t-blue',who:(d.uploaded_by||'Someone').split('@')[0],act:'uploaded',obj:d.title}));
    const trq=await sb.schema('acc').from('tasks').select('title,created_by,created_at').order('created_at',{ascending:false}).limit(6);
    (trq.data||[]).forEach(t=>feed.push({t:new Date(t.created_at),ic:'fa-list-check',c:'t-purple',who:(t.created_by||'Someone').split('@')[0],act:'created task',obj:t.title}));
    feed.sort((a,b)=>b.t-a.t);feed=feed.slice(0,7);
    $('wAct').innerHTML=feed.length?feed.map(a=>'<div style="display:flex;align-items:center;gap:11px;padding:10px 0;border-bottom:1px solid var(--line-2)"><div class="n-ic '+a.c+'"><i class="fa-solid '+a.ic+'"></i></div><div style="font-size:13px"><b>'+esc(a.who)+'</b> '+a.act+' <b>'+esc(a.obj)+'</b><div style="color:var(--slate);font-size:11.5px">'+relTime(a.t)+'</div></div></div>').join(''):'<div class="empty" style="padding:22px"><i class="fa-regular fa-clock"></i><div>No recent activity</div></div>';
  }catch(e){$('wAct').innerHTML='<div class="empty" style="padding:22px">No recent activity</div>';}

  // quick actions
  const q=[{l:'Upload Document',i:'fa-upload',h:'documents'},{l:'New Task',i:'fa-list-check',h:'tasks'},{l:'Legal Vault',i:'fa-scale-balanced',h:'legal'},{l:'Add Lead',i:'fa-handshake',h:'crm'},{l:'View Reports',i:'fa-chart-pie',h:'reports'},{l:'New Inspection',i:'fa-clipboard-check',h:'inspection/new'},{l:'Projects',i:'fa-building',h:'projects'},{l:'Finance Vault',i:'fa-indian-rupee-sign',h:'finance'},{l:'Renewals',i:'fa-calendar-check',h:'compliance'}];
  $('wQuick').innerHTML='<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px">'+q.map(x=>'<div class="lib-card" style="padding:14px;display:flex;align-items:center;gap:10px" onclick="navTo(\''+x.h+'\')"><div class="ic" style="width:36px;height:36px;margin:0;background:var(--brand-50);color:var(--brand)"><i class="fa-solid '+x.i+'"></i></div><div style="font-weight:600;font-size:13px">'+x.l+'</div></div>').join('')+'</div>';


};

/* ---------- GENERIC PLACEHOLDER MODULES ---------- */
const MODMETA={
  crm:{icon:'fa-handshake',c:'#7c3aed',bg:'#f5f3ff',desc:'Leads, pipeline, bookings, demands & collections.',kpis:[['Active Leads','5','fa-user-tag'],['Site Visits (wk)','12','fa-location-dot'],['Bookings (mo)','7','fa-file-signature'],['Collections','₹1.2 Cr','fa-indian-rupee-sign']],cols:['Lead','Project','Stage','Owner','Value'],rows:[['Rahul Mehta','Skyline','Site Visit','You','₹85L'],['Priya Shah','Greenfield','Negotiation','You','₹1.1Cr'],['Amit Patel','Skyline','Booking','You','₹92L']]},
  projects:{icon:'fa-building',c:'#1d4ed8',bg:'#eff4ff',desc:'Projects, towers, units, BOQ, construction stages & contractor work orders.',kpis:[['Active Projects','3','fa-building'],['Total Units','100','fa-door-open'],['Avg. Completion','64%','fa-helmet-safety'],['Open WOs','9','fa-file-contract']],cols:['Project','Tower','Stage','% Complete','Status'],rows:[['Skyline','Tower A','RCC Floor 12','62%','On Track'],['Greenfield','Block B','Finishing','88%','On Track'],['Riverdale','Phase 1','Plinth','24%','Delayed']]},
  inventory:{icon:'fa-boxes-stacked',c:'#0f766e',bg:'#f0fdfa',desc:'One stock truth — indents, GRNs, issues, returns & moving-average valuation.',kpis:[['SKUs','248','fa-tags'],['Stock Value','₹3.4 Cr','fa-warehouse'],['Low Stock','6','fa-triangle-exclamation'],['Pending GRN','3','fa-truck-ramp-box']],cols:['Item','Category','In Stock','UoM','Value'],rows:[['OPC 53 Cement','Cement','420','Bags','₹1.6L'],['TMT Steel 12mm','Steel','18','MT','₹9.2L'],['River Sand','Aggregates','60','Brass','₹3.0L']]},
  procurement:{icon:'fa-cart-shopping',c:'#b45309',bg:'#fffbeb',desc:'Indent → RFQ → PO → GRN with multi-level approvals & 3-way match.',kpis:[['Open POs','14','fa-file-invoice'],['Pending Approval','5','fa-clock'],['Vendors','86','fa-store'],['Spend (mo)','₹62L','fa-indian-rupee-sign']],cols:['PO No','Vendor','Amount','Status','Date'],rows:[['PO-0042','ACC Cement','₹4.2L','Pending','27 Jun'],['PO-0041','Tata Steel','₹9.1L','Approved','25 Jun'],['PO-0040','Pidilite','₹1.3L','Received','22 Jun']]},
  finance:{icon:'fa-indian-rupee-sign',c:'#15803d',bg:'#f0fdf4',desc:'Director vault — collections, dues, payables & project P&L.',kpis:[['Collections (mo)','₹1.2 Cr','fa-arrow-down'],['Outstanding','₹3.8 Cr','fa-hourglass'],['Payables','₹64L','fa-file-invoice-dollar'],['Net Position','₹5.6 Cr','fa-scale-balanced']],cols:['Account','Type','Amount','Status','Date'],rows:[['Skyline Collections','Inflow','₹42L','Cleared','26 Jun'],['Contractor Payment','Outflow','₹18L','Pending','27 Jun']]},
  hr:{icon:'fa-users',c:'#be123c',bg:'#fff1f2',desc:'Directory, attendance, payroll-grade data, performance & statutory.',kpis:[['Headcount','3','fa-users'],['Present Today','3','fa-user-check'],['On Leave','0','fa-plane'],['Open Requests','2','fa-inbox']],cols:['Employee','Department','Designation','Status','Joined'],rows:[['(salary columns are protected)','—','—','—','—']]},
  recruitment:{icon:'fa-user-plus',c:'#0369a1',bg:'#f0f9ff',desc:'Hiring funnel — request → applications → interviews → offer → onboarding.',kpis:[['Open Roles','4','fa-briefcase'],['Applicants','37','fa-id-card'],['Interviews (wk)','6','fa-comments'],['Offers Out','2','fa-envelope-open-text']],cols:['Applicant','Role','Stage','Score','Status'],rows:[['Neha Verma','Site Engineer','Interview L2','82','Active'],['Karan Singh','Accountant','Shortlisted','—','Active']]},
  maintenance:{icon:'fa-screwdriver-wrench',c:'#7c3aed',bg:'#f5f3ff',desc:'Asset register, preventive-maintenance schedules & breakdown tracking.',kpis:[['Assets','64','fa-gears'],['PM Due (wk)','8','fa-calendar-check'],['Under Repair','2','fa-wrench'],['Downtime','3.2h','fa-clock']],cols:['Asset','Category','Location','Next PM','Status'],rows:[['DG Set 250kVA','Electrical','Skyline','02 Jul','Active'],['Passenger Lift 1','Mechanical','Greenfield','—','Under Repair']]},
  reports:{icon:'fa-chart-pie',c:'#1d4ed8',bg:'#eff4ff',desc:'Cross-module analytics, scoreboards & reconciliation tools.',kpis:[['Saved Reports','12','fa-floppy-disk'],['Reconciliations','4','fa-not-equal'],['Scheduled','3','fa-clock'],['Exports (mo)','28','fa-file-export']],cols:['Report','Module','Type','Last Run','Owner'],rows:[['Collections vs Demand','CRM','Reconciliation','Today','You'],['Stock Variance','Inventory','Reconciliation','Yesterday','You']]},
  gtd:{icon:'fa-brain',c:'#7c3aed',bg:'#f5f3ff',desc:'Getting Things Done — one trusted system: capture, clarify, organise, reflect, engage.',kpis:[['Inbox','9','fa-inbox'],['Next Actions','14','fa-bolt'],['Waiting On','5','fa-hourglass-half'],['Someday','21','fa-cloud']],cols:['Action','Context','Project','Due','Status'],rows:[['Finalise RERA filing','@office','Skyline','Today','Next'],['Call structural consultant','@calls','Riverdale','Tomorrow','Waiting'],['Review tender draft','@computer','Greenfield','2 days','Next']]},
  compliance:{icon:'fa-calendar-check',c:'#b45309',bg:'#fffbeb',desc:'Licences, RERA, NOCs, insurance & statutory renewals — never miss an expiry.',kpis:[['Active Licences','38','fa-id-badge'],['Due in 30d','6','fa-bell'],['Expired','1','fa-triangle-exclamation'],['Renewed (mo)','4','fa-rotate']],cols:['Item','Type','Authority','Expiry','Status'],rows:[['RERA — Skyline','Registration','MahaRERA','14 Aug','Active'],['Fire NOC — Greenfield','NOC','Fire Dept','02 Jul','Due Soon'],['Labour Licence','Statutory','Labour Dept','—','Expired']]},
  campaigns:{icon:'fa-bullhorn',c:'#db2777',bg:'#fdf2f8',desc:'Marketing campaign performance — channels, leads, cost per lead & ROAS.',kpis:[['Active Campaigns','5','fa-rectangle-ad'],['Leads (mo)','428','fa-user-plus'],['Cost / Lead','₹540','fa-indian-rupee-sign'],['ROAS','4.2x','fa-arrow-trend-up']],cols:['Campaign','Channel','Spend','Leads','CPL'],rows:[['Skyline Launch','Meta','₹3.2L','186','₹172'],['Festive Offer','Google','₹2.1L','142','₹148'],['Brand Awareness','Hoardings','₹1.8L','100','₹1800']]},
  scaling:{icon:'fa-arrow-trend-up',c:'#0d9488',bg:'#f0fdfa',desc:'Growth priorities, quarterly rocks, OKRs & execution rhythm.',kpis:[['Priorities','5','fa-flag'],['On Track','3','fa-circle-check'],['At Risk','1','fa-circle-exclamation'],['Quarter','Q2 FY27','fa-calendar']],cols:['Priority','Owner','Quarter','Progress','Status'],rows:[['Launch Riverdale Ph-1','Rishi','Q2','45%','On Track'],['Digitise procurement','Ops','Q2','70%','On Track'],['New CRM rollout','Sales','Q2','30%','At Risk']]},
  playbook:{icon:'fa-book-open',c:'#4338ca',bg:'#eef2ff',desc:'Standard operating procedures & process playbooks for every function.',kpis:[['Playbooks','22','fa-book'],['SOPs','146','fa-list-check'],['Owners','11','fa-user-gear'],['Updated (mo)','9','fa-pen']],cols:['Playbook','Department','Owner','Version','Updated'],rows:[['Site Handover','Projects','PMO','v3.1','Jun 2026'],['Lead to Booking','Sales','CRM Lead','v2.0','May 2026'],['Vendor Onboarding','Procurement','Purchase','v1.4','Jun 2026']]},
  intranet:{icon:'fa-landmark',c:'#0369a1',bg:'#f0f9ff',desc:'Company announcements, policies, quick links & the people directory.',kpis:[['Announcements','7','fa-bullhorn'],['Policies','34','fa-file-shield'],['Quick Links','19','fa-link'],['Birthdays','3','fa-cake-candles']],cols:['Item','Type','Posted by','Date','Pinned'],rows:[['Diwali holiday calendar','Notice','HR','24 Jun','Yes'],['Updated travel policy','Policy','Admin','20 Jun','No'],['New Mumbai office','Announcement','MD Office','18 Jun','Yes']]},
  training:{icon:'fa-graduation-cap',c:'#7c3aed',bg:'#f5f3ff',desc:'Courses, learning paths & certifications for every team.',kpis:[['Courses','28','fa-chalkboard'],['Enrolled','64','fa-user-graduate'],['Avg. Completion','71%','fa-percent'],['Certificates','42','fa-award']],cols:['Course','Category','Enrolled','Completion','Status'],rows:[['Site Safety L1','Safety','38','86%','Active'],['RERA Essentials','Compliance','22','64%','Active'],['Excel for PMO','Productivity','14','58%','Active']]},
  video:{icon:'fa-clapperboard',c:'#be123c',bg:'#fff1f2',desc:'Training videos, site walkthroughs & recorded sessions.',kpis:[['Videos','73','fa-film'],['Categories','9','fa-folder-tree'],['Views (mo)','1.2k','fa-eye'],['Hours','41','fa-clock']],cols:['Title','Category','Duration','Views','Added'],rows:[['Skyline drone walkthrough','Site','6:24','312','Jun 2026'],['How to raise an indent','SOP','3:10','188','Jun 2026'],['Safety induction','Safety','9:45','405','May 2026']]},
  customer:{icon:'fa-user-tie',c:'#1d4ed8',bg:'#eff4ff',desc:'Buyer self-service — bookings, payment schedule, documents & construction updates.',kpis:[['Customers','312','fa-users'],['Active Bookings','184','fa-file-signature'],['Payments Due','₹2.4 Cr','fa-clock'],['Open Tickets','7','fa-headset']],cols:['Customer','Unit','Stage','Next Due','Status'],rows:[['Rahul Mehta','Skyline A-1204','Booked','₹4.2L · 30 Jun','Active'],['Priya Shah','Greenfield B-803','Registered','—','Active'],['Amit Patel','Skyline A-905','Possession','—','Closed']]},
  supplier:{icon:'fa-truck',c:'#0f766e',bg:'#f0fdfa',desc:'Vendor self-service — POs, invoices, GRNs & payment status.',kpis:[['Suppliers','86','fa-store'],['Open POs','14','fa-file-invoice'],['Invoices Due','₹38L','fa-file-invoice-dollar'],['Pending GRN','3','fa-truck-ramp-box']],cols:['Supplier','PO No','Amount','Status','Due'],rows:[['ACC Cement','PO-0042','₹4.2L','Approved','01 Jul'],['Tata Steel','PO-0041','₹9.1L','Dispatched','28 Jun'],['Pidilite','PO-0040','₹1.3L','Paid','—']]},
  whatsapp:{icon:'fa-comment-dots',c:'#16a34a',bg:'#f0fdf4',desc:'Automated WhatsApp flows — lead capture, reminders & status updates.',kpis:[['Subscribers','1.9k','fa-address-book'],['Messages (mo)','8.4k','fa-paper-plane'],['Auto-replies','94%','fa-robot'],['Open Rate','72%','fa-envelope-open']],cols:['Flow','Trigger','Sent','Delivered','Replies'],rows:[['Payment reminder','Due date','420','410','96'],['Site visit confirm','Booking','188','185','142'],['New launch blast','Campaign','1900','1840','312']]},
  mail:{icon:'fa-envelope',c:'#475569',bg:'#f8fafc',desc:'Connected mailbox — unified inbox, flags & quick replies.',kpis:[['Unread','12','fa-envelope'],['Sent (mo)','248','fa-paper-plane'],['Flagged','5','fa-flag'],['Drafts','3','fa-pen']],cols:['From','Subject','Folder','Date','Status'],rows:[['MahaRERA','Filing acknowledgement','Compliance','Today','Unread'],['Tata Steel','Invoice INV-2291','Accounts','Today','Flagged'],['Rahul Mehta','Re: Possession date','Sales','Yesterday','Read']]},
  control:{icon:'fa-sliders',c:'#334155',bg:'#f1f5f9',locked:!state.super,desc:'System administration — users, roles, integrations & audit trail.',kpis:[['Users','8','fa-users'],['Roles','4','fa-user-shield'],['Integrations','6','fa-plug'],['Audit Events','1.4k','fa-clipboard-list']],cols:['Setting','Area','Value','Updated','By'],rows:[['SMTP provider','Email','Resend','Jun 2026','Admin'],['Storage','Files','Amazon S3','Jun 2026','Admin'],['Session timeout','Security','45 min','Jun 2026','Admin']]},
};

/* ---- per-module sub-tabs (reference-style tabbed pages) ---- */
const MODTABS={
  crm:[
    {t:'Pipeline',cols:['Lead','Project','Stage','Owner','Value'],rows:[['Rahul Mehta','Skyline','Site Visit','You','₹85L'],['Priya Shah','Greenfield','Negotiation','You','₹1.1Cr'],['Amit Patel','Skyline','Booking','You','₹92L']]},
    {t:'Bookings',cols:['Customer','Unit','Date','Value','Status'],rows:[['Amit Patel','Skyline A-905','24 Jun','₹92L','Confirmed'],['Sneha R.','Greenfield B-210','22 Jun','₹78L','Token']]},
    {t:'Collections',cols:['Customer','Due','Amount','Mode','Status'],rows:[['Rahul Mehta','30 Jun','₹4.2L','Cheque','Pending'],['Amit Patel','—','₹0','—','Cleared']]},
    {t:'Site Visits',cols:['Lead','Project','Slot','Owner','Status'],rows:[['Priya Shah','Greenfield','Sat 11 AM','You','Confirmed'],['New enquiry','Skyline','Sun 4 PM','You','Pending']]}],
  projects:[
    {t:'Towers & Units',cols:['Project','Tower','Units','Sold','Stage'],rows:[['Skyline','Tower A','48','31','RCC F12'],['Greenfield','Block B','36','28','Finishing']]},
    {t:'Construction Stages',cols:['Project','Stage','% Complete','Target','Status'],rows:[['Skyline','RCC','62%','Aug 26','On Track'],['Riverdale','Plinth','24%','Jul 26','Delayed']]},
    {t:'Work Orders',cols:['WO No','Contractor','Scope','Amount','Status'],rows:[['WO-118','Shree Const.','RCC F12','₹42L','Open'],['WO-117','Glaze India','Glazing','₹18L','Approved']]}],
  inventory:[
    {t:'Stock',cols:['Item','Category','In Stock','UoM','Value'],rows:[['OPC 53 Cement','Cement','420','Bags','₹1.6L'],['TMT 12mm','Steel','18','MT','₹9.2L']]},
    {t:'Indents',cols:['Indent','Project','Items','Raised by','Status'],rows:[['IND-204','Skyline','Cement x500','Site A','Pending'],['IND-203','Greenfield','Steel x20MT','Site B','Approved']]},
    {t:'GRNs',cols:['GRN','PO','Supplier','Date','Status'],rows:[['GRN-091','PO-0042','ACC Cement','26 Jun','Received'],['GRN-090','PO-0041','Tata Steel','25 Jun','QC Pending']]}],
  procurement:[
    {t:'Purchase Orders',cols:['PO No','Vendor','Amount','Status','Date'],rows:[['PO-0042','ACC Cement','₹4.2L','Pending','27 Jun'],['PO-0041','Tata Steel','₹9.1L','Approved','25 Jun']]},
    {t:'RFQs',cols:['RFQ','Item','Vendors','Best Quote','Status'],rows:[['RFQ-58','Tiles','4','₹3.1L','Open'],['RFQ-57','Paint','3','₹1.3L','Awarded']]},
    {t:'Vendors',cols:['Vendor','Category','Rating','Orders','Status'],rows:[['ACC Cement','Cement','4.6','42','Active'],['Tata Steel','Steel','4.8','31','Active']]}],
  finance:[
    {t:'Collections',cols:['Account','Project','Amount','Mode','Date'],rows:[['Skyline Collections','Skyline','₹42L','RTGS','26 Jun'],['Greenfield','Greenfield','₹28L','Cheque','25 Jun']]},
    {t:'Payables',cols:['Payee','Type','Amount','Due','Status'],rows:[['Shree Const.','Contractor','₹18L','28 Jun','Pending'],['Tata Steel','Supplier','₹9.1L','01 Jul','Scheduled']]},
    {t:'Project P&L',cols:['Project','Revenue','Cost','Margin','Status'],rows:[['Skyline','₹62Cr','₹44Cr','29%','Healthy'],['Riverdale','₹18Cr','₹15Cr','17%','Watch']]}],
  recruitment:[
    {t:'Openings',cols:['Role','Dept','Location','Applicants','Status'],rows:[['Site Engineer','Projects','Mumbai','18','Open'],['Accountant','Finance','Mumbai','12','Open']]},
    {t:'Applicants',cols:['Applicant','Role','Stage','Score','Status'],rows:[['Neha Verma','Site Engineer','Interview L2','82','Active'],['Karan Singh','Accountant','Shortlisted','—','Active']]},
    {t:'Interviews',cols:['Candidate','Role','Round','Date','Panel'],rows:[['Neha Verma','Site Engineer','L2','30 Jun','PMO'],['Rohit S.','Sales Exec','L1','01 Jul','Sales Head']]}],
  maintenance:[
    {t:'Assets',cols:['Asset','Category','Location','Next PM','Status'],rows:[['DG Set 250kVA','Electrical','Skyline','02 Jul','Active'],['Lift 1','Mechanical','Greenfield','—','Under Repair']]},
    {t:'PM Schedule',cols:['Asset','Frequency','Last PM','Next PM','Owner'],rows:[['DG Set','Monthly','02 Jun','02 Jul','Facility'],['STP','Weekly','24 Jun','01 Jul','Facility']]},
    {t:'Breakdowns',cols:['Ticket','Asset','Issue','Raised','Status'],rows:[['BD-22','Lift 1','Door fault','Today','Open'],['BD-21','Pump 3','Leak','Yesterday','Closed']]}],
  reports:[
    {t:'Dashboards',cols:['Report','Module','Type','Last Run','Owner'],rows:[['Collections vs Demand','CRM','Dashboard','Today','You'],['Stock Variance','Inventory','Dashboard','Yesterday','You']]},
    {t:'Reconciliations',cols:['Reconciliation','Module','Variance','Status','Run'],rows:[['Cash vs Ledger','Finance','₹0','Matched','Today'],['GRN vs PO','Procurement','2 items','Review','Today']]},
    {t:'Scheduled',cols:['Report','Frequency','Next Run','Format','Owner'],rows:[['MIS Pack','Weekly','Mon 9 AM','PDF','You'],['Sales Funnel','Daily','6 PM','Excel','Sales']]}],
  gtd:[
    {t:'Inbox',cols:['Item','Captured','Source','Clarify?','Status'],rows:[['Email from RERA','Today','Mail','Yes','New'],['Site note — crack A','Today','Site','Yes','New']]},
    {t:'Next Actions',cols:['Action','Context','Project','Due','Status'],rows:[['Finalise RERA filing','@office','Skyline','Today','Next'],['Call consultant','@calls','Riverdale','Tomorrow','Next']]},
    {t:'Waiting On',cols:['Item','Waiting on','Since','Project','Follow-up'],rows:[['Soil report','Geotech lab','3 days','Riverdale','Tomorrow'],['Loan sanction','HDFC','1 wk','—','Fri']]},
    {t:'Someday',cols:['Idea','Area','Added','Priority','Status'],rows:[['Clubhouse revamp','Skyline','Jun 26','Low','Parked'],['EV charging','All sites','Jun 26','Med','Parked']]}],
  compliance:[
    {t:'Licences',cols:['Item','Type','Authority','Expiry','Status'],rows:[['RERA — Skyline','Registration','MahaRERA','14 Aug','Active'],['Trade Licence','Statutory','BMC','30 Sep','Active']]},
    {t:'Renewals Due',cols:['Item','Expiry','Owner','Reminder','Status'],rows:[['Fire NOC','02 Jul','Admin','Sent','Due Soon'],['Insurance','18 Jul','Finance','Pending','Upcoming']]},
    {t:'NOCs',cols:['NOC','Project','Authority','Status','Date'],rows:[['Fire NOC','Greenfield','Fire Dept','Approved','Jun 26'],['Env NOC','Riverdale','SEIAA','In Process','—']]}],
  campaigns:[
    {t:'Campaigns',cols:['Campaign','Channel','Spend','Leads','CPL'],rows:[['Skyline Launch','Meta','₹3.2L','186','₹172'],['Festive Offer','Google','₹2.1L','142','₹148']]},
    {t:'Channels',cols:['Channel','Spend','Leads','CPL','ROAS'],rows:[['Meta','₹3.2L','186','₹172','4.6x'],['Google','₹2.1L','142','₹148','4.1x']]},
    {t:'Lead Sources',cols:['Source','Leads','Qualified','Booked','Conv%'],rows:[['Meta','186','92','11','5.9%'],['Portals','120','61','7','5.8%']]}],
  scaling:[
    {t:'Priorities',cols:['Priority','Owner','Quarter','Progress','Status'],rows:[['Launch Riverdale Ph-1','Rishi','Q2','45%','On Track'],['Digitise procurement','Ops','Q2','70%','On Track']]},
    {t:'OKRs',cols:['Objective','Key Result','Owner','Target','Progress'],rows:[['Grow bookings','+25% QoQ','Sales','25%','12%'],['Cut cycle time','-15%','Ops','15%','9%']]},
    {t:'Quarterly Rocks',cols:['Rock','Owner','Due','Health','Status'],rows:[['CRM rollout','Sales','Q2','Yellow','At Risk'],['Vendor portal','Procurement','Q2','Green','On Track']]}],
  playbook:[
    {t:'Playbooks',cols:['Playbook','Department','Owner','Version','Updated'],rows:[['Site Handover','Projects','PMO','v3.1','Jun 26'],['Lead to Booking','Sales','CRM Lead','v2.0','May 26']]},
    {t:'SOPs',cols:['SOP','Process','Owner','Version','Status'],rows:[['Indent raising','Procurement','Purchase','v1.4','Active'],['Visitor entry','Admin','Security','v1.1','Active']]},
    {t:'Checklists',cols:['Checklist','Frequency','Owner','Items','Status'],rows:[['Site safety','Daily','Site','18','Active'],['Sales kit','Per lead','Sales','9','Active']]}],
  intranet:[
    {t:'Announcements',cols:['Title','Type','Posted by','Date','Pinned'],rows:[['Diwali calendar','Notice','HR','24 Jun','Yes'],['New Mumbai office','News','MD Office','18 Jun','Yes']]},
    {t:'Policies',cols:['Policy','Category','Owner','Version','Updated'],rows:[['Travel policy','HR','Admin','v2','Jun 26'],['IT usage','IT','IT','v1.3','May 26']]},
    {t:'Directory',cols:['Name','Department','Designation','Location','Ext'],rows:[['Rishi Jain','Management','Director','HO','101'],['Prerna Gupta','Strategy','Business Analyst','HO','118']]}],

  video:[
    {t:'All Videos',cols:['Title','Category','Duration','Views','Added'],rows:[['Skyline drone walkthrough','Site','6:24','312','Jun 26'],['How to raise an indent','SOP','3:10','188','Jun 26']]},
    {t:'Categories',cols:['Category','Videos','Views','Hours','Updated'],rows:[['Site','22','540','4.1','Jun 26'],['SOP','18','410','2.8','Jun 26']]},
    {t:'Playlists',cols:['Playlist','Videos','For','Views','Status'],rows:[['Onboarding','6','New joiners','220','Active'],['Safety','9','Site staff','405','Active']]}],
  customer:[
    {t:'My Bookings',cols:['Customer','Unit','Stage','Next Due','Status'],rows:[['Rahul Mehta','Skyline A-1204','Booked','₹4.2L · 30 Jun','Active'],['Priya Shah','Greenfield B-803','Registered','—','Active']]},
    {t:'Payments',cols:['Customer','Milestone','Amount','Due','Status'],rows:[['Rahul Mehta','On RCC F10','₹4.2L','30 Jun','Pending'],['Amit Patel','On Possession','₹6.0L','—','Upcoming']]},
    {t:'Documents',cols:['Customer','Document','Type','Shared','Status'],rows:[['Rahul Mehta','Allotment Letter','PDF','24 Jun','Available'],['Priya Shah','Agreement','PDF','—','Pending']]}],
  supplier:[
    {t:'Purchase Orders',cols:['Supplier','PO No','Amount','Status','Due'],rows:[['ACC Cement','PO-0042','₹4.2L','Approved','01 Jul'],['Tata Steel','PO-0041','₹9.1L','Dispatched','28 Jun']]},
    {t:'Invoices',cols:['Supplier','Invoice','Amount','Status','Due'],rows:[['Tata Steel','INV-2291','₹9.1L','Submitted','10 Jul'],['Pidilite','INV-2287','₹1.3L','Paid','—']]},
    {t:'GRNs',cols:['GRN','PO','Items','Date','Status'],rows:[['GRN-091','PO-0042','Cement x500','26 Jun','Accepted'],['GRN-090','PO-0041','Steel x20MT','25 Jun','QC Pending']]}],
  whatsapp:[
    {t:'Flows',cols:['Flow','Trigger','Sent','Delivered','Replies'],rows:[['Payment reminder','Due date','420','410','96'],['Site visit confirm','Booking','188','185','142']]},
    {t:'Broadcasts',cols:['Broadcast','Audience','Sent','Read','Date'],rows:[['New launch blast','All leads','1900','1368','24 Jun'],['Festive offer','Customers','820','602','20 Jun']]},
    {t:'Subscribers',cols:['Name','Number','Tag','Opted In','Last Msg'],rows:[['Rahul Mehta','+91•••210','Lead','Yes','Today'],['Amit Patel','+91•••884','Customer','Yes','2 days']]}],
  mail:[
    {t:'Inbox',cols:['From','Subject','Folder','Date','Status'],rows:[['MahaRERA','Filing acknowledgement','Compliance','Today','Unread'],['Tata Steel','Invoice INV-2291','Accounts','Today','Flagged']]},
    {t:'Sent',cols:['To','Subject','Folder','Date','Status'],rows:[['Rahul Mehta','Possession date','Sales','Today','Sent'],['Shree Const.','WO-118 approval','Projects','Yesterday','Sent']]},
    {t:'Flagged',cols:['From','Subject','Reason','Date','Status'],rows:[['Tata Steel','Invoice INV-2291','Payment due','Today','Open'],['HDFC','Loan sanction','Follow-up','Yesterday','Open']]}],
  control:[
    {t:'Users',cols:['User','Email','Level','Tabs','Status'],rows:[['Administrator','ayushruia1@…','Manager','All','Active'],['Prerna Gupta','businessanalyst@…','Employee','12','Active']]},
    {t:'Roles & Access',cols:['Role','Members','Modules','Scope','Status'],rows:[['Manager','3','All','Company','Active'],['Employee','5','Assigned','Dept','Active']]},
    {t:'Integrations',cols:['Integration','Type','Status','Updated','By'],rows:[['Resend','Email','Connected','Jun 26','Admin'],['Amazon S3','Storage','Connected','Jun 26','Admin']]},
    {t:'Audit Log',cols:['Event','User','Module','Time','IP'],rows:[['Access updated','Administrator','Security','10:24','•••'],['Login','Prerna Gupta','Auth','09:50','•••']]}],
};

MODMETA.construction=MODMETA.projects;MODTABS.construction=MODTABS.projects;
VIEWS.placeholder=function(v,seg){
  const mod=PAGE;const m=MODMETA[mod];
  if(!m){v.innerHTML='<div class="empty"><i class="fa-solid fa-cube"></i><div>Module not found</div></div>';return;}
  setCrumb(['Home',LABELS[mod]||mod]);
  if(m.locked){
    v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid '+m.icon+'" style="color:'+m.c+'"></i> '+(LABELS[mod])+'</h1><p>'+m.desc+'</p></div></div>'+
    '<div class="card card-pad empty"><i class="fa-solid fa-lock"></i><div style="font-weight:600;font-size:15px;color:var(--ink)">Restricted Module</div><p style="max-width:420px;margin:8px auto 0">This is a director-only area. Your account does not have super-admin access. Contact a director to request access.</p></div>';
    return;
  }
  const tabs=MODTABS[mod]||[{t:'Recent Records',cols:m.cols,rows:m.rows}];
  let ti=parseInt((seg&&seg[0]));if(isNaN(ti)||ti<0||ti>=tabs.length)ti=0;
  const tab=tabs[ti];
  v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid '+m.icon+'" style="color:'+m.c+'"></i> '+(LABELS[mod])+'</h1><p>'+m.desc+'</p></div>'+
   '<div style="display:flex;gap:10px"><button class="btn"><i class="fa-solid fa-filter"></i> Filter</button><button class="btn btn-primary"><i class="fa-solid fa-plus"></i> New</button></div></div>'+
   '<div class="grid kpis">'+m.kpis.map(k=>'<div class="kpi"><div class="top"><div class="ic" style="background:'+m.bg+';color:'+m.c+'"><i class="fa-solid '+k[2]+'"></i></div></div><div class="val">'+k[1]+'</div><div class="lbl">'+k[0]+'</div></div>').join('')+'</div>'+
   '<div class="tabs" style="margin-top:18px;margin-bottom:0">'+tabs.map((x,i)=>'<div class="tab '+(i===ti?'active':'')+'" onclick="navTo(\''+mod+'/'+i+'\')">'+esc(x.t)+'</div>').join('')+'</div>'+
   '<div class="card" style="border-top-left-radius:0"><div class="card-pad" style="border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center"><div class="sec-title" style="margin:0">'+esc(tab.t)+'</div><span class="tag t-blue"><i class="fa-solid fa-circle-info"></i> Sample data</span></div>'+
   '<table><thead><tr>'+tab.cols.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+tab.rows.map(r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
};
['construction','procurement','reports'].forEach(m=>VIEWS[m]=VIEWS.placeholder);

