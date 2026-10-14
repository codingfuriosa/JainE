import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
const cors = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, GET, OPTIONS' };
const j = (o,s=200)=> new Response(JSON.stringify(o),{status:s,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async (req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  const GU=Deno.env.get('GMAIL_USER'), GP=Deno.env.get('GMAIL_APP_PASSWORD');
  const u=new URL(req.url);
  const PORTAL=Deno.env.get('PORTAL_URL')||'https://jaingroupe.netlify.app';
  if(u.searchParams.get('debug')==='1'){ let keys=[]; try{ keys=Object.keys(Deno.env.toObject()).filter(k=>/mail|gmail/i.test(k)); }catch(_){} return j({ hasUser: !!GU, userLen: GU?GU.length:0, hasPass: !!GP, passLen: GP?GP.length:0, mailKeys: keys, portalEnvSet: !!Deno.env.get('PORTAL_URL'), portalUsed: PORTAL }); }
  const SB=Deno.env.get('SUPABASE_URL'), SRV=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!GU||!GP) return j({error:'Gmail secrets (GMAIL_USER / GMAIL_APP_PASSWORD) are not set.'},500);
  const H={ apikey:SRV, Authorization:'Bearer '+SRV, 'Content-Type':'application/json' };
  const br = await fetch(SB+'/rest/v1/rpc/due_email_batch',{method:'POST',headers:H,body:'{}'});
  const tasks = await br.json();
  if(!Array.isArray(tasks)) return j({error:'query failed',detail:tasks},500);
  if(!tasks.length) return j({ok:true,sent:0,message:'No due/overdue tasks to email.'});
  const LOGO = PORTAL.replace(/\/$/,'')+'/assets/jaine-logo-full-white.png';
  const HEADER = "<div style='background:#0a0a0c;background:linear-gradient(180deg,#0a0a0c,#171719);padding:16px 24px;border-bottom:2px solid #e0121c'><table role='presentation' cellpadding='0' cellspacing='0' border='0'><tr><td style='vertical-align:middle;padding-right:13px'><img src='"+LOGO+"' alt='JAIN-E' height='24' style='display:block;height:24px;width:auto;border:0'></td><td style='vertical-align:middle'><span style='color:#c7c7ca;font-size:12px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase'>Accountability</span></td></tr></table></div>";
  let client=null;
  try{ client = new SMTPClient({connection:{hostname:'smtp.gmail.com',port:465,tls:true,auth:{username:GU,password:GP}}}); }catch(e){ return j({error:'SMTP connect failed',detail:String(e)},500); }
  const today0=new Date(); today0.setHours(0,0,0,0);
  let sent=0; const errors=[];
  for(const t of tasks){
    const members = Array.isArray(t.members)? t.members.filter(Boolean): [];
    const kind = t.kind || (t.overdue?'overdue':'due');
    // A recurring task still open on the day its next one was due: the next one is held back
    // until this one is complete, and everyone on it is told so.
    const missed = kind==='recur_missed';
    const overdue = kind==='overdue' || missed;
    const dd = new Date(String(t.due_date)+'T00:00:00');
    const days = Math.max(0,Math.round((today0.getTime()-dd.getTime())/86400000));
    const status = missed ? ('Still open — the next one was due '+t.next_date+' and will only be created once this is complete')
      : overdue ? ('Overdue by '+days+' day'+(days===1?'':'s')+' (was due '+t.due_date+')') : ('Due today ('+t.due_date+')');
    const subject = missed ? ('Action required: recurring task “'+t.title+'” is not done — the next one is waiting')
      : overdue ? ('Action required: task “'+t.title+'” is overdue') : ('Reminder: task “'+t.title+'” is due today');
    const lead = missed ? 'a <b style=\'color:#e0121c\'>recurring task</b> assigned to you is still open, and its next one was due. The next one will not be created until this one is marked complete — it will then be created straight away, already overdue.'
      : 'a task assigned to you is <b style=\'color:'+(overdue?'#e0121c':'#0f172a')+'\'>'+(overdue?'overdue':'due today')+'</b>. Please review it and update its status in the portal.';
    const leadText = missed ? 'a recurring task assigned to you is still open, and its next one was due. The next one will not be created until this one is marked complete.'
      : 'the following task assigned to you is '+(overdue?'overdue':'due today')+'.';
    const taskUrl = PORTAL ? (PORTAL.replace(/\/$/,'')+'/tasks.html#/task/'+t.id) : '';
    const accent = overdue ? '#e0121c' : '#0f172a';
    const text = 'Hello,\n\nThis is an automated reminder from the JAIN-E Accountability system: '+leadText+'\n\nTask: '+t.title+'\nDue date: '+t.due_date+'\nStatus: '+status+(taskUrl?('\n\nOpen this task: '+taskUrl):'')+'\n\nPlease log in to the JAIN-E portal to review this task and update its status.\n\nJAIN-E Accountability (automated message, please do not reply).';
    const btn = taskUrl ? ("<div style='margin:4px 0 4px'><a href='"+taskUrl+"' style='display:inline-block;background:#e0121c;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600'>Open this task</a></div>") : '';
    const html = "<div style='margin:0;padding:24px;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif'><div style='max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0'>"+HEADER+"<div style='padding:24px'><p style='margin:0 0 12px;color:#0f172a;font-size:15px'>Hello,</p><p style='margin:0 0 18px;color:#334155;font-size:14px;line-height:1.6'>This is an automated reminder that "+lead+"</p><table style='width:100%;border-collapse:collapse;font-size:14px;margin:0 0 20px'><tr><td style='padding:9px 0;color:#64748b;width:110px'>Task</td><td style='padding:9px 0;color:#0f172a;font-weight:600'>"+t.title+"</td></tr><tr><td style='padding:9px 0;color:#64748b;border-top:1px solid #eef2f6'>Due date</td><td style='padding:9px 0;color:#0f172a;border-top:1px solid #eef2f6'>"+t.due_date+"</td></tr><tr><td style='padding:9px 0;color:#64748b;border-top:1px solid #eef2f6'>Status</td><td style='padding:9px 0;font-weight:600;color:"+accent+";border-top:1px solid #eef2f6'>"+status+"</td></tr></table>"+btn+"</div><div style='padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0'><p style='margin:0;color:#94a3b8;font-size:12px;line-height:1.5'>Automated message from the JAIN-E Accountability module. Please do not reply to this email.</p></div></div></div>";
    for(const m of members){ try{ await client.send({from:GU,to:m,subject,content:text,html}); sent++; }catch(e){ errors.push(m+': '+String(e)); } }
    await fetch(SB+'/rest/v1/rpc/mark_task_emailed',{method:'POST',headers:H,body:JSON.stringify({p_id:t.id,p_kind:kind})});
  }
  try{ await client.close(); }catch(_){}
  return j({ok:true,tasks:tasks.length,sent,errors});
});
