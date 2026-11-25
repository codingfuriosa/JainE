const cors = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS' };
const j = (o:any,s=200)=> new Response(JSON.stringify(o),{status:s,headers:{...cors,'Content-Type':'application/json'}});

function parseJson(text:string):any{
  if(!text) return null;
  let t=text.trim();
  const fence=t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if(fence) t=fence[1].trim();
  try{ return JSON.parse(t); }catch(_){ /* fall through */ }
  const s=t.indexOf('{'); if(s===-1) return null;
  const e=t.lastIndexOf('}'); if(e<=s) return null;
  try{ return JSON.parse(t.slice(s,e+1)); }catch(_){ return null; }
}

function renderJdText(s:any):string{
  const lines:string[]=[];
  lines.push(`Job Title: ${s.job_title||''}`);
  lines.push(`Department: ${s.department||''}`);
  lines.push('');
  lines.push('Job Summary:');
  lines.push(s.job_summary||'');
  lines.push('');
  lines.push('Key Responsibilities:');
  (s.responsibilities||[]).forEach((r:any)=>{ lines.push(`- ${r.label?r.label+': ':''}${r.detail||''}`); });
  lines.push('');
  lines.push('Required Qualifications:');
  const q=s.qualifications||{};
  if(q.education) lines.push(`- Educational Background: ${q.education}`);
  if(q.experience) lines.push(`- Professional Experience: ${q.experience}`);
  if(Array.isArray(q.skills)&&q.skills.length) lines.push(`- Skills: ${q.skills.join(', ')}`);
  if(Array.isArray(q.personal_attributes)&&q.personal_attributes.length) lines.push(`- Personal Attributes: ${q.personal_attributes.join(', ')}`);
  if(s.compensation){ lines.push(''); lines.push('Compensation and Benefits:'); lines.push(`- ${s.compensation}`); }
  return lines.join('\n');
}

