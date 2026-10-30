/* ============================ POST SALES - OUTSTANDING REMINDERS (30 Oct 2026) ============================
   The list of customers to remind about their outstanding amount, rebuilt every morning from
   Farvision's "Customer Outstanding Summary" that the Customer Portal imports
   (postsales.outstanding_reminder_list): Dream Gurukul, Dream Ananta, Dream Gateway Pailan Projects and
   Dream Jain-Pailan, Net Outstanding above zero, each with their email and what changed since the
   file before. The email itself is fixed (postsales.reminder_settings) - its wording is changed on
   request, not on this page; here it can only be seen, filled in for any one customer.
   SENDING IS SWITCHED OFF: nothing on this page emails anybody. Route: postsales/reminders. */
const PRM={rows:[],settings:null,f:{proj:'',view:'remind',q:''},sel:new Set()};
const PRM_TEST='TEST CUSTOMERS';
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
  .prm-lock{margin-left:auto;display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px;border-radius:20px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:12px;font-weight:650}
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
  #prmTbl tr.grp.test td{background:#eff6ff;color:#1e40af}
  #prmTbl tbody tr.row.sel td{background:#faf5ff}
  .prm-selbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--bg-subtle,#f8fafc);font-size:13px}
  .prm-selbar b{color:var(--ink)}`;
  document.head.appendChild(s);
}
window.prmRender=async function(host){
  prmStyles(); loader(host);
  const [l,s,t]=await Promise.all([sb.schema('postsales').rpc('outstanding_reminder_list'), sb.schema('postsales').from('reminder_settings').select('*').eq('id',1).maybeSingle(),
    sb.schema('postsales').from('reminder_test_recipients').select('*').order('id')]);
  if(l.error){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not build the list: '+esc(l.error.message)+'</div></div>'; return; }
  // Test customers sit in their own group at the top; they never come from Farvision.
  const tests=((t&&t.data)||[]).map(x=>({booking_no:'TEST-'+x.id,test_id:x.id,test:true,customer_name:x.customer_name,project:PRM_TEST,tower:'',unit_code:x.flat||'Test',
    net_outstanding:x.net_outstanding,prev_net:x.net_outstanding,change:'test',email:x.email,held:false,hold_reason:null}));
  PRM.rows=tests.concat(l.data||[]); PRM.settings=s.data||{};
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
  const remind=PRM.rows.filter(r=>!r.test&&prmIn(r,'remind')), changes=PRM.rows.filter(r=>prmIn(r,'changes')),
        held=PRM.rows.filter(r=>prmIn(r,'held')), removed=PRM.rows.filter(r=>prmIn(r,'removed'));
  const total=remind.reduce((a,r)=>a+Number(r.net_outstanding||0),0);
  const stat=(view,l,v,s)=>'<div class="prm-stat'+(PRM.f.view===view?' on':'')+'" onclick="PRM.f.view=\''+view+'\';prmDraw()"><div class="l">'+l+'</div><div class="v">'+v+'</div><div class="s">'+s+'</div></div>';
  const projects=[...new Set(PRM.rows.filter(r=>r.change!=='removed').map(r=>r.project))].sort();
  const pc=p=>PRM.rows.filter(r=>prmIn(r,PRM.f.view)&&(!p||r.project===p)).length;
  host.innerHTML='<div class="prm-head"><div class="prm-src"><i class="fa-solid fa-file-excel" style="color:#16a34a"></i> From Farvision\u2019s <b>Customer Outstanding Summary</b>, '
      +(any.file_date?pstDT(any.file_date):'—')+(any.prev_file_date?' &middot; compared with '+pstDT(any.prev_file_date):'')+'</div>'
      +'<button class="btn btn-sm" onclick="prmShowEmail()"><i class="fa-solid fa-envelope"></i> View the email</button>'
      +'<span class="prm-lock"><i class="fa-solid fa-lock"></i> Sending is off</span></div>'
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
        +'<div class="prm-q"><i class="fa-solid fa-magnifying-glass"></i><input placeholder="Search name, flat, email…" value="'+esc(PRM.f.q)+'" oninput="PRM.f.q=this.value;prmList()"></div>'
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
  const body=Object.keys(groups).sort((a,b)=>(a===PRM_TEST?-1:b===PRM_TEST?1:a.localeCompare(b))).map(function(p){
    const g=groups[p], t=g.reduce((a,r)=>a+Number(r.net_outstanding||0),0);
    const can=g.filter(r=>r.change!=='removed'&&r.email&&!r.held), allOn=can.length&&can.every(r=>PRM.sel.has(r.booking_no));
    PRM._grp=PRM._grp||[]; const gi=PRM._grp.indexOf(p)>=0?PRM._grp.indexOf(p):(PRM._grp.push(p)-1);
    return '<tr class="grp'+(p===PRM_TEST?' test':'')+'"><td style="width:38px">'+(can.length?'<input type="checkbox" class="prm-cb"'+(allOn?' checked':'')+' title="Select this whole group" onchange="prmSelGroup('+gi+',this.checked)">':'')+'</td><td colspan="4">'+esc(p===PRM_TEST?'Test customers':prmProj(p))+' &middot; '+g.length+' customer'+(g.length===1?'':'s')
      +(p===PRM_TEST?' <button class="btn btn-sm" style="margin-left:8px" onclick="prmAddTest()"><i class="fa-solid fa-plus"></i> Add</button>':'')+'<span class="t">₹'+prmInr(t)+'</span></td></tr>'
      +g.map(function(r){ const ix=PRM.rows.indexOf(r);
        const selectable=r.change!=='removed'&&r.email&&!r.held;
        return '<tr class="row'+(PRM.sel.has(r.booking_no)?' sel':'')+'"><td style="width:38px">'+(selectable?'<input type="checkbox" class="prm-cb"'+(PRM.sel.has(r.booking_no)?' checked':'')+' onchange="prmSel('+ix+',this.checked)">':'')+'</td><td><div class="prm-who">'+avatar(prmName(r)||'?')+'<div style="min-width:0"><div class="prm-nm">'+esc(String(r.customer_name||'').trim())+badge(r)+'</div>'
          +'<div class="prm-sub">Flat '+esc(prmFlat(r))+' &middot; '+esc(r.booking_no||'')+'</div>'
          +(r.held?'<div class="prm-sub" style="color:#b91c1c"><i class="fa-solid fa-hand"></i> '+esc(r.hold_reason||'')+'</div>':'')+'</div></div></td>'
          +'<td class="prm-email">'+(r.email?esc(r.email):'<span style="color:#b91c1c">No email on record</span>')+'</td>'
          +'<td class="prm-amt">₹'+prmInr(r.net_outstanding)+(r.change==='changed'||r.change==='removed'?'<span class="prm-old">₹'+prmInr(r.prev_net)+'</span>':'')+'</td>'
          +'<td class="prm-act">'+(r.test?'<button class="prm-ibtn" title="See the email" onclick="prmPreview('+ix+')"><i class="fa-solid fa-eye"></i></button><button class="prm-ibtn" title="Remove this test customer" onclick="prmDelTest('+r.test_id+')"><i class="fa-solid fa-trash"></i></button>':'')+(!r.test&&r.change!=='removed'
            ?'<button class="prm-ibtn" title="See the email this customer would get" onclick="prmPreview('+ix+')"><i class="fa-solid fa-eye"></i></button>'
              +(r.held?'<button class="prm-ibtn" title="Release - remind again" onclick="prmUnhold('+ix+')"><i class="fa-solid fa-rotate-left"></i></button>'
                :'<button class="prm-ibtn" title="Hold - do not remind" onclick="prmHold('+ix+')"><i class="fa-solid fa-hand"></i></button>'):'')+'</td></tr>'; }).join('');
  }).join('');
  const hasTest=PRM.rows.some(r=>r.test);
  const testAdd=(!hasTest&&(f.view==='remind'))?'<tr class="grp test"><td></td><td colspan="4">Test customers &middot; none yet <button class="btn btn-sm" style="margin-left:8px" onclick="prmAddTest()"><i class="fa-solid fa-plus"></i> Add a test customer</button></td></tr>':'';
  host.innerHTML='<table id="prmTbl"><thead><tr><th></th><th>Customer</th><th>Email</th><th style="text-align:right">Net Outstanding</th><th></th></tr></thead><tbody>'
    +testAdd+(body||'<tr><td colspan="5"><div class="empty" style="padding:26px">Nobody here</div></td></tr>')+'</tbody></table>';
  prmSelBar();
};
function prmEmailHtml(subj,body,to){
  const st=PRM.settings||{};
  return '<div style="color:var(--slate);font-size:12.5px;line-height:1.75"><b>From</b> Pallabita Ghosh - The Jain Group &lt;customercare1@thejaingroup.com&gt;'
      +(to!=null?'<br><b>To</b> '+esc(to||'(no email)'):'')+'<br><b>Subject</b> '+esc(subj)
      +'<br><b>Attachment</b> '+(st.attachment_name?esc(st.attachment_name):'none')+'</div>'
    +'<div style="margin-top:12px;padding:16px;border:1px solid var(--line);border-radius:12px;white-space:pre-wrap;line-height:1.65;font-size:13.5px">'+esc(body)+'</div>';
}
// The fixed email, with its placeholders showing. Changes to it are made on request.
window.prmShowEmail=function(){
  const st=PRM.settings||{};
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-envelope"></i> The reminder email</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="width:min(94vw,660px)">'+prmEmailHtml(st.subject||'',st.body||'',null)
      +'<div style="font-size:12px;color:var(--slate);margin-top:10px">Words in {curly brackets} are filled in for each customer. To change the wording or add an attachment, ask - it is not edited here.</div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>','md');
};
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
  const sel=PRM.rows.filter(r=>PRM.sel.has(r.booking_no)), tests=sel.filter(r=>r.test).length;
  const total=sel.filter(r=>!r.test).reduce((a,r)=>a+Number(r.net_outstanding||0),0);
  b.innerHTML='<span><b>'+sel.length+'</b> selected'+(sel.length?' &middot; ₹'+prmInr(total)+(tests?' &middot; '+tests+' test':''):'')+'</span>'
    +'<button class="btn btn-sm" onclick="prmSelShown(true)">Select all shown</button>'
    +'<button class="btn btn-sm" onclick="prmSelShown(false)">Unselect all shown</button>'
    +(sel.length?'<button class="btn btn-sm" onclick="PRM.sel.clear();prmList()">Clear selection</button>':'')
    +(tests?'<button class="btn btn-sm btn-primary" style="margin-left:auto" onclick="prmSendTest()" title="Test customers only - real customers cannot be emailed yet. Goes from your own Gmail (Connect Google)."><i class="fa-solid fa-paper-plane"></i> Send to '+tests+' test customer'+(tests===1?'':'s')+'</button>'
      :'<button class="btn btn-sm" style="margin-left:auto" disabled title="Only test customers can be emailed for now"><i class="fa-solid fa-paper-plane"></i> Send (test customers only)</button>')
    +(sel.length>tests?'<span style="font-size:12px;color:var(--slate)">'+(sel.length-tests)+' real customer'+(sel.length-tests===1?'':'s')+' will not be emailed</span>':'');
}
/* TEMPORARY TEST SENDING (30 Oct 2026): only the ticked test customers go to the server, from Ayush's own
   account. The server takes test ids only and refuses anything else, so real customers cannot be emailed. */
window.prmSendTest=async function(){
  const tests=PRM.rows.filter(r=>r.test&&PRM.sel.has(r.booking_no));
  if(!tests.length) return;
  if(!await confirmDialog('Send the reminder email to '+tests.length+' test customer'+(tests.length===1?'':'s')+'?\n\n'+tests.map(r=>r.email).join('\n'))) return;
  try{
    const {data:{session}}=await sb.auth.getSession();
    const res=await fetch(SUPABASE_URL+'/functions/v1/customer-invite',{method:'POST',
      headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+((session&&session.access_token)||'')},
      body:JSON.stringify({action:'reminder_send',test_ids:tests.map(r=>r.test_id)})});
    const out=await res.json().catch(()=>({}));
    if(out.code==='google_not_connected'){
      // Sent through the sender's own Google connection (the same one Meetings uses) - offer to connect it.
      if(await confirmDialog(out.error+'\n\nConnect Google now? You will come back to JAIN-E afterwards.'))
        location.href=SUPABASE_URL+'/functions/v1/google-oauth-start?email='+encodeURIComponent(state.email);
      return;
    }
    if(!res.ok||out.error) throw new Error(out.error||('HTTP '+res.status));
    toast('Sent '+out.sent+(out.failed?', '+out.failed+' failed':'')+' (from '+out.from+')',out.failed?'warn':'ok');
    if(out.failed) console.warn('Reminder send failures',out.results);
  }catch(e){ toast(e.message,'err'); }
};
window.prmSel=function(ix,on){ const r=PRM.rows[ix]; if(!r) return; if(on) PRM.sel.add(r.booking_no); else PRM.sel.delete(r.booking_no); prmList(); };
window.prmSelGroup=function(gi,on){ const p=(PRM._grp||[])[gi]; PRM.rows.filter(r=>r.project===p&&prmPick(r)).forEach(r=>{ if(on) PRM.sel.add(r.booking_no); else PRM.sel.delete(r.booking_no); }); prmList(); };
window.prmSelShown=function(on){ prmShown().forEach(r=>{ if(on) PRM.sel.add(r.booking_no); else PRM.sel.delete(r.booking_no); }); prmList(); };
window.prmAddTest=function(){
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-user-plus"></i> Add a test customer</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm" style="width:min(94vw,460px)">'
      +'<label>Name</label><input id="prmTN" placeholder="e.g. Test - Ayush">'
      +'<label>Email</label><input id="prmTE" placeholder="name@example.com">'
      +'<div class="two"><div><label>Flat</label><input id="prmTF" placeholder="e.g. 4G, Block B"></div><div><label>Amount (Rs.)</label><input id="prmTA" value="10000"></div></div>'
      +'<div style="font-size:12px;color:var(--slate);margin-top:8px">Shown in its own Test customers group, never mixed with real customers.</div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="prmSaveTest()"><i class="fa-solid fa-check"></i> Add</button></div>','md');
};
window.prmSaveTest=async function(){
  const nm=String(($('prmTN')||{}).value||'').trim(), em=String(($('prmTE')||{}).value||'').trim().toLowerCase();
  if(!nm||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){ toast('A name and a valid email are needed','warn'); return; }
  const amt=Number(String(($('prmTA')||{}).value||'').replace(/[^0-9.]/g,''))||10000;
  const {error}=await sb.schema('postsales').from('reminder_test_recipients').insert({customer_name:nm,email:em,flat:String(($('prmTF')||{}).value||'').trim()||null,net_outstanding:amt,added_by:state.email});
  if(error){ toast(error.message,'err'); return; }
  closeModal(); toast('Test customer added','ok'); prmRender($('prmBody'));
};
window.prmDelTest=async function(id){
  if(!await confirmDialog('Remove this test customer?')) return;
  const {error}=await sb.schema('postsales').from('reminder_test_recipients').delete().eq('id',id);
  if(error){ toast(error.message,'err'); return; }
  PRM.sel.delete('TEST-'+id); prmRender($('prmBody'));
};
