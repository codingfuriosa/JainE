VIEWS.mail=function(v,seg){
  setCrumb(['Stakeholder Portals',"Naren's Mail"]);
  const kpis=[['Unread','12',''],['Needs action','7','AI-flagged','#c83232'],['Awaiting approval','3',''],['Auto-summarised','100%','by AI','#16855a']];
  const folders=[['Needs action',3,true],['Awaiting approval',3],['Customers',2],['FYI / digest',2]];
  const fol='<div class="card card-pad" style="height:fit-content">'+folders.map(f=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 11px;border-radius:8px;margin-bottom:4px;font-size:13px;font-weight:500;'+(f[2]?'background:#0a2640;color:#fff':'color:var(--ink)')+'"><span>'+esc(f[0])+'</span><span style="opacity:.7">'+f[1]+'</span></div>').join('')+'</div>';
  const mail=(from,init,subj,prev,tag,tagc,time,btns)=>'<div style="padding:14px 0;border-bottom:1px solid var(--line-2)"><div style="display:flex;justify-content:space-between;gap:10px"><div style="display:flex;gap:11px"><span class="avatar-sm" style="background:#0a2640">'+init+'</span><div><div style="font-weight:700;font-size:13.5px">'+esc(from)+'</div><div style="font-size:13px;margin-top:2px">'+esc(subj)+'</div><div style="font-size:12px;color:var(--slate);margin-top:2px">'+esc(prev)+'</div></div></div><div style="text-align:right;white-space:nowrap"><span class="tag '+tagc+'">'+tag+'</span><div style="font-size:11px;color:#94a3b8;margin-top:4px">'+time+'</div></div></div><div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;margin-left:42px">'+btns.map(b=>'<button class="btn btn-sm'+(b[1]?' btn-primary':'')+'">'+b[0]+'</button>').join('')+'</div></div>';
  const list='<div class="card card-pad"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div class="sec-title" style="margin:0">Needs action</div><span class="tag t-gray">3 messages</span></div>'+
    mail('BuildWell Constr.','BW','RA bill RA-0312-05 submitted — please approve','Net payable enclosed for Tower C, Jun 16-30…','Approve','t-amber','2h',[['+ AI summary'],['↩ Reply'],['→ raise approval in Projects',true]])+
    mail('R. Agarwal','RA','Re: Registration date for DV-C-1204','Can we confirm the sub-registrar slot for next week?','Reply + task','t-blue','4h',[['+ AI summary'],['↩ Reply'],['+ task',true]])+'</div>';
  v.innerHTML=mHead('fa-envelope','#475569',"Naren's Mail")+
    '<div class="card card-pad" style="background:#eff4ff;border-color:#cfe0ef;margin-bottom:16px;font-size:13.5px"><i class="fa-solid fa-envelope"></i> Connected mailbox: <b>naren@thejaingroup.com</b> (demo). AI triage labels each mail and proposes the next action; converting a mail writes back into Accountability / CRM / Procurement via RPC.</div>'+
    mKpis(kpis)+'<div class="grid" style="grid-template-columns:210px 1fr;gap:16px;margin-top:16px">'+fol+list+'</div>';
};

/* ============================ TRANSCRIPTION ============================ */
/* Upload a recording -> stored in S3 (portal/transcription/) -> transcribed
   & analysed by Gladia (Hindi / English / Bengali, code-switching aware) via
   the `transcription-analyze` edge function. Results land in acc.transcriptions. */