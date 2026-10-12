function mSoon(name){return '<div class="card card-pad empty" style="margin-top:14px"><i class="fa-regular fa-clipboard"></i><div style="font-weight:600;color:var(--ink)">'+esc(name)+'</div><p style="max-width:420px;margin:6px auto 0">This section is being built to match the reference.</p></div>';}

VIEWS.procurement=function(v,seg){
  setCrumb(['Operations','Procurement']);
  const tabs=['Indent','Quote Comp','PO','GRN','Vendor Trends'];const ti=mTab(seg,tabs.length);
  const cat=tabs[ti];
  const subtitle='Indents · Quote Comparison · Purchase Orders · GRN · Vendor Trends';
  PROC.sel.clear();
  if(ti===1){// Quote Comp
    v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-file-invoice" style="color:#0369a1"></i> Procurement</h1><p>${subtitle}</p></div></div>`+
      mTabs('procurement',tabs,ti)+
      `<div style="margin-top:20px">
        <div id="procBar" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px"></div>
        <div id="procHost"></div>
      </div>`;
    procRefresh(cat);
  } else if(ti===4){// Vendor Trends
    v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-file-invoice" style="color:#0369a1"></i> Procurement</h1><p>${subtitle}</p></div></div>`+
      mTabs('procurement',tabs,ti)+
      `<div style="margin-top:20px" id="vtHost"></div>`;
    procVendorTrendsRender();
  } else {
    v.innerHTML=`<div class="page-head"><div><h1><i class="fa-solid fa-file-invoice" style="color:#0369a1"></i> Procurement</h1><p>${subtitle}</p></div></div>`+
      mTabs('procurement',tabs,ti)+
      `<div style="margin-top:20px">`+mSoon(cat)+`</div>`;
  }
};

