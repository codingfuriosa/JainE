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