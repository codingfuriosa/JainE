/* =============================================================================================
   RECKONER, part 2 (21 Nov 2026): Pending Verifications, Audit Log, Compare, Roles. See 60-reckoner.js.
   ============================================================================================= */
function rkFieldLabel(tbl,col){ const f=(RK_F[tbl]||[]).concat(RK_COMMON).find(function(x){ return x[0]===col; }); return f?f[1]:col.replace(/_/g,' '); }
function rkFmtVal(tbl,col,v){
  if(v==null||v==='') return '<span class="rk-na">empty</span>';
  if(typeof v==='boolean') return v?'Yes':'No';
  if(col==='configuration_id'){ const c=(RK.cfg||[]).find(function(x){ return x.id===v; }); return esc(c?c.name:'(configuration)'); }
  if(col==='project_id') return esc(rkProjName(v));
  if(col==='fv_project_ids'){ return esc((Array.isArray(v)?v:[v]).map(function(i){ const p=(RK.fv||[]).find(function(x){ return String(x.id)===String(i); }); return p?p.name:'#'+i; }).join(', ')); }
  if(col==='s3_key') return '<i class="fa-regular fa-file"></i> file';
  if(col==='kind'&&tbl==='charges') return esc(RK_CHARGE_KIND[v]||v);
  if(col==='kind'&&tbl==='sales_notes') return esc(RK_NOTE_KIND[v]||v);
  if(col==='unit') return esc(RK_PER[v]||v);
  if(col==='size_bytes') return esc(fmtBytes(v));
  if(/price|amount|charges$/.test(col)&&typeof v==='number') return rkInr(v);
  return '<span style="white-space:pre-wrap">'+esc(String(v))+'</span>';
}
function rkChgLabel(c,cur){ const r=Object.assign({},cur||{},c.previous||{},c.payload||{}); return r.name||r.title||r.unit_no||r.stage||r.bank||r.email||(r.address?String(r.address).slice(0,50):'')||(r.body?String(r.body).slice(0,50):'')||''; }
async function rkCurrent(rows){
  const by={}; rows.forEach(function(c){ if(c.record_id) (by[c.tbl]=by[c.tbl]||[]).push(c.record_id); });
  const cur={};
  await Promise.all(Object.keys(by).map(function(t){ const ids=Array.from(new Set(by[t]));
    return RKS().from(t).select('*').in('id',ids.slice(0,300)).then(function(r){ (r.data||[]).forEach(function(x){ cur[x.id]=x; }); }); }));
  return cur;
}
const RK_OP={insert:['New','#16a34a','fa-plus'],update:['Change','#2563eb','fa-pen'],archive:['Remove','#dc2626','fa-box-archive']};
function rkDiff(c,cur){
  const keys=Object.keys(c.payload||{}).filter(function(k){ return !(c.tbl!=='projects'&&k==='project_id')&&k!=='file_name'&&k!=='mime'; });
  if(c.op==='archive') return '<div style="font-size:13px;color:#991b1b">Remove this '+esc((RK_TBL_LABEL[c.tbl]||c.tbl).toLowerCase())+' (it is kept in the history).</div>';
  if(!keys.length) return '';
  return '<table class="rk-t" style="margin-top:6px"><tr><th style="width:28%">Field</th>'+(c.op==='update'?'<th>Now</th>':'')+'<th>'+(c.op==='update'?'Proposed':'Value')+'</th></tr>'
    +keys.map(function(k){ const old=c.op==='update'?(c.previous&&k in c.previous?c.previous[k]:(cur&&cur[k])):null;
      return '<tr><td style="color:#475569">'+esc(rkFieldLabel(c.tbl,k))+'</td>'+(c.op==='update'?'<td style="color:#64748b">'+rkFmtVal(c.tbl,k,old)+'</td>':'')+'<td><b>'+rkFmtVal(c.tbl,k,c.payload[k])+'</b></td></tr>'; }).join('')+'</table>';
}