async function deleteObject(SB:string,SRV:string,bucket:string,path:string){
  if(!path) return;
  try{ await fetch(`${SB}/storage/v1/object/${bucket}/${path}`,{method:'DELETE',headers:{apikey:SRV,Authorization:'Bearer '+SRV}}); }catch(_){}
}
function pathFromPublicUrl(url:string|null,bucket:string):string{
  if(!url) return '';
  const marker=`/object/public/${bucket}/`;
  const i=url.indexOf(marker);
  return i===-1?'':url.slice(i+marker.length);
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='POST') return j({error:'method not allowed'},405);

  const SB=Deno.env.get('SUPABASE_URL');
  const SRV=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const KEY=Deno.env.get('CHATGPT_API_KEY');
  if(!SB||!SRV) return j({error:'Supabase service credentials are not set on this project'},500);
  if(!KEY) return j({error:'CHATGPT_API_KEY secret is not set on this Supabase project'},500);

  let body:any={};
  try{ body=await req.json(); }catch(_){}
  const sample=!!body?.sample;
  const requestId=parseInt(body?.request_id);
  const requestedBy=String(body?.requested_by||'');
  const rejectionReason=String(body?.rejection_reason||'').trim();
  if(!sample && !requestId) return j({error:'request_id is required'},400);

  const H={apikey:SRV,Authorization:'Bearer '+SRV,'Content-Type':'application/json'};
  const hrH=(extra:any={})=>({...H,'Accept-Profile':'hr','Content-Profile':'hr',...extra});
  const recH=(extra:any={})=>({...H,'Accept-Profile':'recruit','Content-Profile':'recruit',...extra});
  const accH=(extra:any={})=>({...H,'Accept-Profile':'acc','Content-Profile':'acc',...extra});

  try{
    let rec:any;
    if(sample){
      rec={job_title:body.job_title||'Sample Position',department:body.department||'Sales',no_of_vacancy:'2',
        reporting_person:'—',qualification:'Graduate',experience:'1-2 years',gender:'Any',salary_range:'As per company norms',
        location:'Head Office',job_description:'This is a sample preview using placeholder data — nothing is saved.',notes:''};
    }else{
      const rr=await fetch(`${SB}/rest/v1/manpower_requests?id=eq.${requestId}&select=*`,{headers:hrH()});
      const rows=await rr.json();
      rec=Array.isArray(rows)?rows[0]:null;
      if(!rec) return j({error:'Requisition not found'},404);
      await fetch(`${SB}/rest/v1/manpower_requests?id=eq.${requestId}`,{method:'PATCH',headers:hrH(),body:JSON.stringify({ai_status:'generating'})});
    }

    let styleExamples='';
    try{
      const pick=async(src:string,limit:number)=>{
        const r=await fetch(`${SB}/rest/v1/job_descriptions?content_text=not.is.null&source=eq.${src}`
          +`&select=name,content_text&order=created_at.desc&limit=${limit}`,{headers:recH()});
        const a=await r.json();
        return Array.isArray(a)?a:[];
      };
      let jds=await pick('upload',3);
      if(jds.length<3) jds=jds.concat(await pick('ai_generated',3-jds.length));
      if(jds.length){
        styleExamples='\n\nReal past Job Descriptions in our house style — match this exact structure and tone:\n'+
          jds.map((x:any,i:number)=>`--- Example ${i+1}: ${x.name} ---\n${String(x.content_text).slice(0,1500)}`).join('\n\n');
      }
    }catch(_){ /* non-fatal */ }

    const facts=`Job Title: ${rec.job_title||'—'}
Department: ${rec.department||'—'}
Vacancies: ${rec.no_of_vacancy||'—'}
Reporting To: ${rec.reporting_person||'—'}
Qualification: ${rec.qualification||'—'}
Experience: ${rec.experience||'—'}
Gender: ${rec.gender||'—'}
Salary Range: ${rec.salary_range||'—'}
Location: ${rec.location||'—'}
Notes from requester: ${rec.job_description||rec.notes||'—'}`
      +(rejectionReason?`\nHR feedback on the previous draft (address this specifically in the rewrite): ${rejectionReason}`:'');

    const system=`You are an expert recruiter writing hiring content for Jain Group, a real-estate company in India. You will be given raw facts a requester typed into a form (which may be sparse, inconsistent, or oddly worded) — do not just copy that text; use it as input to write clean, professional, complete content in our house style. Return ONLY a JSON object, no markdown, with exactly these keys:
{
  "job_title": string,
  "department": string,
  "job_summary": string,
  "responsibilities": [{"label": string, "detail": string}],
  "qualifications": { "education": string, "experience": string, "skills": string[], "personal_attributes": string[] },
  "compensation": string
}

Never invent facts not implied by the input. Valid JSON only, no markdown fences.`;

    const oaRes=await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+KEY},
      body:JSON.stringify({model:'gpt-4o-mini',temperature:0.4,messages:[
        {role:'system',content:system},
        {role:'user',content:'POSITION FACTS (from the ManPower form):\n'+facts+styleExamples}
      ]})
    });
    const oaJson=await oaRes.json();
    if(!oaRes.ok){
      if(!sample) await fetch(`${SB}/rest/v1/manpower_requests?id=eq.${requestId}`,{method:'PATCH',headers:hrH(),body:JSON.stringify({ai_status:'failed'})});
      return j({error:oaJson?.error?.message||('OpenAI error '+oaRes.status)},502);
    }
    const text=oaJson?.choices?.[0]?.message?.content||'';
    const parsed=parseJson(text);
    if(!parsed||!parsed.job_summary){
      if(!sample) await fetch(`${SB}/rest/v1/manpower_requests?id=eq.${requestId}`,{method:'PATCH',headers:hrH(),body:JSON.stringify({ai_status:'failed'})});
      return j({error:'AI returned an unreadable response'},502);
    }
    const jdText=renderJdText(parsed);

    if(!sample){
      await deleteObject(SB,SRV,'recruitment-creatives',pathFromPublicUrl(rec.ai_creative_path,'recruitment-creatives'));
      await deleteObject(SB,SRV,'recruitment-creatives',pathFromPublicUrl(rec.ai_jd_document_path,'recruitment-creatives'));
      await fetch(`${SB}/rest/v1/job_descriptions?manpower_request_id=eq.${requestId}&source=eq.ai_generated`,{method:'DELETE',headers:recH()});
    }

    if(sample){
      return j({ok:true,sample:true,job_description:jdText,job_description_json:parsed});
    }

    await fetch(`${SB}/rest/v1/manpower_requests?id=eq.${requestId}`,{method:'PATCH',headers:hrH(),body:JSON.stringify({
      ai_job_description:jdText,
      ai_job_description_json:parsed,
      ai_platform_post_text:null,
      ai_creative_path:null,
      ai_jd_document_path:null,
      ai_status:'ready',
      ...(rejectionReason?{rejection_reason:null}:{})
    })});

    await fetch(`${SB}/rest/v1/job_descriptions`,{method:'POST',headers:recH({Prefer:'return=minimal'}),body:JSON.stringify({
      name:rec.job_title||('Requisition #'+requestId),
      storage_path:'',
      content_text:jdText,
      job_description_json:parsed,
      jd_document_path:null,
      platform_post_text:null,
      source:'ai_generated',
      manpower_request_id:requestId,
      uploaded_by:requestedBy||null
    })});

    /* NO APPROVAL TASK AND NO CAREER-PAGE POST (23 Nov 2026). Both were removed by request: the
       description is usable as soon as it is written, and only the description itself is generated. */
    return j({ok:true,job_description:jdText,job_description_json:parsed});
  }catch(e){
    if(!body?.sample && requestId){
      try{ await fetch(`${SB}/rest/v1/manpower_requests?id=eq.${requestId}`,{method:'PATCH',headers:hrH(),body:JSON.stringify({ai_status:'failed'})}); }catch(_){}
    }
    return j({error:String((e as any)?.message||e)},500);
  }
});
