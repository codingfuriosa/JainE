function mStep(steps,active){const ai=steps.indexOf(active);return '<div class="mstep">'+steps.map((s,i)=>'<span class="mstep-i'+(s===active?' on':(i<ai?' done':''))+'">'+esc(s)+'</span>'+(i<steps.length-1?'<span class="mstep-a">→</span>':'')).join('')+'</div>';}
function mCard(title,inner){return '<div class="card card-pad"><div class="sec-title" style="margin:0 0 12px">'+esc(title)+'</div>'+inner+'</div>';}
VIEWS.playbook=function(v,seg){
  setCrumb(['Growth & Strategy','Playbook']);
  const tabs=['All plays','Featured play','Roles (RACI)'];const ti=mTab(seg,tabs.length);
  let body;
  if(ti===0){
    const pills=['All','Sales','Projects','Procurement','HR','Finance','Legal'].map((p,i)=>'<button class="btn btn-sm'+(i===0?' btn-primary':'')+'">'+p+'</button>').join(' ');
    body='<div class="card card-pad"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px"><div style="flex:1;min-width:170px"><input class="sel" style="width:100%;height:38px" placeholder="Search plays…"></div>'+pills+'</div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Play</th><th>Department</th><th>Steps</th><th>Owner</th><th>Runs in</th><th>Status</th></tr></thead><tbody>'+
      [['Lead → Booking','Sales','8','Sales Head','CRM','<span class="tag t-green">Live · v3</span>'],['Booking → Registration','Sales / Legal','7','Sales Head','CRM + Legal','<span class="tag t-green">Live · v2</span>'],['Indent → Goods receipt','Procurement','6','Procurement Mgr','Procurement','<span class="tag t-green">Live · v2</span>'],['Contractor onboarding','Procurement / Legal','5','Procurement Mgr','Procurement','<span class="tag t-green">Live · v1</span>'],['Stage handover (unit)','Projects','6','Projects Head','Projects','<span class="tag t-green">Live · v2</span>'],['Hire → Induct','HR','9','HR Manager','Recruitment + HR','<span class="tag t-green">Live · v2</span>'],['Monthly compliance close','Finance / Legal','7','CFO','Compliance','<span class="tag t-green">Live · v1</span>'],['Demand → Collection','Finance','5','CFO','CRM + Finance','<span class="tag t-amber">Draft · v1</span>']].map(r=>'<tr><td><b>'+r[0]+'</b></td><td>'+r[1]+'</td><td>'+r[2]+'</td><td>'+r[3]+'</td><td>'+r[4]+'</td><td>'+r[5]+'</td></tr>').join('')+'</tbody></table></div></div>';
  } else if(ti===1){ body=mCard('Featured play — Lead → Booking',mStep(['Capture','Qualify','Site visit','Negotiate','Token','Booking','Agreement','Register'],'Site visit')); }
  else { body=mTable(['Step','Responsible','Accountable','Consulted','Informed'],[['Site visit','Sales Exec','Sales Head','CRM','Director'],['Booking','Sales Head','Director','Finance','Legal']]); }
  v.innerHTML=mHead('fa-book-open','#4338ca','Playbook')+mTabs('playbook',tabs,ti)+'<div style="margin-top:16px">'+body+'</div>';
};

/* ---------- COMPETITOR ADS — Meta Ad Library watchlist ---------- */
// Tracks a fixed watchlist of competitors against Meta's public Ad Library, scraped by our own
// Playwright-based Apify Actor (not the official ads_archive API, which never exposes spend/reach
// for ordinary commercial ads) via the competitor-ads-sync edge function. Sourced from
// camp.competitor_watchlist / camp.competitor_ads.