/* ---------------------------------------------------------------- Pending Verifications */
const RK_PSEL=new Set();
async function rkPendingView(){
  const rows=await rkPages(function(){ return RKS().from('changes').select('*').eq('status','pending').order('id'); });
  RK.pendN=rows.length; await rkFv();
  const cur=await rkCurrent(rows);
  window._rkPend=rows; window._rkCur=cur;
  const me=String((state.user&&state.user.email)||'').toLowerCase(), ap=rkCanApprove();
  Array.from(RK_PSEL).forEach(function(id){ if(!rows.some(function(c){ return c.id===id; })) RK_PSEL.delete(id); });
  let h='';
  if(!rows.length) h+='<div class="rk-sec rk-empty"><i class="fa-solid fa-circle-check" style="color:#16a34a"></i> Nothing is waiting for approval.</div>';
  else {
    h+='<div class="rk-bar rk-noprint" style="justify-content:space-between"><div style="font-size:13px;color:#475569">'+rows.length+' waiting · '+(ap?'you can approve':'only approvers can approve; you can withdraw your own')+'</div>'
      +(ap?'<div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="rkSelAll()">Select all</button><button class="btn btn-sm btn-primary" onclick="rkReviewSel(true)" '+(RK_PSEL.size?'':'disabled')+'><i class="fa-solid fa-check"></i> Approve selected ('+RK_PSEL.size+')</button><button class="btn btn-sm" onclick="rkReviewSel(false)" '+(RK_PSEL.size?'':'disabled')+'><i class="fa-solid fa-xmark"></i> Reject selected</button></div>':'')+'</div>';
    const g={}; rows.forEach(function(c){ const k=c.project_id||'_new'; (g[k]=g[k]||[]).push(c); });
    Object.keys(g).sort(function(a,b){ return a==='_new'?-1:b==='_new'?1:rkProjName(a).localeCompare(rkProjName(b)); }).forEach(function(k){
      const batches={}; g[k].forEach(function(c){ if(c.batch) batches[c.batch]=(batches[c.batch]||0)+1; });
      h+='<div class="rk-sec"><h4><i class="fa-solid fa-building" style="color:#0f766e"></i> '+(k==='_new'?'New projects':'<a href="javascript:void(0)" onclick="navTo(\'reckoner/p/'+k+'\')">'+esc(rkProjName(k))+'</a>')+' <span style="color:#64748b;font-weight:500">'+g[k].length+'</span>'
        +(ap?'<span class="r">'+Object.keys(batches).filter(function(b){ return batches[b]>1; }).map(function(b){ return '<button class="btn btn-sm" onclick="rkSelBatch(\''+esc(b)+'\')">Select import ('+batches[b]+')</button>'; }).join('')+'</span>':'')+'</h4>'
        +g[k].map(function(c){
          const o=RK_OP[c.op], days=Math.floor((Date.now()-new Date(c.proposed_at))/864e5), mine=String(c.proposed_by).toLowerCase()===me;
          return '<div style="border-top:1px solid #f1f5f9;padding:10px 0;display:flex;gap:10px">'
            +(ap?'<input type="checkbox" style="margin-top:4px" '+(RK_PSEL.has(c.id)?'checked':'')+' onchange="rkSel('+c.id+',this.checked)">':'')
            +'<div style="flex:1;min-width:0"><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13.5px"><span class="rk-vs" style="background:'+o[1]+'1a;color:'+o[1]+'"><i class="fa-solid '+o[2]+'"></i> '+o[0]+'</span>'
            +'<b>'+esc(RK_TBL_LABEL[c.tbl]||c.tbl)+'</b> '+esc(rkChgLabel(c,cur[c.record_id]))
            +'<span style="color:#64748b;font-size:12px">by '+esc(c.proposed_by)+' · '+esc(relTime(c.proposed_at))+'</span>'+(days>=3?'<span class="rk-vs outdated">Waiting '+days+' days</span>':'')+'</div>'
            +(c.reason||c.source?'<div style="font-size:12.5px;color:#475569;margin-top:3px">'+(c.reason?'Reason: '+esc(c.reason):'')+(c.reason&&c.source?' · ':'')+(c.source?'Source: '+esc(c.source):'')+'</div>':'')
            +rkDiff(c,cur[c.record_id])+'</div>'
            +'<div style="display:flex;flex-direction:column;gap:5px" class="rk-noprint">'+(ap?'<button class="btn btn-sm btn-primary" onclick="rkReview(['+c.id+'],true)"><i class="fa-solid fa-check"></i> Approve</button><button class="btn btn-sm" onclick="rkReview(['+c.id+'],false)"><i class="fa-solid fa-xmark"></i> Reject</button>':'')
            +(mine?'<button class="btn btn-sm" onclick="rkWithdraw('+c.id+')">Withdraw</button>':'')+'</div></div>';
        }).join('')+'</div>';
    });
  }
  h+=await rkUnverifiedBlock();
  h+=await rkOutdatedBlock();
  return h;
}
// verified values whose "valid until" date has passed
async function rkOutdatedBlock(){
  const t=rkToday(), S=RKS();
  const got=await Promise.all(['projects','charges','offers','payment_plans','units','configurations'].map(function(tb){
    return S.from(tb).select('*').eq('archived',false).eq('vstatus','verified').lt('valid_until',t).limit(200).then(function(r){ return (r.data||[]).map(function(x){ return [tb,x]; }); },function(){ return []; }); }));
  const all=[].concat.apply([],got); if(!all.length) return '';
  return '<div class="rk-sec"><h4><i class="fa-regular fa-calendar-xmark" style="color:#dc2626"></i> Past their "valid until" date ('+all.length+')</h4><div style="font-size:12.5px;color:#64748b;margin:-6px 0 8px">These show as Outdated everywhere. Propose new values, or '+(rkCanApprove()?'mark them Outdated for good.':'ask an approver.')+'</div><table class="rk-t"><tr><th>Project</th><th>What</th><th>Valid until</th><th></th></tr>'
    +all.map(function(p){ const tb=p[0], x=p[1], pid=tb==='projects'?x.id:x.project_id;
      return '<tr><td><a href="javascript:void(0)" onclick="navTo(\'reckoner/p/'+pid+'\')">'+esc(rkProjName(pid))+'</a></td><td>'+esc(RK_TBL_LABEL[tb])+' '+esc(x.name||x.title||x.unit_no||x.stage||'')+'</td><td>'+esc(fmtDate(x.valid_until))+'</td><td>'+(rkCanApprove()?'<button class="btn btn-sm" onclick="rkMarkOutdated(\''+tb+'\',\''+x.id+'\')">Mark outdated</button>':'')+'</td></tr>'; }).join('')+'</table></div>';
}
window.rkSel=function(id,on){ if(on) RK_PSEL.add(id); else RK_PSEL.delete(id); renderPage(); };
window.rkSelAll=function(){ (window._rkPend||[]).forEach(function(c){ RK_PSEL.add(c.id); }); renderPage(); };
window.rkSelBatch=function(b){ (window._rkPend||[]).forEach(function(c){ if(c.batch===b) RK_PSEL.add(c.id); }); renderPage(); };
window.rkReviewSel=function(ap){ rkReview(Array.from(RK_PSEL).sort(function(a,b){ return a-b; }),ap); };
window.rkReview=async function(ids,approve){
  if(!ids.length) return;
  let remarks=null;
  if(!approve||ids.length>1){
    remarks=await new Promise(function(res){
      window._rkRemRes=res;
      openModal('<div class="modal-head"><h3>'+(approve?'Approve '+ids.length+' changes':'Reject '+(ids.length>1?ids.length+' changes':'this change'))+'</h3><span class="x" onclick="closeModal();_rkRemRes(false)">&times;</span></div>'
        +'<div class="modal-body"><label style="font-size:12.5px;color:#475569;font-weight:600">Remarks'+(approve?' (optional)':' - why it is rejected')+'</label><textarea id="rkRem" rows="3" style="width:100%;border:1px solid var(--line);border-radius:9px;padding:8px;font-family:inherit;margin-top:4px"></textarea></div>'
        +'<div class="modal-foot"><button class="btn" onclick="closeModal();_rkRemRes(false)">Cancel</button><button class="btn '+(approve?'btn-primary':'btn-danger')+'" onclick="var v=$(\'rkRem\').value.trim();closeModal();_rkRemRes(v)">'+(approve?'Approve':'Reject')+'</button></div>');
    });
    if(remarks===false) return;
    if(!approve&&!remarks){ toast('Please give a reason for rejecting','warn'); return; }
  }
  let ok=0, fail=[];
  for(const id of ids){
    const r=await RKS().rpc('review',{p_id:id,p_approve:approve,p_remarks:remarks||null});
    if(r.error) fail.push('#'+id+': '+r.error.message); else { ok++; RK_PSEL.delete(id); }
  }
  toast((approve?'Approved ':'Rejected ')+ok+(fail.length?' · '+fail.length+' failed':''),fail.length?'warn':'ok');
  if(fail.length) try{ console.warn('reckoner review',fail); }catch(e){}
  if(fail.length&&ids.length===1) toast(fail[0],'err');
  RK.proj={}; await rkBase(true); renderPage();
};
window.rkWithdraw=async function(id){
  const ok=await confirmDialog('Withdraw this proposed change?',{title:'Withdraw',okLabel:'Withdraw',danger:false}); if(!ok) return;
  const r=await RKS().rpc('withdraw',{p_id:id}); if(r.error){ toast(r.error.message,'err'); return; }
  toast('Withdrawn','ok'); RK.proj={}; await rkBase(true); renderPage();
};
window.rkMarkOutdated=async function(tb,id){
  const r=await RKS().rpc('set_vstatus',{p_tbl:tb,p_id:id,p_status:'outdated',p_remarks:'Past its valid-until date'});
  if(r.error){ toast(r.error.message,'err'); return; } toast('Marked outdated','ok'); RK.proj={}; renderPage();
};

