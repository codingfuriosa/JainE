/* ============================ POST SALES - CUSTOMER TICKETS (30 Oct 2026) ============================
   What customers have written to Post Sales, as tickets. Fed every 10 minutes from Pallabita Ghosh's
   mailbox (customercare1@), read-only, by customer-invite's postsales_mail_sync: each Gmail
   conversation a customer starts is a ticket, her replies in it are recorded, and Gemini gives each
   a category, a one-line summary and an urgency. The customer is matched from Farvision.
   Statuses: open (the customer is waiting for us), answered (we replied last), resolved (closed here).
   Route: postsales/tickets[/<id>]. WhatsApp and calls are meant to join the same list (channel). */
const PST={rows:[],f:{status:'waiting',cat:'',proj:'',q:'',real:true},state:null};
const PST_CATS=['Payment & Receipts','Demand / Invoice','Documents & Agreement','Registration','Possession & Handover',
  'Construction Progress','Maintenance & Repairs','Home Loan & Bank','Cancellation & Refund','Complaint','General Enquiry','Other'];
const PS_T=()=>sb.schema('postsales');
function pstAgo(iso){
  if(!iso) return '—';
  const m=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/60000));
  if(m<60) return m+' min'; const h=Math.round(m/60); if(h<48) return h+' h'; return Math.round(h/24)+' days';
}
function pstDT(iso){ return iso?new Date(iso).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—'; }
function pstHours(a,b){ return (new Date(b)-new Date(a))/3600000; }
function pstFmtH(h){ if(h==null||!isFinite(h)) return '—'; if(h<1) return Math.round(h*60)+' min'; if(h<48) return (Math.round(h*10)/10)+' h'; return (Math.round(h/24*10)/10)+' days'; }
function pstStatusTag(t){
  if(t.status==='resolved') return '<span class="tag t-green">Resolved</span>';
  if(t.status==='answered') return '<span class="tag t-blue">Answered</span>';
  return '<span class="tag t-amber">Waiting for us</span>';
}
function pstUrg(u){ return u==='high'?'<span class="tag t-red">High</span>':(u==='low'?'<span class="tag t-gray">Low</span>':'<span class="tag t-gray">Normal</span>'); }
function pstUnit(t){ return [t.project,[t.tower,t.unit_code].filter(Boolean).join(' - ')].filter(Boolean).join(' · '); }
function pstStyles(){
  if($('pstStyles')) return;
  const s=document.createElement('style'); s.id='pstStyles';
  s.textContent=`
  .pst-sync{font-size:12px;color:var(--slate);margin:2px 0 12px}
  .pst-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:14px 0}
  @media(max-width:820px){.pst-grid{grid-template-columns:1fr}}
  .pst-bars .r{display:flex;align-items:center;gap:10px;margin:7px 0;font-size:13px;cursor:pointer}
  .pst-bars .r:hover .l{color:var(--brand)}
  .pst-bars .l{width:190px;flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pst-bars .b{flex:1;height:10px;border-radius:6px;background:var(--bg-subtle,#f1f5f9);overflow:hidden}
  .pst-bars .b i{display:block;height:100%;background:#7e22ce;border-radius:6px}
  .pst-bars .n{width:34px;text-align:right;font-weight:700}
  .pst-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0 12px}
  .pst-chip{height:32px;padding:0 12px;border-radius:20px;border:1px solid var(--line);background:#fff;font:600 12.5px inherit;font-family:inherit;cursor:pointer}
  .pst-chip.on{background:#7e22ce;border-color:#7e22ce;color:#fff}
  .pst-q{height:34px;border:1px solid var(--line);border-radius:9px;padding:0 10px;font:13px inherit;font-family:inherit;min-width:220px;margin-left:auto}
  .pst-sel{height:34px;border:1px solid var(--line);border-radius:9px;padding:0 8px;font:13px inherit;font-family:inherit;background:#fff}
  #pstTbl td{vertical-align:top}
  #pstTbl tbody tr{cursor:pointer}
  .pst-sum{font-size:12.5px;color:var(--slate);margin-top:3px;line-height:1.45}
  .pst-thread{display:flex;flex-direction:column;gap:12px}
  .pst-msg{max-width:84%;border:1px solid var(--line);border-radius:14px;padding:11px 14px;background:#fff}
  .pst-msg.out{align-self:flex-end;background:#f5f3ff;border-color:#e9d5ff}
  .pst-msg .h{font-size:11.5px;color:var(--slate);margin-bottom:6px}
  .pst-msg .b{font-size:13.5px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}`;
  document.head.appendChild(s);
}
window.pstRender=async function(host,seg){
  pstStyles();
  if(seg&&seg[0]) return pstTicketPage(host,Number(seg[0]));
  loader(host);
  const [tk,st]=await Promise.all([
    PS_T().from('tickets').select('*').order('last_customer_at',{ascending:false,nullsFirst:false}).limit(2000),
    PS_T().from('mail_sync_state').select('*')
  ]);
  if(tk.error){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load tickets: '+esc(tk.error.message)+'</div></div>'; return; }
  PST.rows=tk.data||[]; PST.state=(st.data||[])[0]||null;
  pstDraw(host);
};
function pstVisible(){
  const f=PST.f, q=f.q.trim().toLowerCase();
  return PST.rows.filter(function(t){
    if(f.real&&t.is_ticket===false) return false;
    if(f.status==='waiting'&&t.status!=='open') return false;
    if(f.status==='answered'&&t.status!=='answered') return false;
    if(f.status==='resolved'&&t.status!=='resolved') return false;
    if(f.status==='active'&&t.status==='resolved') return false;
    if(f.cat&&t.category!==f.cat) return false;
    if(f.proj&&t.project!==f.proj) return false;
    if(q){ const b=[t.customer_name,t.customer_email,t.subject,t.summary,t.project,t.tower,t.unit_code,t.category].join(' ').toLowerCase(); if(q.split(/\s+/).some(w=>b.indexOf(w)===-1)) return false; }
    return true;
  });
}
function pstDraw(host){
  host=host||$('pstBody'); if(!host) return;
  const real=PST.rows.filter(t=>t.is_ticket!==false);
  const open=real.filter(t=>t.status==='open'), ans=real.filter(t=>t.status==='answered');
  const monthStart=new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  const weekAgo=Date.now()-7*86400000;
  const newWeek=real.filter(t=>t.first_received_at&&new Date(t.first_received_at).getTime()>=weekAgo).length;
  const resolvedMonth=real.filter(t=>t.resolved_at&&new Date(t.resolved_at)>=monthStart).length;
  const replied=real.filter(t=>t.first_reply_at&&t.first_received_at&&new Date(t.first_received_at).getTime()>=Date.now()-30*86400000);
  const avgFirst=replied.length?replied.reduce((s,t)=>s+pstHours(t.first_received_at,t.first_reply_at),0)/replied.length:null;
  const oldest=open.slice().sort((a,b)=>String(a.last_customer_at).localeCompare(String(b.last_customer_at)))[0];
  const kpis=mKpis([
    ['Waiting for us',String(open.length),oldest?('oldest '+pstAgo(oldest.last_customer_at)):'none waiting',open.length?'#b45309':'#16a34a'],
    ['Answered',String(ans.length),'waiting on the customer'],
    ['New this week',String(newWeek),'customer conversations'],
    ['Resolved this month',String(resolvedMonth),''],
    ['First reply',pstFmtH(avgFirst),'average, last 30 days']
  ]);
  const active=real.filter(t=>t.status!=='resolved');
  const count=function(key){ const m={}; active.forEach(t=>{ const k=t[key]||'Not known'; m[k]=(m[k]||0)+1; }); return Object.entries(m).sort((a,b)=>b[1]-a[1]); };
  const bars=function(title,list,setKey){
    const max=Math.max(1,...list.map(x=>x[1]));
    return '<div class="card card-pad"><div class="sec-title" style="margin:0 0 10px">'+esc(title)+' <span style="font-weight:500;color:var(--slate);font-size:12px">· not yet resolved</span></div><div class="pst-bars">'
      +(list.length?list.slice(0,8).map(x=>'<div class="r" onclick="pstSet(\''+setKey+'\',\''+esc(x[0]).replace(/'/g,"\\'")+'\')"><span class="l" title="'+esc(x[0])+'">'+esc(x[0])+'</span><span class="b"><i style="width:'+Math.round(x[1]/max*100)+'%"></i></span><span class="n">'+x[1]+'</span></div>').join('')
        :'<div style="color:var(--slate);font-size:13px">Nothing open</div>')+'</div></div>';
  };
  const st=PST.state;
  const sync='<div class="pst-sync"><i class="fa-solid fa-envelope"></i> From <b>'+esc((st&&st.mailbox)||'customercare1@thejaingroup.com')+'</b> · '
    +(st&&st.last_run_at?('last checked '+pstAgo(st.last_run_at)+' ago'):'not checked yet - the first read runs within 10 minutes')
    +(st&&st.last_error?' · <span style="color:#b91c1c">last error: '+esc(st.last_error)+'</span>':'')+'</div>';
  const f=PST.f;
  const chip=(k,l)=>'<button class="pst-chip'+(f.status===k?' on':'')+'" onclick="pstSet(\'status\',\''+k+'\')">'+l+'</button>';
  const projects=[...new Set(PST.rows.map(t=>t.project).filter(Boolean))].sort();
  const rows=pstVisible();
  host.innerHTML=sync+kpis
    +'<div class="pst-grid">'+bars('By category',count('category'),'cat')+bars('By project',count('project'),'proj')+'</div>'
    +'<div class="pst-bar">'+chip('waiting','Waiting for us')+chip('answered','Answered')+chip('active','All open')+chip('resolved','Resolved')+chip('all','All')
      +'<select class="pst-sel" onchange="pstSet(\'cat\',this.value)"><option value="">All categories</option>'+PST_CATS.map(c=>'<option'+(f.cat===c?' selected':'')+'>'+esc(c)+'</option>').join('')+'</select>'
      +'<select class="pst-sel" onchange="pstSet(\'proj\',this.value)"><option value="">All projects</option>'+projects.map(p=>'<option'+(f.proj===p?' selected':'')+'>'+esc(p)+'</option>').join('')+'</select>'
      +'<label style="font-size:12.5px;display:flex;align-items:center;gap:6px"><input type="checkbox"'+(f.real?' checked':'')+' onchange="pstSet(\'real\',this.checked)"> Real issues only</label>'
      +'<input class="pst-q" id="pstQ" placeholder="Search customer, flat, subject…" value="'+esc(f.q)+'" oninput="PST.f.q=this.value;pstDrawList()"></div>'
    +'<div class="card" style="padding:0"><div style="overflow-x:auto" id="pstList"></div></div>';
  pstDrawList();
}
window.pstDrawList=function(){
  const host=$('pstList'); if(!host) return;
  const rows=pstVisible();
  host.innerHTML='<table class="tbl" id="pstTbl" style="width:100%"><thead><tr><th>Received</th><th>Customer</th><th>What it is about</th><th>Category</th><th>Urgency</th><th>Status</th><th>Waiting</th></tr></thead><tbody>'
    +(rows.length?rows.map(t=>'<tr onclick="navTo(\'postsales/tickets/'+t.id+'\')">'
      +'<td style="white-space:nowrap">'+pstDT(t.first_received_at)+'</td>'
      +'<td><b>'+esc(t.customer_name||t.customer_email||'—')+'</b><div class="pst-sum">'+esc(pstUnit(t)||t.customer_email||'')+'</div></td>'
      +'<td><div style="font-weight:600">'+esc(t.subject||'(no subject)')+'</div>'+(t.summary?'<div class="pst-sum">'+esc(t.summary)+'</div>':(t.needs_ai?'<div class="pst-sum"><i>being read…</i></div>':''))+'</td>'
      +'<td>'+esc(t.category||'—')+'</td><td>'+pstUrg(t.urgency)+'</td><td>'+pstStatusTag(t)+'</td>'
      +'<td style="white-space:nowrap;'+(t.status==='open'?'font-weight:700;color:#b45309':'color:var(--slate)')+'">'+(t.status==='open'?pstAgo(t.last_customer_at):'—')+'</td></tr>').join('')
      :'<tr><td colspan="7"><div class="empty" style="padding:26px">'+(PST.rows.length?'No tickets match these filters':'No customer emails read yet - the mailbox is read every 10 minutes')+'</div></td></tr>')
    +'</tbody></table>';
};
window.pstSet=function(k,v){ PST.f[k]=(k==='real')?!!v:((PST.f[k]===v&&k!=='status')?'':v); if(k==='cat'||k==='proj') PST.f.status=PST.f.status==='waiting'?'active':PST.f.status; pstDraw(); };

async function pstTicketPage(host,id){
  loader(host);
  const [t,m]=await Promise.all([PS_T().from('tickets').select('*').eq('id',id).maybeSingle(),
    PS_T().from('ticket_messages').select('*').eq('ticket_id',id).order('sent_at',{ascending:true})]);
  const tk=t.data; if(!tk){ host.innerHTML='<div class="empty">Ticket not found</div>'; return; }
  let people=[]; try{ people=(await getPeople()).filter(p=>Array.isArray(p.depts)&&p.depts.indexOf('Post Sales')!==-1); }catch(e){}
  const msgs=m.data||[];
  host.innerHTML='<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">'
      +'<button class="btn" onclick="history.length>1?history.back():navTo(\'postsales/tickets\')"><i class="fa-solid fa-arrow-left"></i> Back</button>'
      +'<div style="flex:1;min-width:240px"><div style="font-size:17px;font-weight:750">'+esc(tk.subject||'(no subject)')+'</div>'
      +'<div style="font-size:12.5px;color:var(--slate)">'+esc(tk.customer_name||'')+' · '+esc(tk.customer_email||'')+(pstUnit(tk)?' · '+esc(pstUnit(tk)):'')+(tk.customer_phone?' · '+esc(tk.customer_phone):'')+'</div></div>'
      +pstStatusTag(tk)+' '+pstUrg(tk.urgency)
      +(tk.status==='resolved'?'<button class="btn" onclick="pstResolve('+id+',false)"><i class="fa-solid fa-rotate-left"></i> Reopen</button>'
        :'<button class="btn btn-primary" onclick="pstResolve('+id+',true)"><i class="fa-solid fa-check"></i> Mark resolved</button>')
    +'</div>'
    +'<div class="grid" style="grid-template-columns:minmax(0,1fr) 280px;gap:16px">'
      +'<div class="card card-pad"><div class="pst-thread">'+msgs.map(x=>'<div class="pst-msg '+x.direction+'"><div class="h"><b>'+esc(x.direction==='in'?(x.from_name||x.from_email):'Post Sales')+'</b> · '+pstDT(x.sent_at)+'</div><div class="b">'+esc(x.body||'(no text)')+'</div></div>').join('')+'</div></div>'
      +'<div class="card card-pad" style="height:fit-content">'
        +'<div class="sec-title" style="margin:0 0 8px">Summary</div><div style="font-size:13px;line-height:1.5">'+esc(tk.summary||'—')+'</div>'
        +'<div class="sec-title" style="margin:14px 0 6px">Category</div><select class="pst-sel" style="width:100%" onchange="pstSetField('+id+',\'category\',this.value)">'+PST_CATS.map(c=>'<option'+(tk.category===c?' selected':'')+'>'+esc(c)+'</option>').join('')+'</select>'
        +'<div class="sec-title" style="margin:14px 0 6px">Handled by</div><select class="pst-sel" style="width:100%" onchange="pstSetField('+id+',\'assigned_to\',this.value)"><option value="">Nobody yet</option>'+people.map(p=>'<option value="'+esc(p.email)+'"'+(tk.assigned_to===p.email?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select>'
        +'<div style="font-size:12px;color:var(--slate);margin-top:14px;line-height:1.6">First received '+pstDT(tk.first_received_at)+'<br>First reply '+(tk.first_reply_at?pstDT(tk.first_reply_at)+' ('+pstFmtH(pstHours(tk.first_received_at,tk.first_reply_at))+')':'not yet')
          +(tk.resolved_at?'<br>Resolved '+pstDT(tk.resolved_at):'')+'<br>'+tk.messages+' message'+(tk.messages===1?'':'s')+'</div>'
        +'<div style="font-size:11.5px;color:var(--slate);margin-top:12px">Replies are written in Gmail as usual - they appear here within 10 minutes.</div>'
      +'</div></div>';
}
window.pstResolve=async function(id,done){
  const {error}=await PS_T().from('tickets').update(done?{status:'resolved',resolved_at:new Date().toISOString(),resolved_by:state.email}:{status:'open',resolved_at:null,resolved_by:null}).eq('id',id);
  if(error){ toast(error.message,'err'); return; }
  toast(done?'Ticket resolved':'Ticket reopened','ok'); pstTicketPage($('pstBody'),id);
};
window.pstSetField=async function(id,k,v){
  const {error}=await PS_T().from('tickets').update({[k]:v||null}).eq('id',id);
  if(error) toast(error.message,'err'); else toast('Saved','ok');
};
