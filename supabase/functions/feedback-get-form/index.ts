/* Public, unauthenticated -- same posture as career-apply / recruit-test-start / recruit-test-submit.
   Handles BOTH fetching a form's definition and submitting a response, in one function, keyed by
   body.action ('get' default, or 'submit') -- the project is at its edge-function slot cap, so this
   folds what would otherwise be two functions into the one slot freed by removing helpdesk-ai.
   Writes go through the service-role key rather than a public RLS insert policy, so the schema is
   never exposed directly to an anonymous client.

   The qr_token is the only credential; it identifies WHICH form, never WHO is filling it in -- there
   is no login and nothing here reads or requires a name/phone/email to look the form up.

   Hardening (this is a public, login-free form -- honest about what it can and can't stop):
   - Every answer is validated server-side against the question it claims to answer: a rating must be
     a whole number within [1, rating_max] (a numbered scale the same), a score out of 10 a whole
     number within [0, 10], an MCQ
     answer must be exactly one of that question's own options, and every pick of a multi-select must
     be one of them too. A client that skips the UI and posts straight to this function cannot inject
     a rating of 9999 or an MCQ answer that was never offered.
   - Answers are only ever inserted for question_ids that actually belong to THIS form (looked up
     server-side, never trusted from the client), so answers can't be attributed to another form's
     questions.
   - A short (10s) per-IP-per-form cooldown blocks a scripted submit-loop, without the false positives
     a longer block would cause here -- many real visitors legitimately share one IP (site/office
     wifi), so this is a spam-loop deterrent, not a one-response-per-person guarantee; nothing short of
     a login can promise that for an anonymous QR form, and this doesn't pretend to. */
const cors = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST, OPTIONS' };
const j = (o:any,s=200)=> new Response(JSON.stringify(o),{status:s,headers:{...cors,'Content-Type':'application/json'}});

/* A multi-select answer arrives as its picks joined by ' | '. Deliberately not a comma: an option
   here can legitimately contain one ("Payments, demand letters or receipts"), so a comma cannot be
   what separates them. The builder refuses an option containing a pipe, which is what keeps this
   split honest. */
const MULTI_SEP = ' | ';