/* ---------------------------------------------------------------- Audit Log */
const RK_AUD={proj:'',status:''};
async function rkAuditView(){
  await rkFv();
  let rows=await (function(){ let q=RKS().from('changes').select('*').order('id',{ascending:false}).limit(300);
    if(RK_AUD.proj) q=q.eq('project_id',RK_AUD.proj); if(RK_AUD.status) q=q.eq('status',RK_AUD.status); return q; })().then(function(r){ if(r.error) throw r.error; return r.data||[]; });
  window._rkAud=rows;
  const cur=await rkCurrent(rows.filter(function(c){ return c.op!=='insert'; }));
  window._rkAudCur=cur;
  const S={pending:'pending',approved:'verified',rejected:'rejected',withdrawn:'na'};
  let h='<div class="rk-bar rk-noprint"><select onchange="RK_AUD.proj=this.value;renderPage()"><option value="">All projects</option>'+(RK.projects||[]).map(function(p){ return '<option value="'+p.id+'"'+(RK_AUD.proj===p.id?' selected':'')+'>'+esc(p.name)+'</option>'; }).join('')+'</select>'
    +'<select onchange="RK_AUD.status=this.value;renderPage()"><option value="">Any status</option>'+['pending','approved','rejected','withdrawn'].map(function(s){ return '<option'+(RK_AUD.status===s?' selected':'')+'>'+s+'</option>'; }).join('')+'</select>'
    +'<span style="font-size:12.5px;color:#64748b">Latest 300 · every proposed, approved and rejected change, with who and when</span></div>';
  if(!rows.length) return h+'<div class="rk-sec rk-empty">No changes yet.</div>';
  return h+'<div class="rk-sec"><div class="rk-wrap"><table class="rk-t"><tr><th>#</th><th>When</th><th>Project</th><th>What</th><th>By</th><th>Status</th><th>Reviewed</th></tr>'
    +rows.map(function(c,i){ const o=RK_OP[c.op];
      return '<tr style="cursor:pointer" onclick="rkAudOpen('+i+')"><td style="color:#94a3b8">'+c.id+'</td><td style="white-space:nowrap">'+esc(fmtDate(c.proposed_at))+'<div style="font-size:11.5px;color:#94a3b8">'+esc(new Date(c.proposed_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}))+'</div></td>'
        +'<td>'+esc(c.project_id?rkProjName(c.project_id):(c.payload&&c.payload.name)||'New project')+'</td><td><span style="color:'+o[1]+'">'+o[0]+'</span> '+esc(RK_TBL_LABEL[c.tbl]||c.tbl)+' <span style="color:#475569">'+esc(rkChgLabel(c,cur[c.record_id]))+'</span></td>'
        +'<td style="font-size:12.5px">'+esc(c.proposed_by)+'</td><td><span class="rk-vs '+(S[c.status]||'na')+'">'+esc(c.status)+'</span></td><td style="font-size:12.5px">'+(c.reviewed_by?esc(c.reviewed_by)+'<div style="color:#94a3b8">'+esc(fmtDate(c.reviewed_at))+'</div>':'')+(c.review_remarks?'<div style="color:#475569">'+esc(c.review_remarks)+'</div>':'')+'</td></tr>'; }).join('')+'</table></div></div>';
}
window.rkAudOpen=function(i){ const c=(window._rkAud||[])[i]; if(!c) return;
  openModal('<div class="modal-head"><h3>Change #'+c.id+' - '+esc(RK_OP[c.op][0])+' '+esc(RK_TBL_LABEL[c.tbl]||c.tbl)+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="font-size:13px"><div>Proposed by <b>'+esc(c.proposed_by)+'</b> on '+esc(new Date(c.proposed_at).toLocaleString('en-IN'))+'</div>'
    +(c.reason?'<div>Reason: '+esc(c.reason)+'</div>':'')+(c.source?'<div>Source: '+esc(c.source)+'</div>':'')+(c.batch?'<div>Batch: '+esc(c.batch)+'</div>':'')
    +'<div>Status: <b>'+esc(c.status)+'</b>'+(c.reviewed_by?' by '+esc(c.reviewed_by)+' on '+esc(new Date(c.reviewed_at).toLocaleString('en-IN')):'')+'</div>'+(c.review_remarks?'<div>Remarks: '+esc(c.review_remarks)+'</div>':'')
    +rkDiff(c,(window._rkAudCur||{})[c.record_id])+'</div><div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>','lg'); };

