VIEWS.whatsapp=function(v,seg){
  setCrumb(['Stakeholder Portals','WhatsApp Bot']);
  const tabs=['Live demo','Intents & flows','Broadcasts & templates','Conversations','Analytics'];const ti=mTab(seg,tabs.length);
  let body;
  if(ti===0){
    const roles=['Customer','Prospective buyer (lead)','Supplier / contractor','Employee','Prospective employee'].map((r,i)=>'<button class="btn'+(i===0?' btn-primary':'')+'" style="width:100%;justify-content:flex-start;margin-bottom:8px">'+r+'</button>').join('');
    body='<div class="grid" style="grid-template-columns:1.6fr 1fr;gap:16px"><div class="card" style="background:#e5ddd5;min-height:340px;padding:18px"><div style="background:#fff;border-radius:10px;padding:13px 15px;max-width:80%;font-size:13.5px;box-shadow:0 1px 2px rgba(0,0,0,.1)">Hi! I can share your payment status, construction progress, demand due dates and receipts, or log a service request. <span style="color:var(--slate)">(Demo: for DV-C-1204, 25% paid, next demand ₹17.7 L due 05 Jul, Tower C 62% complete.)</span></div></div>'+
      '<div><div class="card card-pad"><div class="sec-title" style="margin:0 0 12px">I am a…</div>'+roles+'</div><div class="card card-pad" style="margin-top:14px;background:#fffbeb;border-color:#f0dfa8;font-size:12.5px"><i class="fa-solid fa-lock" style="color:#d98a00"></i> The bot answers only from approved, non-confidential content and a stakeholder’s own records. It never exposes pricing, salaries or other customers’ data, and escalates to a human ticket when unsure.</div></div></div>';
  } else if(ti===1){ body=mTable(['Intent','Trigger','Flow','Status'],[['Payment status','"balance"','Lookup → reply','Live'],['Site visit','"visit"','Book slot','Live']]); }
  else if(ti===2){ body=mTable(['Broadcast','Audience','Sent','Read','Date'],[['New launch','All leads','1,900','1,368','24 Jun']]); }
  else if(ti===3){ body=mTable(['Contact','Tag','Last message','Status'],[['Suresh Agarwal','Customer','Payment query','Resolved']]); }
  else { body=mTable(['Metric','Value','Trend'],[['Messages (mo)','8.4k','+12%'],['Auto-resolve','94%','+3%']]); }
  v.innerHTML=mHead('fa-comment-dots','#16a34a','WhatsApp Bot')+mTabs('whatsapp',tabs,ti)+'<div style="margin-top:16px">'+body+'</div>';
};