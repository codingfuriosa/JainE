VIEWS.compliance=function(v,seg){
  setCrumb(['Governance','Renewals & Compliance']);
  const tabs=['Compliance calendar','Licences repository','Warranties & guarantees'];const ti=mTab(seg,tabs.length);
  const kpis=[['Due in 30 days','14',''],['Overdue','2','action needed','#c83232'],['Licences tracked','58',''],['AMCs active','23','']];
  let body;
  if(ti===0){ body='<p style="color:var(--slate);font-size:13px;margin:6px 0 14px">Statutory and contractual due dates (RERA QPR, GST, TDS, PF/ESI/PT, labour, fire, lift, environment) with owners. Alerts surface into My Tasks and e-mail reminders.</p>'+mTable(['Due date','Obligation','Category','Owner','Status'],[['07 Jul','Salary TDS deposit','Statutory · TDS','Finance','<span class="tag t-amber">Pending</span>'],['10 Jul','Professional Tax (MP)','Statutory · PT','HR','<span class="tag t-amber">Pending</span>'],['11 Jul','GST GSTR-3B','Statutory · GST','Finance','<span class="tag t-blue">Scheduled</span>'],['15 Jul','PF + ESI deposit','Statutory · Labour','HR','<span class="tag t-purple">Computed</span>']]); }
  else if(ti===1){ body=mTable(['Licence','Authority','Project','Expiry','Status'],[['RERA — Dream Valley','MahaRERA','Dream Valley','14 Aug','Active'],['Fire NOC','Fire Dept','Jain Heights','02 Jul','Due soon']]); }
  else { body=mTable(['Item','Asset','Provider','Expiry','Status'],[['Lift AMC','Passenger lift','OTIS','Mar-27','Active'],['DG warranty','DG Set 250 kVA','Cummins','Dec-26','Active']]); }
  v.innerHTML=mHead('fa-calendar-check','#b45309','Renewals & Compliance')+mKpis(kpis)+mTabs('compliance',tabs,ti)+'<div style="margin-top:14px">'+body+'</div>';
};