/* ---------------------------------------------------------------- Compare */
async function rkCompareView(){
  RK.cmp=RK.cmp.filter(function(id){ return (RK.projects||[]).some(function(p){ return p.id===id; }); });
  await Promise.all(RK.cmp.map(function(id){ return rkDetail(id); }));
  const left=(RK.projects||[]).filter(function(p){ return RK.cmp.indexOf(p.id)===-1; });
  let h='<div class="rk-bar rk-noprint">'+(RK.cmp.length<4?'<select onchange="if(this.value){RK.cmp.push(this.value);renderPage();}"><option value="">Add a project to compare...</option>'+left.map(function(p){ return '<option value="'+p.id+'">'+esc(p.name)+'</option>'; }).join('')+'</select>':'<span style="font-size:12.5px;color:#64748b">Up to 4 projects</span>')
    +'<label style="font-size:12.5px;color:#475569;display:flex;gap:5px;align-items:center"><input type="checkbox" '+(RK.cust?'checked':'')+' onchange="RK.cust=this.checked;renderPage()"> Customer view</label>'
    +(RK.cmp.length?'<button class="btn btn-sm" onclick="rkCmpExport()"><i class="fa-solid fa-file-excel"></i> Excel</button><button class="btn btn-sm" onclick="window.print()"><i class="fa-solid fa-print"></i> Print / PDF</button>':'')+'</div>';
  if(RK.cmp.length<2) return h+'<div class="rk-sec rk-empty">Pick at least 2 projects - here or with the Compare box on the Directory cards.</div>';
  const M=rkCmpMatrix();
  window._rkCmp=M;
  return h+'<div class="rk-sec"><div class="rk-wrap"><table class="rk-t"><tr><th style="width:170px"></th>'+M.heads.map(function(n,i){ return '<th style="font-size:14px;color:#0f172a">'+esc(n)+' <button class="rk-ib rk-noprint" title="Remove" onclick="RK.cmp.splice('+i+',1);renderPage()"><i class="fa-solid fa-xmark"></i></button></th>'; }).join('')+'</tr>'
    +M.rows.map(function(r){ return '<tr><td style="color:#475569;font-weight:600;font-size:12.5px">'+esc(r[0])+'</td>'+r[1].map(function(c){
      return '<td'+(c.flag?' style="background:#fffbeb"':'')+'>'+(c.t==null||c.t===''?rkNA():'<span style="white-space:pre-wrap">'+esc(c.t)+'</span>')+(c.flag?'<div style="font-size:11.5px;color:#92400e">'+esc(c.flag)+'</div>':'')+'</td>'; }).join('')+'</tr>'; }).join('')
    +'</table></div><div style="font-size:12px;color:#64748b;margin-top:8px">Shaded cells include information that is not verified yet. "Not Available" means nothing is recorded.</div></div>';
}
function rkCmpMatrix(){
  const D=RK.cmp.map(function(id){ return RK.proj[id]; });
  const pv=function(d,v,fmt){ const ok=rkOk(d.p); if(RK.cust&&!ok) return {t:null,flag:'Pending verification'}; return {t:v==null||v===''?null:(fmt?fmt(v):String(v)),flag:ok||v==null||v===''?'':'Pending verification'}; };
  const lst=function(rows,fn){ const s=rkShow(rows); const un=s.filter(function(r){ return !rkOk(r); }).length; return {t:s.length?fn(s):null,flag:un?un+' not verified':''}; };
  const range=function(a){ a=a.filter(function(x){ return x!=null&&isFinite(x); }); if(!a.length) return null; const lo=Math.min.apply(null,a), hi=Math.max.apply(null,a); return lo===hi?[lo]:[lo,hi]; };
  const rows=[
    ['Location',D.map(function(d){ return pv(d,[d.p.locality,d.p.city].filter(Boolean).join(', ')); })],
    ['Category',D.map(function(d){ return pv(d,d.p.category); })],
    ['Status',D.map(function(d){ return pv(d,d.p.status); })],
    ['Stage',D.map(function(d){ return pv(d,d.p.stage); })],
    ['Land area',D.map(function(d){ return pv(d,d.p.land_area); })],
    ['Towers / height',D.map(function(d){ return pv(d,[d.p.towers,d.p.height].filter(Boolean).join(' · ')); })],
    ['Total units',D.map(function(d){ return pv(d,d.p.total_units,rkNum); })],
    ['Open space',D.map(function(d){ return pv(d,d.p.open_space); })],
    ['Possession',D.map(function(d){ return pv(d,d.p.possession_date?fmtDate(d.p.possession_date):d.p.possession_note); })],
    ['RERA',D.map(function(d){ return pv(d,d.p.rera_no); })],
    ['Configurations',D.map(function(d){ return lst(d.cfg,function(s){ return s.map(function(c){ const a=rkArea(c); return c.name+(a?' - '+a:''); }).join('\n'); }); })],
    ['Base rate',D.map(function(d){ return lst(d.chg.filter(function(c){ return c.kind==='base_rate'&&c.unit==='per_sqft'&&c.amount!=null; }),function(s){ const r=range(s.map(function(c){ return Number(c.amount); })); return r?r.map(rkInr).join(' – ')+' / sq ft':null; }); })],
    ['Unit prices',D.map(function(d){ return lst(d.chg.filter(function(c){ return c.kind==='unit_price'&&c.amount!=null&&c.unit!=='percent'&&c.unit!=='per_sqft'; }),function(s){ const r=range(s.map(function(c){ return Number(c.amount); })); return r?r.map(rkCr).join(' – '):null; }); })],
    ['Other charges',D.map(function(d){ return lst(d.chg.filter(function(c){ return ['base_rate','unit_price'].indexOf(c.kind)===-1; }),function(s){ return s.map(function(c){ return c.name+': '+(c.amount==null?'–':c.unit==='percent'?rkNum(c.amount)+'%':rkInr(c.amount)+(c.unit==='per_sqft'?'/sq ft':'')); }).join('\n'); }); })],
    ['Free units',D.map(function(d){ return lst(d.units,function(s){ return String(s.length); }); })],
    ['Offers',D.map(function(d){ return lst(d.off,function(s){ return s.map(function(o){ return o.title; }).join('\n'); }); })],
    ['Amenities',D.map(function(d){ return lst(d.am,function(s){ return s.length+': '+s.slice(0,10).map(function(a){ return a.name; }).join(', ')+(s.length>10?'...':''); }); })],
    ['Nearby',D.map(function(d){ return lst(d.lm,function(s){ return s.slice().sort(function(a,b){ return (a.travel_min==null?1e9:a.travel_min)-(b.travel_min==null?1e9:b.travel_min); }).slice(0,5).map(function(a){ return a.name+(a.travel_min!=null?' - '+rkNum(a.travel_min)+' min':'')+(a.distance_km!=null?' ('+rkNum(a.distance_km)+' km)':''); }).join('\n'); }); })],
    ['Bank approvals',D.map(function(d){ return lst(d.bank,function(s){ return s.map(function(b){ return b.bank; }).join(', '); }); })],
    ['USPs',D.map(function(d){ return lst(d.notes.filter(function(n){ return n.kind==='usp'&&!n.internal; }),function(s){ return s.map(function(n){ return n.title||n.body; }).join('\n'); }); })]
  ];
  return {heads:D.map(function(d){ return d.p.name; }),rows:rows};
}
window.rkCmpExport=async function(){
  const M=window._rkCmp; if(!M) return; const XL=await loadXLSX(); if(!XL){ toast('Excel library did not load','err'); return; }
  const aoa=[['']].concat([]); aoa[0]=[''].concat(M.heads);
  M.rows.forEach(function(r){ aoa.push([r[0]].concat(r[1].map(function(c){ return (c.t==null||c.t===''?'Not Available':c.t)+(c.flag?' ['+c.flag+']':''); }))); });
  const ws=XL.utils.aoa_to_sheet(aoa); ws['!cols']=[{wch:18}].concat(M.heads.map(function(){ return {wch:40}; }));
  const wb=XL.utils.book_new(); XL.utils.book_append_sheet(wb,ws,'Comparison'); XL.writeFile(wb,'Reckoner comparison - '+rkToday()+'.xlsx');
};

