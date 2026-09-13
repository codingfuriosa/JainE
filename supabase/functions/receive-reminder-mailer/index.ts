import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
const cors = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, GET, OPTIONS' };
const j = (o:any,s=200)=> new Response(JSON.stringify(o),{status:s,headers:{...cors,'Content-Type':'application/json'}});
const esc = (s:any)=> String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

Deno.serve(async (req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  const GU=Deno.env.get('GMAIL_USER'), GP=Deno.env.get('GMAIL_APP_PASSWORD');
  const u=new URL(req.url);
  const PORTAL=(Deno.env.get('PORTAL_URL')||'https://jaingroupe.netlify.app').replace(/\/$/,'');
  if(u.searchParams.get('debug')==='1'){ return j({ hasUser:!!GU, hasPass:!!GP, portalUsed:PORTAL }); }
  if(!GU||!GP) return j({error:'Gmail secrets (GMAIL_USER / GMAIL_APP_PASSWORD) are not set.'},500);
  const SB=Deno.env.get('SUPABASE_URL'), SRV=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const H={ apikey:SRV, Authorization:'Bearer '+SRV, 'Content-Type':'application/json' };

  const br = await fetch(SB+'/rest/v1/rpc/receive_reminder_batch',{method:'POST',headers:H,body:'{}'});
  const steps = await br.json();
  if(!Array.isArray(steps)) return j({error:'query failed',detail:steps},500);
  if(!steps.length) return j({ok:true,sent:0,message:'No unreceived steps to nudge.'});

  // Group by recipient so one person waiting on several steps gets a single
  // digest email instead of one email per step.
  const byEmail: Record<string, any[]> = {};
  for(const s of steps){
    const members: string[] = Array.isArray(s.members) ? s.members.filter(Boolean) : [];
    for(const email of members){ (byEmail[email] ||= []).push(s); }
  }
  const recipients = Object.keys(byEmail);
  if(!recipients.length) return j({ok:true,sent:0,message:'No unreceived steps with assignees to nudge.'});

  const LOGO = PORTAL+'/assets/jaine-logo-full-white.png';
  const HEADER = "<div style='background:#0a0a0c;background:linear-gradient(180deg,#0a0a0c,#171719);padding:16px 24px;border-bottom:2px solid #e0121c'><table role='presentation' cellpadding='0' cellspacing='0' border='0'><tr><td style='vertical-align:middle;padding-right:13px'><img src='"+LOGO+"' alt='JAIN-E' height='24' style='display:block;height:24px;width:auto;border:0'></td><td style='vertical-align:middle'><span style='color:#c7c7ca;font-size:12px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase'>Workflow</span></td></tr></table></div>";
  const FOOT = "<div style='padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0'><p style='margin:0;color:#94a3b8;font-size:12px;line-height:1.5'>Automated message from the JAIN-E Accountability &middot; Workflow module. Please do not reply to this email.</p></div>";
  function shell(inner:string){ return "<div style='margin:0;padding:24px;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif'><div style='max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0'>"+HEADER+"<div style='padding:24px'>"+inner+"</div>"+FOOT+"</div></div>"; }
  function hoursWaiting(appearedAt:string){ return appearedAt ? Math.max(12, Math.round((Date.now()-new Date(appearedAt).getTime())/3600000)) : 12; }

  let client:any=null;
  try{ client = new SMTPClient({connection:{hostname:'smtp.gmail.com',port:465,tls:true,auth:{username:GU,password:GP}}}); }
  catch(e){ return j({error:'SMTP connect failed',detail:String(e)},500); }

  let sent=0; const errors:any[]=[];
  for(const to of recipients){
    const items = byEmail[to].slice().sort((a:any,b:any)=> hoursWaiting(b.appeared_at)-hoursWaiting(a.appeared_at));
    const n = items.length;
    const subject = n===1
      ? ('Reminder: please receive '+(items[0].workflow_name||'Workflow')+(items[0].case_no?(' #'+items[0].case_no):'')+' — '+(items[0].step_title||'a step'))
      : ('Reminder: '+n+' workflow steps are waiting for you to receive');

    const textLines = items.map((s:any)=>{
      const wf=s.workflow_name||'Workflow', caseLabel=s.case_no?('#'+s.case_no):'', stepName=s.step_title||'a step', hrs=hoursWaiting(s.appeared_at);
      const taskUrl = s.task_id ? (PORTAL+'/tasks.html#/task/'+s.task_id) : (PORTAL+'/tasks.html#/tasks/work');
      return '- '+wf+(caseLabel?(' '+caseLabel):'')+' | '+stepName+' | waiting '+hrs+'h | '+taskUrl;
    }).join('\n');
    const text = 'Hello,\n\n'+n+' workflow step'+(n===1?'':'s')+' forwarded to you '+(n===1?'is':'are')+' still waiting to be received:\n\n'
      +textLines
      +'\n\nOpen each task and click "Receive" to start working on it. This reminder repeats every 12 hours until you do, for each step still unreceived.\n\nJAIN-E Workflow (automated message, please do not reply).';

    const rowsHtml = items.map((s:any)=>{
      const wf=s.workflow_name||'Workflow', caseLabel=s.case_no?('#'+s.case_no):'', stepName=s.step_title||'a step', hrs=hoursWaiting(s.appeared_at);
      const taskUrl = s.task_id ? (PORTAL+'/tasks.html#/task/'+s.task_id) : (PORTAL+'/tasks.html#/tasks/work');
      return "<tr>"
        +"<td style='padding:9px 10px;border-top:1px solid #eef2f6;color:#0f172a;font-size:13px'><b>"+esc(wf)+"</b>"+(caseLabel?(" <span style='color:#64748b'>"+esc(caseLabel)+"</span>"):"")+"<br><span style='color:#334155'>"+esc(stepName)+"</span></td>"
        +"<td style='padding:9px 10px;border-top:1px solid #eef2f6;color:#e0121c;font-weight:600;font-size:13px;white-space:nowrap'>"+hrs+"h</td>"
        +"<td style='padding:9px 10px;border-top:1px solid #eef2f6;text-align:right'><a href='"+taskUrl+"' style='color:#e0121c;text-decoration:none;font-weight:600;font-size:13px'>Open &rarr;</a></td>"
        +"</tr>";
    }).join('');
    const html = shell(
      "<p style='margin:0 0 12px;color:#0f172a;font-size:15px'>Hello,</p>"
      +"<p style='margin:0 0 18px;color:#334155;font-size:14px;line-height:1.6'>"+n+" workflow step"+(n===1?'':'s')+" forwarded to you "+(n===1?'is':'are')+" still <b style='color:#e0121c'>waiting to be received</b>.</p>"
      +"<table style='width:100%;border-collapse:collapse;margin:0 0 18px;border:1px solid #e2e8f0;border-radius:8px'><thead><tr>"
      +"<th style='padding:7px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;text-align:left'>Step</th>"
      +"<th style='padding:7px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;text-align:left'>Waiting</th>"
      +"<th style='padding:7px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0'></th>"
      +"</tr></thead><tbody>"+rowsHtml+"</tbody></table>"
      +"<div style='margin:0 0 4px;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#92400e;font-size:13px;line-height:1.55'>Click <b>Receive</b> on each step to start working on it. This reminder repeats every 12 hours per step until you do.</div>"
    );

    try{ await client.send({from:GU,to,subject,content:text,html}); sent++; }
    catch(e){ errors.push(to+': '+String(e)); }
  }
  try{ await client.close(); }catch(_){}

  // Reset the per-step 12h throttle for every step just covered, regardless
  // of which recipients it was digested to or whether their send succeeded.
  const seen = new Set<number>();
  for(const s of steps){
    if(seen.has(s.fcs_id)) continue;
    seen.add(s.fcs_id);
    try{ await fetch(SB+'/rest/v1/rpc/mark_receive_reminder_sent',{method:'POST',headers:H,body:JSON.stringify({p_fcs_id:s.fcs_id})}); }catch(_){}
  }

  return j({ok:true,steps:steps.length,recipients:recipients.length,sent,errors});
});
