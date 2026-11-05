/* ============================ POST SALES - OUTSTANDING REMINDERS (30 Oct 2026) ============================
   The list of customers to remind about their outstanding amount, rebuilt every morning from
   Farvision's "Customer Outstanding Summary" that the Customer Portal imports
   (postsales.outstanding_reminder_list): Dream Gurukul, Dream Ananta, Dream Gateway Pailan Projects and
   Dream Jain-Pailan, Net Outstanding of Rs 5,000 or more (PRM_MIN), each with their email and what changed since the
   file before. The email itself is fixed (postsales.reminder_settings) - its wording is changed on
   request, not on this page; here it can only be seen, filled in for any one customer.
   Nothing on this page emails anybody: sending to customers is not switched on. Route: postsales/reminders. */
const PRM={rows:[],settings:null,f:{proj:'',view:'remind',q:''},sel:new Set()};
const PRM_MIN=5000;   // Rs - smallest Net Outstanding that gets a reminder
function prmProj(p){
  return String(p||'').replace(/\(.*?\)/g,'').replace(/\s+/g,' ').trim().toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
}
function prmInr(n){ return Math.round(Number(n)||0).toLocaleString('en-IN'); }
function prmShort(n){ n=Number(n)||0; return n>=1e7?(Math.round(n/1e5)/100)+' Cr':(n>=1e5?(Math.round(n/1e3)/100)+' L':prmInr(n)); }
function prmFlat(r){ return [r.unit_code,r.tower].filter(Boolean).join(', '); }
function prmName(r){ return String(r.customer_name||'').replace(/^(mr|mrs|ms|dr|miss)\.?\s+/i,'').trim(); }
function prmFill(text,r){
  const d=new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'});
  return String(text||'').replace(/\{Customer Name\}/g,String(r.customer_name||'').trim()).replace(/\{Project\}/g,prmProj(r.project))
    .replace(/\{Flat\}/g,prmFlat(r)).replace(/\{Net Outstanding\}/g,prmInr(r.net_outstanding)).replace(/\{Date\}/g,d);
}
function prmStyles(){
  if($('prmStyles')) return;
  const s=document.createElement('style'); s.id='prmStyles';
  s.textContent=`
  .prm-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
  .prm-src{font-size:12.5px;color:var(--slate)}
  .prm-src b{color:var(--ink)}
  .prm-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}
  @media(max-width:900px){.prm-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
  .prm-stat{background:var(--bg-card,#fff);border:1px solid var(--line);border-radius:14px;padding:14px 16px;cursor:pointer;transition:border-color .12s,box-shadow .12s}
  .prm-stat:hover{border-color:#c4b5fd}
  .prm-stat.on{border-color:#7e22ce;box-shadow:0 0 0 3px #f3e8ff}
  .prm-stat .l{font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--slate)}
  .prm-stat .v{font-size:24px;font-weight:800;color:var(--ink);margin-top:6px;line-height:1.1}
  .prm-stat .s{font-size:12px;color:var(--slate);margin-top:4px}
  .prm-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 14px;border-bottom:1px solid var(--line)}
  .prm-chip{height:32px;padding:0 13px;border-radius:20px;border:1px solid var(--line);background:#fff;font:600 12.5px inherit;font-family:inherit;color:var(--ink);cursor:pointer;white-space:nowrap}
  .prm-chip.on{background:#7e22ce;border-color:#7e22ce;color:#fff}
  .prm-chip .n{opacity:.7;font-weight:500;margin-left:4px}
  .prm-q{position:relative;margin-left:auto;width:260px;max-width:100%}
  .prm-q i{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--slate);font-size:12px}
  .prm-q input{width:100%;box-sizing:border-box;height:34px;padding:0 10px 0 30px;border:1px solid var(--line);border-radius:9px;font:13px inherit;font-family:inherit}
  #prmTbl{width:100%;border-collapse:collapse}
  #prmTbl th{position:sticky;top:0;background:var(--bg-subtle,#f8fafc);text-align:left;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--slate);padding:9px 14px;border-bottom:1px solid var(--line);z-index:1}
  #prmTbl td{padding:11px 14px;border-bottom:1px solid var(--line-2,#eef1f6);vertical-align:middle;font-size:13px}
  #prmTbl tr.grp td{background:#faf5ff;font-weight:700;color:#581c87;font-size:12.5px;padding:8px 14px}
  #prmTbl tr.grp td .t{float:right;font-weight:800}
  #prmTbl tbody tr.row:hover td{background:var(--bg-hover,#f8fafc)}
  .prm-who{display:flex;align-items:center;gap:10px;min-width:0}
  .prm-who .avatar-sm{width:32px;height:32px;font-size:11px;flex:none}
  .prm-nm{font-weight:650;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .prm-sub{font-size:11.5px;color:var(--slate);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .prm-amt{text-align:right;white-space:nowrap;font-weight:800;font-variant-numeric:tabular-nums}
  .prm-old{display:block;font-size:11.5px;font-weight:500;color:var(--slate);text-decoration:line-through}
  .prm-badge{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:20px;font-size:11px;font-weight:700;margin-left:6px;vertical-align:middle}
  .prm-badge.new{background:#dbeafe;color:#1e40af}
  .prm-badge.changed{background:#fef3c7;color:#92400e}
  .prm-badge.removed{background:#dcfce7;color:#166534}
  .prm-badge.held{background:#fee2e2;color:#991b1b}
  .prm-act{white-space:nowrap;text-align:right}
  .prm-ibtn{width:32px;height:32px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--slate);cursor:pointer;margin-left:4px}
  .prm-ibtn:hover{border-color:#7e22ce;color:#7e22ce}
  .prm-email{font-size:12.5px;color:var(--ink-2,#334155)}
  .prm-cb{width:16px;height:16px;accent-color:#7e22ce;cursor:pointer;vertical-align:middle}
  #prmTbl tbody tr.row.sel td{background:#faf5ff}
  .prm-selbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--bg-subtle,#f8fafc);font-size:13px}
  .prm-selbar b{color:var(--ink)}`;
  document.head.appendChild(s);
}
window.prmRender=async function(host){
  prmStyles(); loader(host);
  const [l,s]=await Promise.all([sb.schema('postsales').rpc('outstanding_reminder_list'), sb.schema('postsales').from('reminder_settings').select('*').eq('id',1).maybeSingle()]);
  if(l.error){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not build the list: '+esc(l.error.message)+'</div></div>'; return; }
  // Nobody is reminded about less than PRM_MIN (2 Nov 2026, Ayush) - Farvision leaves rounding pennies of
  // Rs 1-6 on settled flats, and a reminder for those reads as a mistake. Removed rows keep showing.
  /* Only Active customers (3 Nov 2026). Since the import keeps cancelled bookings' rows too, the Outstanding
     file's cancelled bookings came into this list - 29 of them on 3 Nov. Farvision's Customer Status decides. */
  try{ await prmFvRead(); }catch(_e){ PRM_FVSTATUS={}; }
  PRM.rows=((l.data||[]).filter(r=>r.change==='removed'||(Number(r.net_outstanding||0)>=PRM_MIN&&PRM_FVSTATUS[r.booking_no]==='Active'))); PRM.settings=s.data||{};
  const keep=new Set(PRM.rows.map(r=>r.booking_no)); PRM.sel.forEach(k=>{ if(!keep.has(k)) PRM.sel.delete(k); });
  prmDraw(host);
};
// Who belongs in each view.
function prmIn(r,view){
  if(view==='removed') return r.change==='removed';
  if(r.change==='removed') return false;
  if(view==='remind') return !r.held&&!!r.email;
  if(view==='changes') return r.change==='new'||r.change==='changed';
  if(view==='held') return r.held||!r.email;
  return true;
}
function prmDraw(host){
  host=host||$('prmBody'); if(!host) return;
  const any=PRM.rows[0]||{};
  const remind=PRM.rows.filter(r=>prmIn(r,'remind')), changes=PRM.rows.filter(r=>prmIn(r,'changes')),
        held=PRM.rows.filter(r=>prmIn(r,'held')), removed=PRM.rows.filter(r=>prmIn(r,'removed'));
  const total=remind.reduce((a,r)=>a+Number(r.net_outstanding||0),0);
  const stat=(view,l,v,s)=>'<div class="prm-stat'+(PRM.f.view===view?' on':'')+'" onclick="PRM.f.view=\''+view+'\';prmDraw()"><div class="l">'+l+'</div><div class="v">'+v+'</div><div class="s">'+s+'</div></div>';
  const projects=[...new Set(PRM.rows.filter(r=>r.change!=='removed').map(r=>r.project))].sort();
  const pc=p=>PRM.rows.filter(r=>prmIn(r,PRM.f.view)&&(!p||r.project===p)).length;
  host.innerHTML='<div class="prm-head"><div class="prm-src"><i class="fa-solid fa-file-excel" style="color:#16a34a"></i> From Farvision\u2019s <b>Customer Outstanding Summary</b>, '
      +(any.file_date?pstDT(any.file_date):'—')+(any.prev_file_date?' &middot; compared with '+pstDT(any.prev_file_date):'')+'</div>'
      +'<div class="prm-q"><i class="fa-solid fa-magnifying-glass"></i><input placeholder="Search name, flat, email…" value="'+esc(PRM.f.q)+'" oninput="PRM.f.q=this.value;prmList()"></div></div>'
    +'<div class="prm-stats">'
      +stat('remind','To remind',remind.length,'₹'+prmShort(total)+' outstanding')
      +stat('changes','Changes today',changes.length,changes.filter(r=>r.change==='new').length+' new &middot; '+changes.filter(r=>r.change==='changed').length+' amount changed')
      +stat('removed','Removed',removed.length,'paid up or no longer due')
      +stat('held','Held back',held.length,'disputed or no email')
    +'</div>'
    +'<div class="card" style="padding:0;overflow:hidden">'
      +'<div class="prm-tools">'
        +'<button class="prm-chip'+(!PRM.f.proj?' on':'')+'" onclick="PRM.f.proj=\'\';prmDraw()">All projects<span class="n">'+pc('')+'</span></button>'
        +projects.map(p=>'<button class="prm-chip'+(PRM.f.proj===p?' on':'')+'" onclick="PRM.f.proj=\''+esc(p).replace(/'/g,"\\'")+'\';prmDraw()">'+esc(prmProj(p))+'<span class="n">'+pc(p)+'</span></button>').join('')
      +'</div>'
      +'<div class="prm-selbar" id="prmSelBar"></div>'
      +'<div style="overflow:auto;max-height:calc(100vh - 400px)" id="prmList"></div>'
    +'</div>';
  prmList();
}
window.prmList=function(){
  const host=$('prmList'); if(!host) return;
  const f=PRM.f, q=f.q.trim().toLowerCase();
  const rows=PRM.rows.filter(function(r){
    if(!prmIn(r,f.view)) return false;
    if(f.proj&&r.project!==f.proj) return false;
    if(q&&[r.customer_name,r.unit_code,r.tower,r.email,r.booking_no].join(' ').toLowerCase().indexOf(q)===-1) return false;
    return true;
  });
  const badge=r=>(r.change==='new'?'<span class="prm-badge new">New</span>':'')+(r.change==='changed'?'<span class="prm-badge changed">Changed</span>':'')
    +(r.change==='removed'?'<span class="prm-badge removed">Removed</span>':'')+(r.held?'<span class="prm-badge held">Held</span>':'');
  const groups={}; rows.forEach(r=>{ (groups[r.project]=groups[r.project]||[]).push(r); });
  const body=Object.keys(groups).sort().map(function(p){
    const g=groups[p], t=g.reduce((a,r)=>a+Number(r.net_outstanding||0),0);
    const can=g.filter(r=>r.change!=='removed'&&r.email&&!r.held), allOn=can.length&&can.every(r=>PRM.sel.has(r.booking_no));
    PRM._grp=PRM._grp||[]; const gi=PRM._grp.indexOf(p)>=0?PRM._grp.indexOf(p):(PRM._grp.push(p)-1);
    return '<tr class="grp"><td style="width:38px">'+(can.length?'<input type="checkbox" class="prm-cb"'+(allOn?' checked':'')+' title="Select this whole group" onchange="prmSelGroup('+gi+',this.checked)">':'')+'</td><td colspan="4">'+esc(prmProj(p))+' &middot; '+g.length+' customer'+(g.length===1?'':'s')
      +'<span class="t">₹'+prmInr(t)+'</span></td></tr>'
      +g.map(function(r){ const ix=PRM.rows.indexOf(r);
        const selectable=r.change!=='removed'&&r.email&&!r.held;
        return '<tr class="row'+(PRM.sel.has(r.booking_no)?' sel':'')+'"><td style="width:38px">'+(selectable?'<input type="checkbox" class="prm-cb"'+(PRM.sel.has(r.booking_no)?' checked':'')+' onchange="prmSel('+ix+',this.checked)">':'')+'</td><td><div class="prm-who">'+avatar(prmName(r)||'?')+'<div style="min-width:0"><div class="prm-nm">'+esc(String(r.customer_name||'').trim())+badge(r)+'</div>'
          +'<div class="prm-sub">Flat '+esc(prmFlat(r))+' &middot; '+esc(r.booking_no||'')+'</div>'
          +(r.held?'<div class="prm-sub" style="color:#b91c1c"><i class="fa-solid fa-hand"></i> '+esc(r.hold_reason||'')+'</div>':'')+'</div></div></td>'
          +'<td class="prm-email">'+(r.email?esc(r.email):'<span style="color:#b91c1c">No email on record</span>')+'</td>'
          +'<td class="prm-amt">₹'+prmInr(r.net_outstanding)+(r.change==='changed'||r.change==='removed'?'<span class="prm-old">₹'+prmInr(r.prev_net)+'</span>':'')+'</td>'
          +'<td class="prm-act">'+(r.change!=='removed'
            ?'<button class="prm-ibtn" title="See the email this customer would get" onclick="prmPreview('+ix+')"><i class="fa-solid fa-eye"></i></button>'
              +'<button class="prm-ibtn" title="Open the Reminder Letter that goes with the email" onclick="prmLetter('+ix+')"><i class="fa-solid fa-file-pdf"></i></button>'
              +(r.held?'<button class="prm-ibtn" title="Release - remind again" onclick="prmUnhold('+ix+')"><i class="fa-solid fa-rotate-left"></i></button>'
                :'<button class="prm-ibtn" title="Hold - do not remind" onclick="prmHold('+ix+')"><i class="fa-solid fa-hand"></i></button>'):'')+'</td></tr>'; }).join('');
  }).join('');
  host.innerHTML='<table id="prmTbl"><thead><tr><th></th><th>Customer</th><th>Email</th><th style="text-align:right">Net Outstanding</th><th></th></tr></thead><tbody>'
    +(body||'<tr><td colspan="5"><div class="empty" style="padding:26px">Nobody here</div></td></tr>')+'</tbody></table>';
  prmSelBar();
};
function prmEmailHtml(subj,body,to){
  const st=PRM.settings||{};
  return '<div style="color:var(--slate);font-size:12.5px;line-height:1.75"><b>From</b> Pallabita Ghosh - The Jain Group &lt;customercare1@thejaingroup.com&gt;'
      +(to!=null?'<br><b>To</b> '+esc(to||'(no email)'):'')+'<br><b>Subject</b> '+esc(subj)
      +'<br><b>Attachment</b> Reminder Letter (PDF)'+(st.attachment_name?', '+esc(st.attachment_name):'')+'</div>'
    +'<div style="margin-top:12px;padding:16px;border:1px solid var(--line);border-radius:12px;white-space:pre-wrap;line-height:1.65;font-size:13.5px">'+esc(body)+'</div>';
}
window.prmPreview=function(ix){
  const r=PRM.rows[ix]; if(!r) return;
  const st=PRM.settings||{};
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-envelope-open-text"></i> '+esc(String(r.customer_name||'').trim())+' - preview, not sent</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="width:min(94vw,660px)">'+prmEmailHtml(prmFill(st.subject,r),prmFill(st.body,r),r.email)+'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>','md');
};
window.prmHold=async function(ix){
  const r=PRM.rows[ix]; if(!r) return;
  const reason=prompt('Why should '+String(r.customer_name||'this customer').trim()+' not be reminded? (e.g. amount disputed)');
  if(!reason||!reason.trim()) return;
  const {error}=await sb.schema('postsales').from('reminder_holds').upsert({booking_no:r.booking_no,customer_name:r.customer_name,reason:reason.trim(),held_by:state.email},{onConflict:'booking_no'});
  if(error){ toast(error.message,'err'); return; }
  r.held=true; r.hold_reason=reason.trim(); toast('Held - they will not be reminded','ok'); prmDraw();
};
window.prmUnhold=async function(ix){
  const r=PRM.rows[ix]; if(!r) return;
  const {error}=await sb.schema('postsales').from('reminder_holds').delete().eq('booking_no',r.booking_no);
  if(error){ toast(error.message,'err'); return; }
  r.held=false; r.hold_reason=null; toast('Released','ok'); prmDraw();
};

/* WHO GETS IT: a tick per customer, a tick per project group, and select-all / unselect-all for
   whatever is on screen - so it can be everyone but a few, or only a few. Remembered while the page is open. */
function prmPick(r){ return r.change!=='removed'&&!!r.email&&!r.held; }
function prmShown(){
  const f=PRM.f, q=f.q.trim().toLowerCase();
  return PRM.rows.filter(r=>prmIn(r,f.view)&&(!f.proj||r.project===f.proj)&&prmPick(r)
    &&(!q||[r.customer_name,r.unit_code,r.tower,r.email,r.booking_no].join(' ').toLowerCase().indexOf(q)!==-1));
}
function prmSelBar(){
  const b=$('prmSelBar'); if(!b) return;
  const sel=PRM.rows.filter(r=>PRM.sel.has(r.booking_no));
  const total=sel.reduce((a,r)=>a+Number(r.net_outstanding||0),0);
  b.innerHTML='<span><b>'+sel.length+'</b> selected'+(sel.length?' &middot; ₹'+prmInr(total):'')+'</span>'
    +'<button class="btn btn-sm" onclick="prmSelShown(true)">Select all shown</button>'
    +'<button class="btn btn-sm" onclick="prmSelShown(false)">Unselect all shown</button>'
    +(sel.length?'<button class="btn btn-sm" onclick="PRM.sel.clear();prmList()">Clear selection</button>':'')
    +'<button class="btn btn-sm btn-primary" style="margin-left:auto"'+(sel.length?'':' disabled')+' onclick="prmSendAsk()"><i class="fa-solid fa-paper-plane"></i> Send reminder'+(sel.length?' to '+sel.length:'')+'</button>';
}
/* SENDING (2 Nov 2026) - anyone with the Post Sales module, from Pallabita Ghosh's customer-care mailbox.
   Each ticked customer's Reminder Letter is drawn here and goes with their email; the server decides who
   actually gets one (on the list, Rs 5,000 or more, email on record, not held, not reminded today). A letter
   whose total is not the customer's Net Outstanding is not sent. Ten customers to a call. */
function prmB64(bytes){ let s=''; for(let i=0;i<bytes.length;i+=0x8000) s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000)); return btoa(s); }
window.prmSendAsk=function(){
  const sel=PRM.rows.filter(r=>PRM.sel.has(r.booking_no)&&prmPick(r)); if(!sel.length) return;
  const total=sel.reduce((a,r)=>a+Number(r.net_outstanding||0),0);
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-paper-plane"></i> Send outstanding reminders</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="width:min(94vw,520px)"><div id="prmSendBody" style="font-size:13.5px;line-height:1.7">'
      +'<b>'+sel.length+'</b> customer'+(sel.length===1?'':'s')+' &middot; ₹'+prmInr(total)+' outstanding<br>'
      +'From <b>Pallabita Ghosh - The Jain Group</b> &lt;customercare1@thejaingroup.com&gt;<br>'
      +'Each gets the reminder email with their own <b>Reminder Letter</b> (PDF) attached.'
      +'<div style="font-size:12px;color:var(--slate);margin-top:8px">Customers already reminded today are skipped.</div></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="prmGo" onclick="prmSendGo()"><i class="fa-solid fa-paper-plane"></i> Send '+sel.length+'</button></div>','md');
};
window.prmSendGo=async function(){
  const sel=PRM.rows.filter(r=>PRM.sel.has(r.booking_no)&&prmPick(r));
  const go=$('prmGo'), box=$('prmSendBody'); if(go) go.disabled=true;
  const say=t=>{ if(box) box.innerHTML=t; };
  const res={sent:0,failed:[],skipped:[]};
  const {data:{session}}=await sb.auth.getSession();
  for(let i=0;i<sel.length;i+=10){
    const part=sel.slice(i,i+10), letters={}, nos=[];
    say('<i class="fa-solid fa-spinner fa-spin"></i> Preparing letters and sending - '+Math.min(i+part.length,sel.length)+' of '+sel.length+'…');
    for(const r of part){
      try{
        const d=await prmLetterData(r.booking_no);
        if(d.net==null||Math.abs(d.total-Number(r.net_outstanding||0))>1){ res.skipped.push(prmName(r)+' - letter total does not match'); continue; }
        letters[r.booking_no]={filename:'Reminder Letter - '+String(r.booking_no).replace(/[^\w\-]+/g,'_')+'.pdf',pdf_base64:prmB64(await prmLetterPdf(d))};
        nos.push(r.booking_no);
      }catch(e){ res.skipped.push(prmName(r)+' - '+e.message); }
    }
    if(!nos.length) continue;
    try{
      const rq=await fetch(SUPABASE_URL+'/functions/v1/customer-invite',{method:'POST',
        headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+((session&&session.access_token)||'')},
        body:JSON.stringify({action:'reminder_send_customers',booking_nos:nos,letters:letters})});
      const out=await rq.json().catch(()=>({}));
      if(!rq.ok||out.error){ say('<span style="color:#b91c1c"><i class="fa-solid fa-triangle-exclamation"></i> '+esc(out.error||('HTTP '+rq.status))+'</span>'+(res.sent?'<br>'+res.sent+' sent before this.':'')); if(go){ go.disabled=false; go.textContent='Close'; go.onclick=closeModal; } return; }
      res.sent+=out.sent||0;
      (out.results||[]).forEach(x=>{ const r=PRM.rows.find(y=>y.booking_no===x.booking_no); const nm=r?prmName(r):x.booking_no;
        if(x.skipped) res.skipped.push(nm+' - '+x.error); else if(!x.ok) res.failed.push(nm+' - '+x.error); });
    }catch(e){ res.failed.push('Batch '+(i/10+1)+' - '+e.message); }
  }
  say('<b style="color:#15803d"><i class="fa-solid fa-circle-check"></i> '+res.sent+' reminder'+(res.sent===1?'':'s')+' sent</b>'
    +(res.failed.length?'<div style="margin-top:8px;color:#b91c1c"><b>Not sent ('+res.failed.length+')</b><br>'+res.failed.map(esc).join('<br>')+'</div>':'')
    +(res.skipped.length?'<div style="margin-top:8px;color:var(--slate)"><b>Skipped ('+res.skipped.length+')</b><br>'+res.skipped.map(esc).join('<br>')+'</div>':''));
  if(go){ go.disabled=false; go.innerHTML='Close'; go.onclick=closeModal; }
  if(res.sent){ PRM.sel.clear(); prmList(); }
};
/* THE REMINDER LETTER (2 Nov 2026) - Farvision's "Reminder Letter", built by JAIN-E from its own data so
   it can go with the email: the company block from Post Sales > Setup, the customer from Farvision's
   contacts (Customer Portal import), the PAN from the Booking Form flow where the booking went through it,
   and the outstanding table as each demand line billed minus what receipts were allocated to that same
   demand and charge (Farvision's own receipt allocation). Lines fully paid drop out, as on Farvision's.
   Checked against Farvision's letter for Debarun Bhattacharya, Gurukul B/4G: the same three lines,
   9,474 + 29,001 + 43,859 = 82,334. */