/* ---------------------------------------------------------------- Roles (super admins) */
const RK_ROLE_L={sales_head:'Sales Head - approves',project_admin:'Project Admin - approves, edits assigned projects',project_manager:'Project Manager - proposes for assigned projects',viewer:'Viewer'};
async function rkRolesView(){
  if(RK.role!=='super') return '<div class="rk-sec rk-empty">Only super admins manage Reckoner roles.</div>';
  const r=await RKS().from('roles').select('*').order('email'); if(r.error) throw r.error;
  return '<div class="rk-sec"><h4><i class="fa-solid fa-user-shield" style="color:#0f766e"></i> Reckoner roles</h4>'
    +'<div style="font-size:12.5px;color:#64748b;margin:-6px 0 10px">Super admins can do everything. Everyone else with the Reckoner module can view (internal information included). A person also needs the <b>Reckoner</b> module in Control Panel to see it in the menu. Project Managers and Project Admins are tied to projects on each project\'s Overview → Team.</div>'
    +'<table class="rk-t"><tr><th>Email</th><th>Role</th><th>Added</th><th></th></tr>'+(r.data||[]).map(function(x){ return '<tr><td>'+esc(x.email)+'</td><td>'+esc(RK_ROLE_L[x.role]||x.role)+'</td><td style="font-size:12px;color:#64748b">'+esc(fmtDate(x.added_at))+(x.added_by?' by '+esc(x.added_by):'')+'</td><td><button class="rk-ib" title="Remove role" onclick="rkSetRole(\''+esc(x.email)+'\',null)"><i class="fa-solid fa-trash"></i></button></td></tr>'; }).join('')+'</table>'
    +'<div class="rk-bar" style="margin-top:12px"><input type="email" id="rkRoleEmail" placeholder="name@thejaingroup.com" style="min-width:240px"><select id="rkRoleSel">'+Object.keys(RK_ROLE_L).map(function(k){ return '<option value="'+k+'">'+esc(RK_ROLE_L[k])+'</option>'; }).join('')+'</select><button class="btn btn-sm btn-primary" onclick="rkSetRole($(\'rkRoleEmail\').value,$(\'rkRoleSel\').value)">Add / change</button></div></div>';
}
window.rkSetRole=async function(email,role){
  email=String(email||'').trim().toLowerCase(); if(!/^[^@\s]+@[^@\s]+$/.test(email)){ toast('Enter an email address','warn'); return; }
  if(!role){ const ok=await confirmDialog('Remove the Reckoner role of '+email+'?',{title:'Remove role',okLabel:'Remove'}); if(!ok) return; }
  const r=await RKS().rpc('set_role',{p_email:email,p_role:role}); if(r.error){ toast(r.error.message,'err'); return; }
  toast('Saved','ok'); renderPage();
};

