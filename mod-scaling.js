VIEWS.scaling=function(v,seg){
  setCrumb(['Growth & Strategy','Scaling Up']);
  const tabs=['Strategy (OPSP)','Priorities (Rocks)','KPI scoreboard','Meeting rhythm','Learning hub'];const ti=mTab(seg,tabs.length);
  let body;
  if(ti===0){
    const txt=(t,b)=>'<div class="card card-pad"><div class="sec-title" style="margin:0 0 8px">'+t+'</div><p style="color:#3C4B59;font-size:13.5px;line-height:1.5">'+b+'</p></div>';
    const lst=(t,rows)=>'<div class="card card-pad"><div class="sec-title" style="margin:0 0 4px">'+t+'</div>'+rows.map(r=>'<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line-2)"><span style="color:var(--slate)">'+esc(r[0])+'</span><b>'+esc(r[1])+'</b></div>').join('')+'</div>';
    body='<div class="m3grid">'+txt('Core purpose','Building landmark spaces that families and businesses are proud to own.')+txt('Core values','Integrity · Quality · On-time delivery · Customer-first · Discipline.')+txt('BHAG (10-yr)','Be Central India’s most-trusted developer — 10,000 homes delivered, zero RERA defaults.')+
      lst('3-yr target',[['Revenue','₹450 Cr'],['Active projects','10'],['Units / yr','600']])+lst('1-yr plan (FY26-27)',[['Revenue','₹165 Cr'],['Bookings','260 units'],['Collections','92%+']])+lst('Brand promise KPIs',[['On-time handover','≥ 95%'],['CSAT','≥ 4.5 / 5'],['Snag closure','≤ 7 days']])+'</div>';
  } else if(ti===1){ body=mTable(['Rock','Owner','Quarter','Progress','Status'],[['Launch Riverdale Ph-1','Rishi','Q2','45%','On Track'],['Digitise procurement','Ops','Q2','70%','On Track']]); }
  else if(ti===2){ body=mTable(['KPI','Target','Actual','Status'],[['On-time handover','≥95%','93%','Watch'],['CSAT','≥4.5','4.6','Good']]); }
  else if(ti===3){ body=mTable(['Meeting','Cadence','Owner','Next'],[['Daily huddle','Daily','Ops','Tomorrow'],['Weekly L10','Weekly','Leadership','Mon']]); }
  else { body=mTable(['Resource','Type','Added'],[['Scaling Up (Verne Harnish)','Book','Jun 26'],['OKR masterclass','Course','May 26']]); }
  v.innerHTML=mHead('fa-arrow-trend-up','#0d9488','Scaling Up')+mTabs('scaling',tabs,ti)+'<div style="margin-top:16px">'+body+'</div>';
};