let PRM_PAN=null;
function prmMoney(n){ return (Math.round((Number(n)||0)*100)/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function prmDmy(d){ if(!d) return ''; const p=String(d).slice(0,10).split('-'); return p[2]+'/'+p[1]+'/'+p[0]; }
function prmWords(n){
  n=Math.round(Number(n)||0); if(!n) return 'Zero';
  const a=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const b=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const two=x=>x<20?a[x]:(b[Math.floor(x/10)]+(x%10?' '+a[x%10]:''));
  const three=x=>(x>=100?a[Math.floor(x/100)]+' Hundred'+(x%100?' ':''):'')+(x%100?two(x%100):'');
  const cr=Math.floor(n/1e7); n%=1e7; const lk=Math.floor(n/1e5); n%=1e5; const th=Math.floor(n/1e3); n%=1e3;
  return [cr?(cr>99?prmWords(cr):two(cr))+' Crore':'',lk?two(lk)+' Lakh':'',th?two(th)+' Thousand':'',n?three(n):''].filter(Boolean).join(' ');
}
// "VEHICLE PARKING_4" / "ADVANCE MAINTENANCE  at ADJUSTABLE at _2" -> what the charge is called on paper.
function prmHead(h){ return String(h||'').replace(/\s+at\s+(ADJUSTABLE|DEPOSIT|ACTUAL)\s+at\s*/ig,' ').replace(/[_ ]+\d+\s*$/,'').replace(/\s+/g,' ').trim(); }
async function prmPans(){
  if(PRM_PAN) return PRM_PAN;
  const {data}=await sb.schema('acc').from('booking_audits')
    .select('pan:result->fields->customer_pan->>value,flat:result->fields->flat->>value,name:result->fields->customer_name->>value');
  PRM_PAN=(data||[]).filter(x=>x.pan&&/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(String(x.pan).trim())); return PRM_PAN;
}
/* The PAN Farvision prints, from its Customer Outstanding file - masked there ("XXXXX3204H"), as on its own
   letters. Used where the booking did not go through the Booking Form flow, which has the full PAN. Read once. */
let PRM_FVPAN=null, PRM_FVSTATUS=null;
async function prmFvRead(){
  const {data}=await sb.schema('cust').from('import_batches').select('raw_rows').eq('import_type','outstanding').eq('status','completed')
    .order('imported_at',{ascending:false}).limit(1).maybeSingle();
  PRM_FVPAN={}; PRM_FVSTATUS={};
  ((data&&data.raw_rows)||[]).forEach(r=>{ if(!r.bookingNo) return; if(r.pan) PRM_FVPAN[r.bookingNo]=String(r.pan).trim().toUpperCase(); PRM_FVSTATUS[r.bookingNo]=r.status||''; });
}
async function prmFvPans(){ if(!PRM_FVPAN) await prmFvRead(); return PRM_FVPAN; }
async function prmLetterData(bookingNo){
  const C=sb.schema('cust');
  const {data:u,error}=await C.from('units').select('id,project_id,tower,unit_code,application_no').eq('booking_no',bookingNo).is('deleted_at',null).order('id',{ascending:false}).limit(1).maybeSingle();
  if(error||!u) throw new Error('This booking is not in the Customer Portal data');
  const [ct,pj,su,inv,rc,os,pans]=await Promise.all([
    C.from('farvision_contacts').select('contact_name,contact_phone,contact_email,contact_address').eq('unit_id',u.id).eq('is_current',true).is('deleted_at',null).order('id',{ascending:false}).limit(1).maybeSingle(),
    C.from('projects').select('name').eq('id',u.project_id).maybeSingle(),
    sb.schema('postsales').from('project_setup').select('company_name,company_address,company_pan,company_gstin').eq('project_id',u.project_id).maybeSingle(),
    C.from('invoices').select('document_no,document_date,due_date,status,invoice_items(schedule,revenue_head,net_amount,sort_order)').eq('unit_id',u.id).eq('is_current',true).is('deleted_at',null),
    C.from('money_receipts').select('is_reversed,receipt_items(against_demand_no,schedule,revenue_head,amount)').eq('unit_id',u.id).eq('is_current',true).is('deleted_at',null),
    C.from('outstanding_snapshot').select('net_outstanding,bill_outstanding,on_account,late_fee_accrued,as_on_date').eq('unit_id',u.id).eq('is_current',true).is('deleted_at',null).maybeSingle(),
    prmPans()]);
  /* A line is one demand + one instalment + one charge: Farvision can put a whole payment plan in a single
     demand, with "Unit Cost" under every instalment, and receipts are allocated to each separately. */
  const key=(doc,sch,h)=>(doc||'')+'|'+String(sch||'').replace(/\s+/g,' ').trim().toUpperCase()+'|'+prmHead(h).toUpperCase();
  const got={}; ((rc.data)||[]).filter(r=>!r.is_reversed).forEach(r=>(r.receipt_items||[]).forEach(i=>{
    const k=key(i.against_demand_no,i.schedule,i.revenue_head); got[k]=(got[k]||0)+Number(i.amount||0); }));
  const today=new Date(); today.setHours(0,0,0,0);
  const lines=[], seen={};
  ((inv.data)||[]).filter(i=>i.status!=='Cancel').sort((a,b)=>String(a.document_date).localeCompare(String(b.document_date))).forEach(i=>{
    const items=(i.invoice_items||[]).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
    const sched=[...new Set(items.map(x=>String(x.schedule||'').trim()))];   // instalments in the demand's own order
    items.forEach(it=>{
      const head=prmHead(it.revenue_head), k=key(i.document_no,it.schedule,it.revenue_head);
      if(seen[k]){ seen[k].bill+=Number(it.net_amount||0); return; }
      const due=i.due_date||i.document_date;
      seen[k]={particulars:String(it.schedule||'').trim()+'.'+head, bill_no:i.document_no, bill_date:i.document_date, due_date:due,
               days:due?Math.max(0,Math.round((today-new Date(due+'T00:00:00'))/864e5)):'', bill:Number(it.net_amount||0), k:k,
               ord:sched.indexOf(String(it.schedule||'').trim())};
      lines.push(seen[k]);
    });
  });
  lines.forEach(l=>{ l.rec=Math.min(l.bill,got[l.k]||0); l.bal=Math.round((l.bill-l.rec)*100)/100; });
  // Farvision's order: oldest demand first, charges A-Z within it.
  const byAge=(a,b)=>String(a.bill_date).localeCompare(String(b.bill_date))||a.bill_no.localeCompare(b.bill_no)||(a.ord-b.ord)||a.particulars.localeCompare(b.particulars);
  /* Receipt lines with no demand number (money received but not set against a demand in the register) go
     against the oldest unpaid lines first - Debarun-style letters were lakhs too high without this. */
  let loose=Object.keys(got).filter(k=>k.split('|')[0]==='').reduce((a,k)=>a+got[k],0);
  lines.slice().sort(byAge).forEach(l=>{ if(loose<=0||l.bal<=0) return; const t=Math.min(loose,l.bal); l.rec+=t; l.bal=Math.round((l.bal-t)*100)/100; loose-=t; });
  let due=lines.filter(l=>l.bal>0.5).sort(byAge);
  /* THE AMOUNT IS ALWAYS FARVISION'S. Where the demand-by-demand detail rebuilt from the registers does not
     come to Farvision's Bill Outstanding (old or re-issued demands, receipts set against other demands), the
     letter carries one line with Farvision's own figure instead of a breakdown that would state a wrong one. */
  const snap=os.data||null, billOs=snap&&snap.bill_outstanding!=null?Number(snap.bill_outstanding):null;
  const summary=billOs!=null&&Math.abs(due.reduce((a,l)=>a+l.bal,0)-billOs)>1;
  if(summary) due=billOs>0.5?[{particulars:'Total outstanding as per our records as on '+prmDmy(snap.as_on_date),bill_no:'',bill_date:'',due_date:'',days:'',bill:billOs,rec:0,bal:billOs}]:[];
  const c=ct.data||{}, nm=String(c.contact_name||'').trim();
  const first=nm.replace(/^(mr|mrs|ms|dr|miss)\.?\s+/i,'').split(/\s+/)[0].toUpperCase();
  const pan=(pans||[]).find(p=>String(p.flat||'').trim().toUpperCase()===String(u.unit_code||'').toUpperCase()
                              &&String(p.name||'').toUpperCase().indexOf(first)!==-1);
  const flr=String(u.unit_code||'').match(/^(\d+)/), cat=String(u.unit_code||'').replace(/^\d+[-\d]*/,'');
  return {booking_no:bookingNo, unit:u, project:(pj.data||{}).name||'', setup:su.data||{}, contact:c, name:nm,
          pan:pan?String(pan.pan).toUpperCase():((await prmFvPans())[bookingNo]||''), floor:flr?flr[1]:'', category:cat, lines:due, summary:summary,
          onacc:snap?Math.max(0,Number(snap.on_account||0)):0,
          total:due.reduce((a,l)=>a+l.bal,0)-(snap?Math.max(0,Number(snap.on_account||0)):0), net:snap?Number(snap.net_outstanding||0):null,
          late:os.data?Number(os.data.late_fee_accrued||0):0, ref:'JRM/'+u.id+'/'+new Date().toISOString().slice(0,10).replace(/-/g,'')};
}
// Drawn like Farvision's: a 612 x 864 page, company block, the addressee against a reference column,
// the outstanding table and the late payment fee summary.
async function prmLetterPdf(d){
  const L=await loadPdfLib(); if(!L) throw new Error('The PDF library could not be loaded');
  const doc=await L.PDFDocument.create(); doc.setTitle('Reminder Letter '+d.booking_no);
  const reg=await doc.embedFont(L.StandardFonts.Helvetica), bold=await doc.embedFont(L.StandardFonts.HelveticaBold);
  const W=612, H=864, M=36, INK=L.rgb(0,0,0), GREY=L.rgb(.93,.93,.93);
  const clean=t=>String(t==null?'':t).replace(/₹/g,'Rs.').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[–—]/g,'-').replace(/[^ -ÿ]/g,'').trim();
  const wrap=(t,w,f,s)=>{ const out=[]; let ln=''; clean(t).split(/\s+/).filter(Boolean).forEach(wd=>{ const x=ln?ln+' '+wd:wd; if(f.widthOfTextAtSize(x,s)>w&&ln){ out.push(ln); ln=wd; } else ln=x; }); if(ln) out.push(ln); return out.length?out:['']; };
  let pg=doc.addPage([W,H]), y=H-M;
  const txt=(t,x,yy,o)=>{ o=o||{}; const f=o.bold?bold:reg, s=o.size||8, c=clean(t); const tw=f.widthOfTextAtSize(c,s);
    pg.drawText(c,{x:o.align==='center'?(W-tw)/2:o.align==='right'?x-tw:x,y:yy,size:s,font:f,color:INK}); };
  const st=d.setup||{};
  txt(String(st.company_name||'THE JAIN GROUP').toUpperCase(),0,y-12,{bold:true,size:12,align:'center'}); y-=24;
  wrap(String(st.company_address||'').replace(/\n/g,', '),W-2*M,reg,8).forEach(l=>{ txt(l,0,y-8,{align:'center'}); y-=11; });
  y-=6; if(st.company_gstin){ txt('GSTIN',M,y-8); txt(': '+st.company_gstin,M+80,y-8); y-=14; }
  if(st.company_pan){ txt('PAN',M,y-8); txt(': '+st.company_pan,M+80,y-8); y-=14; }
  y-=6; txt('Reminder Letter',0,y-10,{bold:true,size:10,align:'center'}); txt('Date :  '+prmDmy(new Date().toISOString()),W-M,y-20,{align:'right'}); y-=36;
  const c=d.contact||{}, half=310;
  /* Farvision's address field repeats itself ("MIDNAPORE,MIDNAPORE,WEST MIDNAPORE") - the same part twice in
     a row is printed once, and the PIN gets its label as on Farvision's letter. Nothing else is changed. */
  const addr=String(c.contact_address||'').split(/\s*,\s*/).reduce((a,p)=>{ const t=p.replace(/\s+/g,' ').trim(); if(t&&(!a.length||a[a.length-1].toUpperCase()!==t.toUpperCase())) a.push(t); return a; },[])
    .join(', ').replace(/\s*\b(\d{6})\s*$/,' PIN:$1');
  const left=[[d.name,'',true]].concat(wrap(addr,half-M-20,reg,8).map(l=>[l,'']))
    .concat([['',''],['Contact No',': '+(c.contact_phone||'')],['Email',': '+String(c.contact_email||'').toUpperCase()],['GSTIN',': UnRegistered'],['PAN',': '+(d.pan||'-')]]);
  const right=[['Reminder No',': '+d.ref],['Reminder Date',': '+prmDmy(new Date().toISOString())],['Project',': '+d.project],['Floor',': '+d.floor],
    ['Category',': '+d.category],['Unit No',': '+(d.unit.unit_code||'')],['Tower',': '+(d.unit.tower||'')],['Booking No.',': '+d.booking_no],['Application No.',': '+(d.unit.application_no||'')]];
  const top=y;
  left.forEach((r,i)=>{ const yy=top-8-i*12.5; if(r[1]===''||r[2]){ txt(r[0],M,yy,{bold:!!r[2]}); } else { txt(r[0],M,yy); txt(r[1],M+64,yy); } });
  right.forEach((r,i)=>{ const yy=top-8-i*12.5; txt(r[0],half+37,yy); txt(r[1],half+110,yy); });
  y=top-12.5*Math.max(left.length,right.length)-14;
  txt('Dear Sir/Madam,',M,y-8); y-=20;
  wrap('According to which you had to deposit your due payment against the total value of your Unit. But after repeated Demand / reminder, you have not made payments. Now the company is providing you an opportunity to pay your dues, mentioned as under:',W-2*M,reg,8)
    .forEach(l=>{ txt(l,M,y-8); y-=11; });
  y-=10; txt('Outstanding details :',M+4,y-10,{bold:true,size:9.5}); y-=22;
  const cw=[150,92,52,52,40,60,52,42], ttl=['Particulars','Bill No.','Bill Date','Due Date','Due Days','Bill Amt.','Rec Amt.','Bal Amt.'], rgt=[0,0,0,0,1,1,1,1];
  const row=(cells,o)=>{ o=o||{}; const f=o.bold?bold:reg, s=7.6, pad=3, lh=s+2.6;
    const laid=cells.map((t,i)=>rgt[i]?[clean(t)]:wrap(t,cw[i]-2*pad,f,s)); const h=Math.max(...laid.map(x=>x.length))*lh+2*pad;
    if(y-h<M+30){ pg=doc.addPage([W,H]); y=H-M; if(!o.head) row(ttl,{bold:true,fill:GREY,head:true}); }
    let x=M; laid.forEach((ls,i)=>{ if(o.fill) pg.drawRectangle({x:x,y:y-h,width:cw[i],height:h,color:o.fill});
      pg.drawRectangle({x:x,y:y-h,width:cw[i],height:h,borderColor:INK,borderWidth:.5});
      ls.forEach((ln,j)=>{ const tw=f.widthOfTextAtSize(ln,s); pg.drawText(ln,{x:rgt[i]?x+cw[i]-pad-tw:x+pad,y:y-pad-s-j*lh+1.5,size:s,font:f,color:INK}); });
      x+=cw[i]; }); y-=h; };
  row(ttl,{bold:true,fill:GREY,head:true});
  d.lines.forEach(l=>row([l.particulars,l.bill_no,prmDmy(l.bill_date),prmDmy(l.due_date),String(l.days),prmMoney(l.bill),prmMoney(l.rec),prmMoney(l.bal)]));
  const sb_=d.lines.reduce((a,l)=>a+l.bill,0), sr=d.lines.reduce((a,l)=>a+l.rec,0);
  row(['Sub Total :','','','','',prmMoney(sb_),prmMoney(sr),prmMoney(d.lines.reduce((a,l)=>a+l.bal,0))],{bold:true,fill:GREY});
  // Money received but not yet set against any demand - Farvision's "On Account" - comes off the total.
  if(d.onacc>0.5) row(['Less : Amount received on account (not yet adjusted)','','','','','','','-'+prmMoney(d.onacc)],{bold:true});
  y-=12; wrap('Total Payable : Rupees '+prmWords(d.total)+' Only',W-2*M-80,bold,8.5).forEach((l,i,a)=>{ txt(l,M+4,y-9,{bold:true,size:8.5}); if(i===a.length-1) txt(prmMoney(d.total),W-M,y-9,{bold:true,size:8.5,align:'right'}); y-=12; });
  y-=14; if(y<M+90){ pg=doc.addPage([W,H]); y=H-M; }
  txt('Late Payment Fees Summary as on '+prmDmy(new Date().toISOString()),M,y-10,{bold:true,size:9}); y-=20;
  const lw=[120,105,105,105,105], lt=['','Late Payment Fee Accrued','Late Payment Fee Waived','Late Payment Fee Paid','Late Payment Fee Outstanding'];
  // Each heading wraps inside its own box - "Late Payment Fee Outstanding" ran into the box beside it.
  const lrow=(cells,b)=>{ const f=b?bold:reg, s=7.4, lines=cells.map((t,i)=>wrap(t,lw[i]-8,f,s)), h=Math.max(...lines.map(l=>l.length))*(s+2.4)+7;
    let x=M; lines.forEach((ls,i)=>{ pg.drawRectangle({x:x,y:y-h,width:lw[i],height:h,borderColor:INK,borderWidth:.5,color:b?GREY:undefined});
      ls.forEach((ln,j)=>{ const tw=f.widthOfTextAtSize(ln,s); pg.drawText(ln,{x:i?x+lw[i]-4-tw:x+4,y:y-4-s-j*(s+2.4)+1.5,size:s,font:f,color:INK}); }); x+=lw[i]; }); y-=h; };
  lrow(lt,true); lrow(['Sub Total :-',prmMoney(d.late),'-','-',prmMoney(d.late)]);
  y-=22; txt('Please ignore this letter if the payment has already been made.',M,y-8); y-=24;
  txt('For '+String(st.company_name||'The Jain Group'),M,y-8,{bold:true}); y-=40; txt('Authorised Signatory',M,y-8,{bold:true});
  const pages=doc.getPages(); pages.forEach((p,i)=>{ const t='Page '+(i+1)+' of '+pages.length; p.drawText(t,{x:(W-reg.widthOfTextAtSize(t,6.5))/2,y:22,size:6.5,font:reg,color:INK});
    const s='This is a system generated letter. No signature required.'; p.drawText(s,{x:M,y:22,size:6.5,font:reg,color:L.rgb(.4,.4,.4)}); });
  return await doc.save();
}
// Opens a customer's letter in a new tab - nothing is sent.
window.prmLetter=async function(ix){
  const r=PRM.rows[ix]; if(!r) return;
  const w=window.open('','_blank');
  try{
    const d=await prmLetterData(r.booking_no);
    if(d.net!=null&&Math.abs(d.net-d.total)>1) toast('Letter lines total ₹'+prmInr(d.total)+' but Farvision’s outstanding says ₹'+prmInr(d.net)+' - check before sending','warn');
    const url=URL.createObjectURL(new Blob([await prmLetterPdf(d)],{type:'application/pdf'}));
    if(w) w.location=url; else location.assign(url);
  }catch(e){ if(w) w.close(); toast('Could not build the letter: '+e.message,'err'); }
};
window.prmSel=function(ix,on){ const r=PRM.rows[ix]; if(!r) return; if(on) PRM.sel.add(r.booking_no); else PRM.sel.delete(r.booking_no); prmList(); };
window.prmSelGroup=function(gi,on){ const p=(PRM._grp||[])[gi]; PRM.rows.filter(r=>r.project===p&&prmPick(r)).forEach(r=>{ if(on) PRM.sel.add(r.booking_no); else PRM.sel.delete(r.booking_no); }); prmList(); };
window.prmSelShown=function(on){ prmShown().forEach(r=>{ if(on) PRM.sel.add(r.booking_no); else PRM.sel.delete(r.booking_no); }); prmList(); };