// records that exist but are not verified yet (e.g. the workbook import): counted per project, verified on the project's tabs
async function rkUnverifiedBlock(){
  const T=['projects','configurations','charges','payment_plans','offers','units','amenities','landmarks','locations','sales_notes','bank_approvals','documents'];
  const got=await Promise.all(T.map(function(t){ return rkPages(function(){ return RKS().from(t).select(t==='projects'?'id':'project_id').eq('vstatus','pending').eq('archived',false); }).then(function(r){ return [t,r]; },function(){ return [t,[]]; }); }));
  const by={}; let total=0;
  got.forEach(function(g){ g[1].forEach(function(r){ const pid=g[0]==='projects'?r.id:r.project_id; by[pid]=by[pid]||{}; by[pid][g[0]]=(by[pid][g[0]]||0)+1; total++; }); });
  if(!total) return '';
  const tabOf={projects:0,configurations:1,charges:2,payment_plans:2,offers:0,units:3,amenities:4,landmarks:5,locations:5,sales_notes:6,bank_approvals:6,documents:7};
  return '<div class="rk-sec"><h4><i class="fa-solid fa-hourglass-half" style="color:#d97706"></i> Not verified yet ('+total+')</h4><div style="font-size:12.5px;color:#64748b;margin:-6px 0 8px">Information already in Reckoner but not checked - mostly the workbook import of 21 Nov. '+(rkCanApprove()?'Open a project, check each item against its source (shown under it) and press <i class="fa-solid fa-check-double"></i> or "Verify all".':'An approver verifies these.')+'</div>'
    +'<table class="rk-t"><tr><th>Project</th><th>Waiting</th></tr>'+Object.keys(by).sort(function(a,b){ return rkProjName(a).localeCompare(rkProjName(b)); }).map(function(pid){
      return '<tr><td><a href="javascript:void(0)" onclick="navTo(\'reckoner/p/'+pid+'\')"><b>'+esc(rkProjName(pid))+'</b></a></td><td>'+Object.keys(by[pid]).map(function(t){ return '<a href="javascript:void(0)" class="rk-chip" style="display:inline-block;margin:2px" onclick="navTo(\'reckoner/p/'+pid+'/'+tabOf[t]+'\')">'+esc(RK_TBL_LABEL[t]||t)+' '+by[pid][t]+'</a>'; }).join('')+'</td></tr>'; }).join('')+'</table></div>';
}