async function sha256(text:string){
  const buf=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

Deno.serve(async (req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='POST') return j({error:'method not allowed'},405);

  const SB=Deno.env.get('SUPABASE_URL'), SRV=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!SB||!SRV) return j({error:'server not configured'},500);
  const H={apikey:SRV,Authorization:'Bearer '+SRV,'Content-Type':'application/json','Accept-Profile':'feedback','Content-Profile':'feedback'};

  let body:any={};
  try{ body=await req.json(); }catch(_){}
  const action=String(body?.action||'get');
  const token=String(body?.qr_token||'').trim();
  if(!token) return j({error:'This link is missing its form reference.'},400);

  const fr=await fetch(`${SB}/rest/v1/forms?qr_token=eq.${encodeURIComponent(token)}&select=id,title,description,is_active,collect_name,collect_phone,collect_email,thank_you_message`,{headers:H});
  const frows=await fr.json();
  const form=Array.isArray(frows)?frows[0]:null;
  if(!form) return j({error:'This form could not be found.'},404);
  if(!form.is_active) return j({error:'This form is no longer accepting responses. Thank you for your interest.'},403);

  if(action==='submit'){
    const name=String(body?.name||'').trim();
    const phone=String(body?.phone||'').trim();
    const email=String(body?.email||'').trim();
    const answers=Array.isArray(body?.answers)?body.answers:[];

    if(form.collect_name==='required' && !name) return j({error:'Please enter your name.'},400);
    if(form.collect_phone==='required' && !phone) return j({error:'Please enter your phone number.'},400);
    if(form.collect_email==='required' && !email) return j({error:'Please enter your email.'},400);

    // Spam-loop cooldown: same form + same IP within 10 seconds is rejected outright. IP is hashed,
    // never stored raw.
    const ip=(req.headers.get('x-forwarded-for')||'').split(',')[0].trim()||req.headers.get('cf-connecting-ip')||'';
    const ipHash=ip?await sha256(ip+':'+form.id):null;
    if(ipHash){
      const since=new Date(Date.now()-10000).toISOString();
      const dupR=await fetch(`${SB}/rest/v1/responses?form_id=eq.${form.id}&submitter_ip_hash=eq.${ipHash}&submitted_at=gte.${since}&select=id&limit=1`,{headers:H});
      const dupRows=await dupR.json();
      if(Array.isArray(dupRows)&&dupRows.length) return j({error:'That was just submitted -- please wait a moment before submitting again.'},429);
    }

    const qqr=await fetch(`${SB}/rest/v1/form_questions?form_id=eq.${form.id}&select=*`,{headers:H});
    const questions=await qqr.json();
    if(!Array.isArray(questions)) return j({error:'server error'},500);
    const answerByQ:Record<string,string>={};
    answers.forEach((a:any)=>{ if(a&&a.question_id!=null) answerByQ[String(a.question_id)]=String(a.answer_text??'').trim(); });

    for(const q of questions){
      const val=answerByQ[String(q.id)]||'';
      if(q.required && !val) return j({error:'Please answer every required question.'},400);
      if(!val) continue;
      /* 'scale' is a rating drawn as numbers rather than stars - same answer, same rating_max, so
         the same range check serves both and a form can move between them without touching a single
         answer already collected. */
      if(q.type==='rating'||q.type==='scale'){
        const n=Number(val);
        const max=Number(q.rating_max)||5;
        if(!Number.isInteger(n) || n<1 || n>max) return j({error:'That rating is out of range.'},400);
      }
      /* 0 IS A REAL ANSWER HERE, which is the whole reason this is not a rating: a star row is
         numbered from 1, so on one of those the people who would actively warn a friend off had
         nowhere to click. Checked as its own range rather than folded into the rating branch above,
         whose floor of 1 would throw every 0 out. */
      if(q.type==='nps'){
        const n=Number(val);
        if(!Number.isInteger(n) || n<0 || n>10) return j({error:'That score is out of range.'},400);
      }
      if(q.type==='mcq'){
        const opts=Array.isArray(q.options)?q.options:[];
        if(!opts.includes(val)) return j({error:'That is not one of this question\'s options.'},400);
      }
      /* EVERY pick is checked, not just the first: a client posting straight to this function could
         otherwise send one real option and anything it liked after it. A repeat is refused too,
         since the same option twice is not an answer anyone could have given through the form. */
      if(q.type==='multi'){
        const opts=Array.isArray(q.options)?q.options:[];
        const picked=val.split(MULTI_SEP).map((s:string)=>s.trim()).filter(Boolean);
        if(!picked.length) return j({error:'That is not one of this question\'s options.'},400);
        if(picked.some((p:string)=>!opts.includes(p))) return j({error:'That is not one of this question\'s options.'},400);
        if(new Set(picked).size!==picked.length) return j({error:'That answer picks the same option twice.'},400);
      }
    }

    const insRes=await fetch(`${SB}/rest/v1/responses`,{method:'POST',headers:{...H,Prefer:'return=representation'},body:JSON.stringify({
      form_id:form.id,
      respondent_name:form.collect_name!=='off'?(name||null):null,
      respondent_phone:form.collect_phone!=='off'?(phone||null):null,
      respondent_email:form.collect_email!=='off'?(email||null):null,
      submitter_ip_hash:ipHash
    })});
    if(!insRes.ok) return j({error:'Could not save your response: '+(await insRes.text()).slice(0,200)},500);
    const rows=await insRes.json();
    const response=Array.isArray(rows)?rows[0]:null;
    if(!response) return j({error:'Could not save your response'},500);

    const answerRows=questions.map((q:any)=>({
      response_id:response.id, question_id:q.id, answer_text:answerByQ[String(q.id)]||null
    })).filter((r:any)=>r.answer_text!==null);
    if(answerRows.length){
      const ar=await fetch(`${SB}/rest/v1/response_answers`,{method:'POST',headers:{...H,Prefer:'return=minimal'},body:JSON.stringify(answerRows)});
      if(!ar.ok) return j({error:'Could not save your answers: '+(await ar.text()).slice(0,200)},500);
    }

    return j({ok:true,message:form.thank_you_message||'Thank you for your feedback!'});
  }

  // action === 'get' (default): return the form definition, never any prior response data.
  const qr=await fetch(`${SB}/rest/v1/form_questions?form_id=eq.${form.id}&select=id,seq,type,prompt,options,rating_max,required&order=seq.asc`,{headers:H});
  const questions=await qr.json();

  return j({
    ok:true,
    form_id:form.id,
    title:form.title,
    description:form.description||'',
    collect_name:form.collect_name,
    collect_phone:form.collect_phone,
    collect_email:form.collect_email,
    questions:Array.isArray(questions)?questions:[]
  });
});
