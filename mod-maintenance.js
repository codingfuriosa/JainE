VIEWS.maintenance=function(v,seg){
  setCrumb(['Operations','Assets & Maintenance']);
  const tabs=['Asset register','Preventive maintenance','Breakdowns & repairs','Location-wise'];const ti=mTab(seg,tabs.length);
  const kpis=[['Total assets','311','6 sites'],['Active','291','94%','#16855a'],['Under repair','4','2 overdue','#c83232'],['PM due (7 days)','12','across sites','#e08600']];
  let body;
  if(ti===0){ body=mTable(['Tag','Asset','Category','Location','Status','Warranty'],[['AST-0112','DG Set 250 kVA','Mechanical','Dream Valley','<span class="tag t-green">Active</span>','Till Mar-27'],['AST-0113','Passenger lift — Tower B','Mechanical','Jain Heights','<span class="tag t-red">Under repair</span>','AMC active'],['AST-0114','Tower crane','Civil','Dream Valley','<span class="tag t-green">Active</span>','Leased'],['AST-0115','Site office HVAC','Electrical','Trade Centre','<span class="tag t-green">Active</span>','Till Dec-26'],['AST-0116','Survey total station','IT','Green Acres','<span class="tag t-gray">Idle</span>','Expired']]); }
  else if(ti===1){ body=mTable(['Asset','Frequency','Last PM','Next PM','Owner'],[['DG Set 250 kVA','Monthly','02 Jun','02 Jul','Facility']]); }
  else if(ti===2){ body=mTable(['Ticket','Asset','Issue','Raised','Status'],[['BD-22','Passenger lift','Door fault','Today','Open']]); }
  else { body=mTable(['Location','Assets','Active','Under repair'],[['Dream Valley','86','80','3'],['Jain Heights','54','50','1']]); }
  v.innerHTML=mHead('fa-screwdriver-wrench','#7c3aed','Assets & Maintenance')+mKpis(kpis)+mTabs('maintenance',tabs,ti)+'<div style="margin-top:14px">'+body+'</div>';
};

/* ---------- INTERNET SPEED MONITOR ----------
   Reads the net_* tables (public schema) populated by the office laptops'
   speed-monitor agent. Read-only: RLS lets any signed-in user SELECT these. */