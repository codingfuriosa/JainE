VIEWS.finance=function(v){
  setCrumb(['Governance','Finance Vault']);
  const kpis=[['Collections (FY)','₹121 Cr',''],['Outstanding dues','₹4.1 Cr',''],['Payables open','₹2.6 Cr','37 POs'],['Net group cash','₹13.5 Cr','']];
  const roll=(title,rows)=>'<div class="card card-pad"><div class="sec-title" style="margin:0 0 12px">'+title+'</div>'+rows.map(r=>'<div style="display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid var(--line-2)"><span>'+esc(r[0])+'</span><b>'+esc(r[1])+'</b></div>').join('')+'</div>';
  v.innerHTML=mHead('fa-indian-rupee-sign','#15803d','Finance Vault')+
    '<div class="card card-pad" style="background:#fffbeb;border-color:#f0dfa8;margin-bottom:16px;font-size:13.5px"><i class="fa-solid fa-lock" style="color:#d98a00"></i> <b>Super-admin only.</b> Every table here is gated by RLS to the director role; the publishable key cannot read it.</div>'+
    mKpis(kpis)+
    '<div class="m2grid">'+roll('Collections roll-up (from CRM)',[['Dream Valley Ph-2','₹48.0 Cr'],['Jain Heights','₹39.5 Cr'],['Green Acres','₹28.0 Cr'],['Trade Centre','₹18.5 Cr'],['Royal Enclave','₹7.8 Cr']])+roll('Payables roll-up (from Procurement)',[['Contractor RA bills','₹1.42 Cr'],['Material POs','₹0.78 Cr'],['Service work orders','₹0.26 Cr'],['Vendor advances','₹0.14 Cr']])+'</div>';
};