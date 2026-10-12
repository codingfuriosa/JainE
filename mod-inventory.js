VIEWS.inventory=async function(v,seg){
  setCrumb(['Operations','Inventory']);
  const isAdmin=typeof window.pusIsAdmin==='function'&&await window.pusIsAdmin();
  const tabs=['Setup','Vendors','Indents','RFQ & Quotes','Purchase orders','Stores','Stock & reports'].concat(isAdmin?['Admin']:[]);const ti=mTab(seg,tabs.length);
  if(ti===0){
    // Purchase & Stores setup (items, groups, UOM, warehouses, legal entities) lives in purchase.js -
    // see PAGE_EXTRA_SCRIPT and docs/purchase-stores-spec.md.
    v.innerHTML=mHead('fa-boxes-stacked','#0f766e','Inventory & Procurement')+mTabs('inventory',tabs,ti)+'<div id="pusBody" style="margin-top:16px"></div>';
    const host=$('pusBody');
    if(typeof window.pusRender!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Purchase setup could not finish loading - refresh the page.</div></div>'; return; }
    await window.pusRender(host,seg.slice(1));
    return;
  }
  if(ti===1){
    // Vendor enlistment (Stage 2) - also in purchase.js.
    v.innerHTML=mHead('fa-boxes-stacked','#0f766e','Inventory & Procurement')+mTabs('inventory',tabs,ti)+'<div id="pusBody" style="margin-top:16px"></div>';
    const host=$('pusBody');
    if(typeof window.pusVendorRender!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Vendors could not finish loading - refresh the page.</div></div>'; return; }
    await window.pusVendorRender(host);
    return;
  }
  if(ti===2){
    // Indents and their approval (Stage 3) - purchase-indent.js.
    v.innerHTML=mHead('fa-boxes-stacked','#0f766e','Inventory & Procurement')+mTabs('inventory',tabs,ti)+'<div id="pusBody" style="margin-top:16px"></div>';
    const host=$('pusBody');
    if(typeof window.pusIndentRender!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Indents could not finish loading - refresh the page.</div></div>'; return; }
    await window.pusIndentRender(host,seg.slice(1));
    return;
  }
  if(ti===7){
    // Purchase administrators only (approvers, warehouses, legal entities, who the administrators are) -
    // the tab is only listed for them, and the database refuses these writes to anyone else.
    v.innerHTML=mHead('fa-boxes-stacked','#0f766e','Inventory & Procurement')+mTabs('inventory',tabs,ti)+'<div id="pusBody" style="margin-top:16px"></div>';
    await window.pusRender($('pusBody'),seg.slice(1),'admin');
    return;
  }
  if(ti===3){
    // RFQs and quotations (Stage 4) - purchase-rfq.js.
    v.innerHTML=mHead('fa-boxes-stacked','#0f766e','Inventory & Procurement')+mTabs('inventory',tabs,ti)+'<div id="pusBody" style="margin-top:16px"></div>';
    const host=$('pusBody');
    if(typeof window.pusRfqRender!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>RFQs could not finish loading - refresh the page.</div></div>'; return; }
    await window.pusRfqRender(host,seg.slice(1));
    return;
  }
  if(ti===4){
    // Purchase orders (Stage 5) - purchase-po.js.
    v.innerHTML=mHead('fa-boxes-stacked','#0f766e','Inventory & Procurement')+mTabs('inventory',tabs,ti)+'<div id="pusBody" style="margin-top:16px"></div>';
    const host=$('pusBody');
    if(typeof window.pusPoRender!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Purchase orders could not finish loading - refresh the page.</div></div>'; return; }
    await window.pusPoRender(host,seg.slice(1));
    return;
  }
  if(ti===5){
    // Stores (Stage 6): GRN, returns, issues, adjustments, transfers - purchase-stores.js.
    v.innerHTML=mHead('fa-boxes-stacked','#0f766e','Inventory & Procurement')+mTabs('inventory',tabs,ti)+'<div id="pusBody" style="margin-top:16px"></div>';
    const host=$('pusBody');
    if(typeof window.pusStoresRender!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Stores could not finish loading - refresh the page.</div></div>'; return; }
    await window.pusStoresRender(host,seg.slice(1));
    return;
  }
  if(ti===6){
    // Stock ledger and current stock (Stage 6) - purchase-stores.js.
    v.innerHTML=mHead('fa-boxes-stacked','#0f766e','Inventory & Procurement')+mTabs('inventory',tabs,ti)+'<div id="pusBody" style="margin-top:16px"></div>';
    const host=$('pusBody');
    if(typeof window.pusLedgerRender!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>The stock ledger could not finish loading - refresh the page.</div></div>'; return; }
    await window.pusLedgerRender(host,seg.slice(1));
    return;
  }
};

/* ===== PROCUREMENT MODULE ===== */