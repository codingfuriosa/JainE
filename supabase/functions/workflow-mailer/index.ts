import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
const cors = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, GET, OPTIONS' };
const j = (o:any,s=200)=> new Response(JSON.stringify(o),{status:s,headers:{...cors,'Content-Type':'application/json'}});
const esc = (s:any)=> String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

Deno.serve(async (req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  const GU=Deno.env.get('GMAIL_USER'), GP=Deno.env.get('GMAIL_APP_PASSWORD');
  const PORTAL=(Deno.env.get('PORTAL_URL')||'https://jaingroupe.netlify.app').replace(/\/$/,'');
  const u=new URL(req.url);
  if(u.searchParams.get('debug')==='1'){ return j({ hasUser:!!GU, hasPass:!!GP, portalUsed:PORTAL }); }
  if(!GU||!GP) return j({error:'Gmail secrets (GMAIL_USER / GMAIL_APP_PASSWORD) are not set.'},500);
  const SB=Deno.env.get('SUPABASE_URL'), SRV=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const H={ apikey:SRV, Authorization:'Bearer '+SRV } as any;
  const AP={...H,'Accept-Profile':'acc'} as any;

  let body:any={}; try{ body = await req.json(); }catch(_){}
  const type = body.type || 'assigned';

  async function nameFor(email:string){
    if(!email) return '';
    try{ const r=await fetch(SB+'/rest/v1/user_profile?email=eq.'+encodeURIComponent(email)+'&select=full_name',{headers:AP}); const rows=await r.json(); if(Array.isArray(rows)&&rows[0]&&rows[0].full_name) return rows[0].full_name; }catch(_){}
    return email;
  }

  const LOGO = PORTAL+'/assets/jaine-logo-full-white.png';
  const HEADER = "<div style='background:#0a0a0c;background:linear-gradient(180deg,#0a0a0c,#171719);padding:16px 24px;border-bottom:2px solid #e0121c'><table role='presentation' cellpadding='0' cellspacing='0' border='0'><tr><td style='vertical-align:middle;padding-right:13px'><img src='"+LOGO+"' alt='JAIN-E' height='24' style='display:block;height:24px;width:auto;border:0'></td><td style='vertical-align:middle'><span style='color:#c7c7ca;font-size:12px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase'>Workflow</span></td></tr></table></div>";
  const FOOT = "<div style='padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0'><p style='margin:0;color:#94a3b8;font-size:12px;line-height:1.5'>Automated message from the JAIN-E Accountability &middot; Workflow module. Please do not reply to this email.</p></div>";
  function shell(inner:string, wide=false){ return "<div style='margin:0;padding:24px;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif'><div style='max-width:"+(wide?'680':'520')+"px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0'>"+HEADER+"<div style='padding:24px'>"+inner+"</div>"+FOOT+"</div></div>"; }
  function row(k:string,v:string){ return "<tr><td style='padding:9px 0;color:#64748b;border-top:1px solid #eef2f6;width:130px'>"+esc(k)+"</td><td style='padding:9px 0;color:#0f172a;border-top:1px solid #eef2f6;font-weight:600'>"+esc(v)+"</td></tr>"; }

  /* An entry-wise instance read back as a table, the same shape it has in the app.
     Splitting has to follow the same rules or the mail contradicts the screen: if any field uses the
     entry separator, every field splits on that alone; otherwise the entry count comes from the Date,
     which holds one value per entry, and a field only splits on commas if it yields that same count.
     Without that, one entry claiming "20, 40, 60" would be read as three entries here too. */
  const DAY_COLS=['Date','Transport / Food','Description of Expense','Amount','Km'];
  // One Amount box holds two figures, so the heading has to say which is which - same as the app.
  const COL_HEAD:any={'Amount':'Transport Cost / Food Cost'};
  function money(x:string){
    const parts=String(x==null?'':x).split(',').map(p=>p.trim()).filter(Boolean);
    if(!parts.length) return '';
    return parts.map(p=>{ const n=parseFloat(p.replace(/[^0-9.]/g,'')); return isNaN(n)?esc(p):('₹'+n.toLocaleString('en-IN')); }).join(', ');
  }
  function cellSum(x:string){
    return String(x==null?'':x).split(',').map(p=>parseFloat(String(p).replace(/[^0-9.]/g,'')))
      .filter(n=>!isNaN(n)).reduce((a,b)=>a+b,0);
  }
  function splitterFor(det:any[]){
    const anyPipe=(det||[]).some(d=>String((d&&d.value)||'').indexOf('|')!==-1);
    if(anyPipe) return (v:any)=>{ const s=String(v==null?'':v); return s.indexOf('|')!==-1 ? s.split('|').map(x=>x.trim()) : [s.trim()]; };
    let n=1;
    (det||[]).forEach(d=>{ if(d && /^date$/i.test(String(d.label||''))){
      const p=String(d.value||'').split(',').map(x=>x.trim()).filter(Boolean); if(p.length) n=p.length; } });
    return (v:any)=>{ const s=String(v==null?'':v);
      if(n<=1) return [s.trim()];
      const p=s.split(',').map(x=>x.trim());
      return p.length===n ? p : [s.trim()]; };
  }
  function entryTable(det:any[]){
    const by:any={}; (det||[]).forEach(d=>{ if(d&&d.label) by[d.label]=d.value; });
    if(by['Date']==null) return {html:'', text:''};
    const split=splitterFor(det);
    const cols=DAY_COLS.filter(c=>by[c]!=null && String(by[c]).trim());
    if(cols.length<2) return {html:'', text:''};
    const per:any={}; let n=0;
    cols.forEach(c=>{ per[c]=split(by[c]); if(per[c].length>n) n=per[c].length; });
    const rows:any[]=[];
    for(let i=0;i<n;i++){ const r:any={}; cols.forEach(c=>{ r[c]=(per[c]&&per[c][i])||''; }); rows.push(r); }
    const used=cols.filter(c=>rows.some(r=>String(r[c]||'').trim()));
    if(!rows.length||!used.length) return {html:'', text:''};
    const total=used.indexOf('Amount')!==-1 ? rows.reduce((a,r)=>a+cellSum(r['Amount']),0) : 0;
    const th=(t:string,right=false)=>"<th style='padding:7px 9px;background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;text-align:"+(right?'right':'left')+"'>"+esc(t)+"</th>";
    const td=(t:string,right=false)=>"<td style='padding:7px 9px;border-top:1px solid #eef2f6;color:#0f172a;font-size:13px;text-align:"+(right?'right':'left')+";vertical-align:top'>"+t+"</td>";
    let html="<table style='width:100%;border-collapse:collapse;margin:0 0 6px;border:1px solid #e2e8f0;border-radius:8px'><thead><tr>"
      +th('#')+used.map(c=>th(COL_HEAD[c]||c, c==='Amount')).join('')+"</tr></thead><tbody>";
    rows.forEach((r,i)=>{
      html+="<tr>"+td(String(i+1))+used.map(c=>{
        const v=String(r[c]||'').trim();
        if(!v) return td("<span style='color:#94a3b8'>&mdash;</span>");
        if(c==='Amount') return td("<b>"+money(v)+"</b>", true);
        return td(esc(v).replace(/\n/g,'<br>'));
      }).join('')+"</tr>";
    });
    html+="</tbody>";
    if(total) html+="<tfoot><tr>"+td('')+used.map((c,i)=>{
      if(c==='Amount') return "<td style='padding:8px 9px;border-top:2px solid #e2e8f0;background:#f8fafc;text-align:right;font-size:13px'><b>₹"+total.toLocaleString('en-IN')+"</b></td>";
      return "<td style='padding:8px 9px;border-top:2px solid #e2e8f0;background:#f8fafc;color:#64748b;font-size:12px'>"+(i===0?'<b>Total</b>':'')+"</td>";
    }).join('')+"</tr></tfoot>";
    html+="</table>";
    const text=rows.map((r,i)=>(i+1)+'. '+used.map(c=>(COL_HEAD[c]||c)+': '+(String(r[c]||'').trim()||'-')).join(' | ')).join('\n')
      +(total?('\nTotal: ₹'+total.toLocaleString('en-IN')):'');
    return {html, text};
  }

  if(type==='comment'){
    const caseId = body.case_id;
    const recipients: string[] = Array.isArray(body.recipients) ? body.recipients.filter(Boolean) : [];
    if(!caseId || !recipients.length) return j({error:'case_id and recipients are required'},400);
    const by = await nameFor(body.author||'');
    const commentText = String(body.comment||'').trim();
    let caseRow:any=null, flowRow:any=null;
    try{ const r=await fetch(SB+'/rest/v1/flow_cases?id=eq.'+caseId+'&select=flow_id,title,case_no',{headers:AP}); const rows=await r.json(); caseRow=Array.isArray(rows)?rows[0]:null; }catch(_){}
    if(caseRow&&caseRow.flow_id){ try{ const r=await fetch(SB+'/rest/v1/flows?id=eq.'+caseRow.flow_id+'&select=name,instance_noun',{headers:AP}); const rows=await r.json(); flowRow=Array.isArray(rows)?rows[0]:null; }catch(_){} }
    const wfName=(flowRow&&flowRow.name)||'Workflow';
    const noun=(flowRow&&flowRow.instance_noun)||'instance';
    const caseLabel=(caseRow&&caseRow.case_no)?('#'+caseRow.case_no):('#'+caseId);
    const link=PORTAL+'/tasks.html#/tasks/workflow/'+(caseRow?caseRow.flow_id:'');
    const subject='New comment on '+wfName+' '+caseLabel;
    const snippet=commentText.slice(0,400);
    const text='Hello,\n\n'+(by||'Someone')+' commented on '+wfName+' '+caseLabel+':\n\n"'+snippet+'"\n\nOpen it: '+link+'\n\nJAIN-E Workflow (automated message, please do not reply).';
    const html=shell("<p style='margin:0 0 12px;color:#0f172a;font-size:15px'>Hello,</p><p style='margin:0 0 18px;color:#334155;font-size:14px;line-height:1.6'><b>"+esc(by||'Someone')+"</b> commented on <b style='color:#e0121c'>"+esc(wfName)+" "+esc(caseLabel)+"</b>:</p><div style='margin:0 0 20px;padding:14px 16px;background:#f8fafc;border-left:3px solid #e0121c;border-radius:6px;color:#0f172a;font-size:14px;line-height:1.5'>"+esc(snippet)+"</div><div style='margin:4px 0'><a href='"+link+"' style='display:inline-block;background:#e0121c;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600'>Open "+esc(noun)+"</a></div>");
    let client:any=null; let sent=0; const failed:any[]=[];
    try{
      client = new SMTPClient({connection:{hostname:'smtp.gmail.com',port:465,tls:true,auth:{username:GU,password:GP}}});
      for(const to of recipients){
        try{ await client.send({from:GU,to,subject,content:text,html}); sent++; }
        catch(e){ failed.push({to,error:String(e)}); }
      }
    }catch(e){ return j({error:'send failed',detail:String(e)},500); } finally { try{ if(client) await client.close(); }catch(_){} }
    return j({ok:true,sent,failed});
  }

  let to='', subject='', html='', text='', wide=false;

  /* Two shapes of the same news, sharing the entry table.
       reject_returned - the live behaviour: the instance has come BACK to whoever raised it, still
                         intact, and editing it is what sends it on again.
       reject_deleted  - the older behaviour, where the instance was thrown away and had to be raised
                         again from scratch. Kept so anything still sending it renders properly. */
  if(type==='reject_returned' || type==='reject_deleted'){
    const returned = type==='reject_returned';
    to = body.email;
    if(!to) return j({error:'email required'},400);
    const wf = body.workflow||'Workflow';
    const step = body.step||'a step';
    const by = await nameFor(body.by||'');
    const reason = String(body.reason||'').trim();
    const noun = body.noun||'instance';
    const caseLabel = body.case_no ? ('#'+body.case_no) : '';
    const det = Array.isArray(body.details) ? body.details : [];
    const tbl = entryTable(det);
    wide = !!tbl.html;
    // anything not part of the per-entry table (UPI Id, and any other one-off field) lists underneath
    const rest = det.filter((d:any)=> d && d.label && DAY_COLS.indexOf(d.label)===-1 && String(d.value||'').trim())
                    .map((d:any)=> row(d.label, String(d.value).replace(/\s*\|\s*/g,',  '))).join('');
    const fallback = tbl.html ? '' : det.map((d:any)=>{
      const l=(d&&d.label)||'', v=(d&&d.value)||'';
      return String(v).trim() ? row(l, String(v).replace(/\s*\|\s*/g,',  ')) : ''; }).join('');
    // straight to the instance itself when we know which one, so correcting it is one click away
    const link = returned && body.case_id
      ? PORTAL+'/tasks.html#/tasks/workflow/case/'+body.case_id
      : PORTAL+'/tasks.html#/tasks/workflow';

    if(returned){
      subject = wf+' '+caseLabel+' has been sent back to you to correct';
      text = 'Hello,\n\nYour '+noun+' ('+wf+' '+caseLabel+') has been sent back to you at the "'+step+'" step'
        +(by?(' by '+by):'')+'.\n\n'
        +(reason?('What needs correcting:\n"'+reason+'"\n\n'):'')
        +'It is on hold until you edit it — nobody else can act on it in the meantime. Once you have made '
        +'the changes and saved, it starts again from the first step.\n\n'
        +(tbl.text?('What you submitted:\n'+tbl.text+'\n\n'):'')
        +'Open it: '+link+'\n\nJAIN-E Workflow (automated message, please do not reply).';
      html = shell(
        "<p style='margin:0 0 12px;color:#0f172a;font-size:15px'>Hello,</p>"
        +"<p style='margin:0 0 16px;color:#334155;font-size:14px;line-height:1.6'>Your "+esc(noun)+" (<b style='color:#e0121c'>"+esc(wf)+" "+esc(caseLabel)+"</b>) has been <b>sent back to you</b> at the <b>"+esc(step)+"</b> step"+(by?(' by <b>'+esc(by)+'</b>'):'')+".</p>"
        +(reason?("<div style='margin:0 0 18px;padding:14px 16px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:6px;color:#0f172a;font-size:14px;line-height:1.55'><div style='font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#92400e;margin-bottom:5px'>What needs correcting</div>"+esc(reason)+"</div>"):'')
        +"<div style='margin:0 0 18px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;color:#334155;font-size:14px;line-height:1.55'>It is on hold until you edit it &mdash; nobody else can act on it in the meantime. Once you have made the changes and saved, it starts again from the first step.</div>"
        +((tbl.html||fallback)?("<p style='margin:0 0 6px;color:#64748b;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase'>What you submitted</p>"):'')
        +(tbl.html||'')
        +((rest||fallback)?("<table style='width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 20px'>"+(tbl.html?rest:fallback)+"</table>"):"<div style='height:14px'></div>")
        +"<div style='margin:4px 0'><a href='"+link+"' style='display:inline-block;background:#e0121c;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600'>Open and correct it</a></div>", wide);
    } else {
      subject = wf+' '+caseLabel+' was rejected — please raise a new one';
      text = 'Hello,\n\nYour '+noun+' ('+wf+' '+caseLabel+') was rejected at the "'+step+'" step'
        +(by?(' by '+by):'')+', and has been removed.\n\n'
        +(reason?('Reason given:\n"'+reason+'"\n\n'):'')
        +'A new '+noun+' needs to be raised for the same, with this corrected.\n\n'
        +(tbl.text?('What was submitted:\n'+tbl.text+'\n\n'):'')
        +'Open Workflow: '+link+'\n\nJAIN-E Workflow (automated message, please do not reply).';
      html = shell(
        "<p style='margin:0 0 12px;color:#0f172a;font-size:15px'>Hello,</p>"
        +"<p style='margin:0 0 16px;color:#334155;font-size:14px;line-height:1.6'>Your "+esc(noun)+" (<b style='color:#e0121c'>"+esc(wf)+" "+esc(caseLabel)+"</b>) was <b style='color:#e0121c'>rejected</b> at the <b>"+esc(step)+"</b> step"+(by?(' by <b>'+esc(by)+'</b>'):'')+", and has been removed.</p>"
        +(reason?("<div style='margin:0 0 18px;padding:14px 16px;background:#fef2f2;border-left:3px solid #e0121c;border-radius:6px;color:#0f172a;font-size:14px;line-height:1.55'><div style='font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#b91c1c;margin-bottom:5px'>Reason given</div>"+esc(reason)+"</div>"):'')
        +"<div style='margin:0 0 18px;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#92400e;font-size:14px;line-height:1.55'><b>A new "+esc(noun)+" needs to be raised</b> for the same, with this corrected.</div>"
        +((tbl.html||fallback)?("<p style='margin:0 0 6px;color:#64748b;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase'>What was submitted</p>"):'')
        +(tbl.html||'')
        +((rest||fallback)?("<table style='width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 20px'>"+(tbl.html?rest:fallback)+"</table>"):"<div style='height:14px'></div>")
        +"<div style='margin:4px 0'><a href='"+link+"' style='display:inline-block;background:#e0121c;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600'>Open Workflow</a></div>", wide);
    }
  } else if(type==='revert' || type==='reject'){
    to = body.email;
    const wf = body.workflow||'Workflow', step = body.step||'a step', by = await nameFor(body.by||'');
    if(!to) return j({error:'email required'},400);
    const isReject = type==='reject';
    const reason = String(body.reason||'').trim();
    const headline = isReject ? 'A workflow step you completed was <b style=\"color:#e0121c\">rejected</b> and has come back to you.' : 'A workflow step you were working on was <b style=\"color:#e0121c\">reverted</b> (pulled back).';
    subject = (isReject ? 'Workflow step rejected: ' : 'Workflow step reverted: ') + step;
    const link = PORTAL+'/tasks.html#/tasks/work';
    text = 'Hello,\n\n'+(isReject?'A workflow step you completed was rejected and has come back to you.':'A workflow step you were working on was reverted (pulled back).')+'\n\nWorkflow: '+wf+'\nStep: '+step+(by?('\nBy: '+by):'')+(reason?('\nReason: '+reason):'')+'\n\nOpen your tasks: '+link+'\n\nJAIN-E Workflow (automated message, please do not reply).';
    html = shell("<p style='margin:0 0 12px;color:#0f172a;font-size:15px'>Hello,</p><p style='margin:0 0 18px;color:#334155;font-size:14px;line-height:1.6'>"+headline+"</p>"+(reason?("<div style='margin:0 0 18px;padding:14px 16px;background:#fef2f2;border-left:3px solid #e0121c;border-radius:6px;color:#0f172a;font-size:14px;line-height:1.55'><div style='font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#b91c1c;margin-bottom:5px'>Reason given</div>"+esc(reason)+"</div>"):'')+"<table style='width:100%;border-collapse:collapse;font-size:14px;margin:0 0 20px'>"+row('Workflow',wf)+row('Step',step)+(by?row('By',by):'')+"</table><div style='margin:4px 0'><a href='"+link+"' style='display:inline-block;background:#e0121c;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600'>Open your tasks</a></div>");
  } else {
    const taskId = body.task_id; to = body.email;
    if(!taskId||!to) return j({error:'task_id and email are required'},400);
    let task:any=null; try{ const r=await fetch(SB+'/rest/v1/ptasks?id=eq.'+taskId+'&select=id,title,due_date,flow_case_step_id',{headers:AP}); const rows=await r.json(); task=Array.isArray(rows)?rows[0]:null; }catch(_){}
    if(!task) return j({error:'task not found'},404);
    let stepRow:any=null,caseRow:any=null,flowRow:any=null;
    if(task.flow_case_step_id){ try{ const r=await fetch(SB+'/rest/v1/flow_case_steps?id=eq.'+task.flow_case_step_id+'&select=seq,title,person,due_at,case_id,description',{headers:AP}); const rows=await r.json(); stepRow=Array.isArray(rows)?rows[0]:null; }catch(_){} }
    if(stepRow&&stepRow.case_id){ try{ const r=await fetch(SB+'/rest/v1/flow_cases?id=eq.'+stepRow.case_id+'&select=flow_id,title,case_no',{headers:AP}); const rows=await r.json(); caseRow=Array.isArray(rows)?rows[0]:null; }catch(_){} }
    if(caseRow&&caseRow.flow_id){ try{ const r=await fetch(SB+'/rest/v1/flows?id=eq.'+caseRow.flow_id+'&select=name,trigger_event',{headers:AP}); const rows=await r.json(); flowRow=Array.isArray(rows)?rows[0]:null; }catch(_){} }
    const wfName = (flowRow&&flowRow.name)||'Workflow';
    const stepName = (stepRow&&stepRow.title)||task.title;
    const caseLabel = (caseRow&&caseRow.case_no) ? ('#'+caseRow.case_no) : '';
    const taskUrl = PORTAL+'/tasks.html#/task/'+task.id;

    if(type==='received'){
      // Sent once to whoever forwarded this step, confirming the person it
      // went to has now clicked "Receive" on it.
      const byName = await nameFor(body.received_by||'');
      subject = 'Received: '+wfName+(caseLabel?(' '+caseLabel):'')+' — '+stepName;
      text = 'Hello,\n\nGood news — the step you forwarded has been received'+(byName?(' by '+byName):'')+'.\n\nWorkflow: '+wfName+(caseLabel?('\nCase: '+caseLabel):'')+'\nStep: '+stepName+'\n\nOpen it: '+taskUrl+'\n\nJAIN-E Workflow (automated message, please do not reply).';
      html = shell("<p style='margin:0 0 12px;color:#0f172a;font-size:15px'>Hello,</p><p style='margin:0 0 18px;color:#334155;font-size:14px;line-height:1.6'>Good news — the step you forwarded has been <b style='color:#16a34a'>received</b>"+(byName?(' by <b>'+esc(byName)+'</b>'):'')+".</p><table style='width:100%;border-collapse:collapse;font-size:14px;margin:0 0 20px'>"+row('Workflow',wfName)+(caseLabel?row('Case',caseLabel):'')+row('Step',stepName)+"</table><div style='margin:4px 0'><a href='"+taskUrl+"' style='display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600'>Open Workflow</a></div>");
    } else {
      const trig = (caseRow&&caseRow.title)||(flowRow&&flowRow.trigger_event)||'';
      const dueTxt = (stepRow&&stepRow.due_at) ? new Date(stepRow.due_at).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}) : (task.due_date||'No due date set');
      subject = 'Workflow step assigned: '+stepName;
      text = 'Hello,\n\nA workflow step has been assigned to you in JAIN-E.\n\nWorkflow: '+wfName+'\nStep: '+stepName+(trig?('\nTriggering event: '+trig):'')+'\nDue: '+dueTxt+'\n\nOpen this task: '+taskUrl+'\n\nJAIN-E Workflow (automated message, please do not reply).';
      html = shell("<p style='margin:0 0 12px;color:#0f172a;font-size:15px'>Hello,</p><p style='margin:0 0 18px;color:#334155;font-size:14px;line-height:1.6'>A <b style='color:#e0121c'>workflow step</b> has been assigned to you and is waiting in your tasks.</p><table style='width:100%;border-collapse:collapse;font-size:14px;margin:0 0 20px'>"+row('Workflow',wfName)+row('Step',stepName)+(trig?row('Triggering event',trig):'')+row('Due',dueTxt)+"</table><div style='margin:4px 0'><a href='"+taskUrl+"' style='display:inline-block;background:#e0121c;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600'>Open this step</a></div>");
    }
  }

  let client:any=null;
  try{
    client = new SMTPClient({connection:{hostname:'smtp.gmail.com',port:465,tls:true,auth:{username:GU,password:GP}}});
    await client.send({from:GU,to,subject,content:text,html});
  }catch(e){ return j({error:'send failed',detail:String(e)},500); } finally { try{ if(client) await client.close(); }catch(_){} }
  return j({ok:true});
});
