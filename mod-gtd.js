VIEWS.gtd=function(v,seg){
  setCrumb(['Sales','GTD']);
  const tabs=['Inbox','Next actions','Projects','Waiting for','Someday / Maybe','Weekly review'];const ti=mTab(seg,tabs.length);
  const kpis=[['Inbox to clarify','5','capture is clean','#16855a'],['Next actions','14','across 5 contexts'],['Active projects','6','each has a next step'],['Waiting for','4','oldest 9 days','#e08600']];
  let body;
  if(ti===0){
    body='<div class="card card-pad"><p style="color:var(--slate);font-size:13px;margin-bottom:12px">Capture first, decide later. Each item gets clarified into a next action, project, waiting-for, someday, or done.</p><div style="display:flex;gap:10px;margin-bottom:14px"><input class="sel" style="flex:1;height:42px" placeholder="Capture anything on your mind…"><button class="btn btn-primary"><i class="fa-solid fa-plus"></i> Capture</button></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Captured item</th><th>Clarify into</th></tr></thead><tbody>'+
      ['Idea: loyalty referral scheme for buyers','Mr. Agarwal asked about parking — follow up','Broker agreement template needs legal review'].map(it=>'<tr><td>'+esc(it)+'</td><td><div style="display:flex;gap:6px;flex-wrap:wrap">'+['Next action','Project','Waiting','Someday','Done'].map(b=>'<button class="btn btn-sm">'+b+'</button>').join('')+'</div></td></tr>').join('')+'</tbody></table></div></div>';
  } else if(ti===1){ body=mTable(['Next action','Context','Project','Due'],[['Call structural consultant','@calls','Dream Valley','Today'],['Finalise RERA filing','@office','Skyline','Tomorrow']]); }
  else if(ti===2){ body=mTable(['Project','Next step','Owner','Status'],[['Riverdale launch','Approve creatives','You','Active'],['Vendor portal','Spec sign-off','Ops','Active']]); }
  else if(ti===3){ body=mTable(['Waiting on','Item','Since','Follow-up'],[['Geotech lab','Soil report','3 days','Tomorrow'],['HDFC','Loan sanction','1 wk','Fri']]); }
  else if(ti===4){ body=mTable(['Idea','Area','Added'],[['Clubhouse revamp','Skyline','Jun 26'],['EV charging','All sites','Jun 26']]); }
  else { body=mTable(['Review step','Status'],[['Clear inbox','Done'],['Review next actions','Pending'],['Review projects','Pending']]); }
  v.innerHTML=mHead('fa-brain','#7c3aed','GTD')+mKpis(kpis)+mTabs('gtd',tabs,ti)+'<div style="margin-top:14px">'+body+'</div>';
};

/* CRM & SALES IS DAILY UPDATES, AND NOTHING ELSE.

   There used to be nine tabs. Eight of them were a demonstration: Pipeline & funnel drew a
   conversion chart out of invented numbers, Leads and Comm history listed two people who do not
   exist, Bookings and Demands one each, Brokers a firm called Skyline Realty, and the remaining
   two said they were being built. None of them read anything. Somebody looking at "428 leads,
   61 bookings" had no way of telling it was a mock-up, which is worse than an empty screen -
   an empty screen at least tells the truth.

   Daily Updates is the one that is real: the Qualified / Site Visits / Agent Visits rollup the
   daily-crm-updates task pulls out of RealtyBucket every morning. With it alone there is nothing
   to tab between, so the tab strip is gone too and the page opens straight onto it. The Open
   button still goes to RealtyBucket, which is where the actual CRM work happens. */