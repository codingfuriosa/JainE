VIEWS.supplier=function(v,seg){
  setCrumb(['Stakeholder Portals','Supplier Portal']);
  const tabs=['RFQs to respond','My POs / WOs','Invoices & RA bills','Payments','KYC & documents'];const ti=mTab(seg,tabs.length);
  const kpis=[['Open RFQs','2','awaiting your quote'],['Active POs','3',''],['Invoices pending','1','under 3-way match'],['Payments due','₹1.78 L','next 15 days','#16855a']];
  let body;
  if(ti===0){ body=mTable(['RFQ','Material','Qty','Project','Respond by','Status'],[['IND-0512','OPC 53 cement','400 bags','Dream Valley','29 Jun','<span class="tag t-amber">Open</span>'],['IND-0515','Waterproof compound','60 drums','Green Acres','01 Jul','<span class="tag t-amber">Open</span>']])+'<div style="margin-top:14px"><button class="btn btn-primary"><i class="fa-solid fa-plus"></i> Submit quote</button></div>'; }
  else if(ti===1){ body=mTable(['PO / WO','Item','Amount','Status','Date'],[['PO-0042','OPC 53 cement','₹4.2L','Dispatched','25 Jun']]); }
  else if(ti===2){ body=mTable(['Invoice','Against','Amount','Status','Due'],[['INV-2291','PO-0042','₹9.1L','3-way match','10 Jul']]); }
  else if(ti===3){ body=mTable(['Payment','Invoice','Amount','Mode','Date'],[['PMT-118','INV-2287','₹1.3L','RTGS','Paid']]); }
  else { body=mTable(['Document','Type','Status','Expiry'],[['GST certificate','KYC','Verified','—'],['PAN','KYC','Verified','—']]); }
  v.innerHTML=mHead('fa-truck','#0f766e','Supplier Portal')+
    '<div class="card card-pad" style="background:#fffbeb;border-color:#f0dfa8;margin-bottom:16px;font-size:13.5px"><i class="fa-solid fa-truck"></i> Signed in as <b>Shakti RMC</b> (vendor). Suppliers see only their own RFQs, POs and payments — same <b>core.parties</b> master, separate tokenised login.</div>'+
    mKpis(kpis)+mTabs('supplier',tabs,ti)+'<div style="margin-top:14px">'+body+'</div>';
};