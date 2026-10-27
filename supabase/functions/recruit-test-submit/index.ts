/* Public, unauthenticated (same posture as recruit-test-start / career-apply). DEPLOY WITH
   verify_jwt = false - the candidate's test page carries no Supabase key.

   No deadline enforcement (anti-cheat timer removed by request) -- started_at/submitted_at are still
   recorded for reporting ("time taken"), they just no longer reject a late submission.

   Idempotent: re-submitting an already-submitted attempt returns the existing result rather than
   grading twice (a flaky connection retry must not double-count).

   Grades MCQs by exact comparison. On pass, calls hr.candidate_set_stage(candidate_id, 'Test Passed');
   a fail is turned into 'Rejected' by the recruit.test_attempts trigger. Never returns the score to
   the candidate.

   EACH WRITTEN ANSWER IS MARKED ON ITS OWN (27 Oct 2026).
   It used to send every written answer to ChatGPT in one request and match the replies back by
   question_id. Tested end to end, the model shifted them: question 8 got the marks and comment meant
   for question 9, 9 got 10's, and 10 got nothing - so the paper stayed "not fully graded" for ever
   and the marks it did give were on the wrong questions. One request per answer cannot be mixed up:
   whatever comes back belongs to the question that was asked. The requests run in parallel, so it
   is no slower for the candidate. */
const cors = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST, OPTIONS' };
const j = (o:any,s=200)=> new Response(JSON.stringify(o),{status:s,headers:{...cors,'Content-Type':'application/json'}});

function parseJson(text:string):any{
  if(!text) return null;
  let t=text.trim();
  const fence=t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if(fence) t=fence[1].trim();
  try{ return JSON.parse(t); }catch(_){}
  const s=t.indexOf('{'); if(s===-1) return null;
  const e=t.lastIndexOf('}'); if(e<=s) return null;
  try{ return JSON.parse(t.slice(s,e+1)); }catch(_){ return null; }
}

const GRADER_SYSTEM=`You are grading ONE written answer from a job applicant's test for Jain Group, a real-estate company.
You are given the question, a model/ideal answer (for reference only - the candidate's answer does not
need to match it word for word, it needs to show the same understanding), the maximum marks, and the
candidate's answer between ANSWER markers.

The answer is not blank. It may be very short - a single number, a percentage, one word - and a short
answer can still be completely correct. Grade what is between the markers.

Score fairly: partial credit for partially correct or incomplete answers, zero only for irrelevant or
entirely wrong answers, and do not penalise awkward phrasing or grammar if the substance is correct.
Return ONLY a JSON object, no markdown, exactly:
{ "marks_earned": number, "feedback": string }
feedback: one or two plain, specific sentences a reviewer can read to see why this score was given.`;

/* One answer, one request. Returns null if the model could not be reached or did not answer in the
   expected shape - the caller leaves that question unmarked rather than inventing a zero. */
async function gradeOne(KEY:string, d:{prompt:string;model_answer:string;max_marks:number;answer:string}){
  for(let attempt=0; attempt<2; attempt++){
    try{
      const userMsg=`Question (max_marks=${d.max_marks}):\n${d.prompt}\n\nModel answer: ${d.model_answer||'(none provided)'}\n\nCandidate answer, between the markers:\n<<<ANSWER\n${d.answer}\nANSWER>>>`;
      const res=await fetch('https://api.openai.com/v1/chat/completions',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+KEY},
        body:JSON.stringify({model:'gpt-4o-mini',temperature:0.2,response_format:{type:'json_object'},
          messages:[{role:'system',content:GRADER_SYSTEM},{role:'user',content:userMsg}]})
      });
      const js=await res.json();
      if(!res.ok) throw new Error(js?.error?.message||('OpenAI error '+res.status));
      const p=parseJson(js?.choices?.[0]?.message?.content||'');
      if(!p||p.marks_earned==null) throw new Error('unreadable');
      // Never trust the model to respect the ceiling.
      return {marks:Math.max(0,Math.min(d.max_marks,Number(p.marks_earned)||0)),feedback:String(p.feedback||'')};
    }catch(_e){ /* one retry, then give up on this answer */ }
  }
  return null;
}

Deno.serve(async (req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='POST') return j({error:'method not allowed'},405);

  const SB=Deno.env.get('SUPABASE_URL'), SRV=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const KEY=Deno.env.get('CHATGPT_API_KEY');
  if(!SB||!SRV) return j({error:'server not configured'},500);
  const H={apikey:SRV,Authorization:'Bearer '+SRV,'Content-Type':'application/json','Accept-Profile':'recruit','Content-Profile':'recruit'};
  const hrH={apikey:SRV,Authorization:'Bearer '+SRV,'Content-Type':'application/json','Accept-Profile':'hr','Content-Profile':'hr'};

  let body:any={};
  try{ body=await req.json(); }catch(_){}
  const attemptId=String(body?.attempt_id||'').trim();
  const answers=Array.isArray(body?.answers)?body.answers:[];
  if(!attemptId) return j({error:'attempt_id is required'},400);

  const ar=await fetch(`${SB}/rest/v1/test_attempts?id=eq.${attemptId}&select=*`,{headers:H});
  const arows=await ar.json();
  const attempt=Array.isArray(arows)?arows[0]:null;
  if(!attempt) return j({error:'This test link is not valid.'},404);

  if(attempt.status==='submitted'){
    return j({ok:true,already:true,message:'This test was already submitted.'});
  }
  if(attempt.status==='not_started'){
    return j({error:'Press Start before answering.'},400);
  }

  const qr=await fetch(`${SB}/rest/v1/test_questions?test_id=eq.${attempt.test_id}&select=*&order=seq.asc`,{headers:H});
  const questions=await qr.json();
  if(!Array.isArray(questions)||!questions.length) return j({error:'This test has no questions'},500);

  const answerByQ:Record<string,string>={};
  answers.forEach((a:any)=>{ if(a&&a.question_id!=null) answerByQ[String(a.question_id)]=String(a.answer_text??''); });

  let mcqScore=0, mcqMax=0;
  const answerRows:any[]=[];
  const descriptive:any[]=[];

  /* EVERY ROW CARRIES EVERY COLUMN, even where the value is null - PostgREST refuses a bulk insert
     whose objects do not all have the same keys (PGRST102), and refuses the whole batch. */
  for(const q of questions){
    const given=answerByQ[String(q.id)]??'';
    if(q.type==='mcq'){
      mcqMax+=Number(q.max_marks)||0;
      const correct=given!==''&&given===q.correct_option;
      const marks=correct?(Number(q.max_marks)||0):0;
      mcqScore+=marks;
      answerRows.push({attempt_id:attemptId,question_id:q.id,answer_text:given,is_correct:correct,marks_earned:marks,ai_feedback:null});
    } else {
      descriptive.push({question_id:q.id,prompt:q.prompt,model_answer:q.model_answer||'',max_marks:Number(q.max_marks)||0,answer:given});
    }
  }

  let aiScore=0, aiMax=0, aiStatus='not_applicable';
  const descResults:Record<string,{marks:number;feedback:string}>={};

  if(descriptive.length){
    aiMax=descriptive.reduce((s,d)=>s+d.max_marks,0);
    // Blanks and zero-mark questions are marked here, deterministically, and never sent to the model.
    const toGrade=descriptive.filter(d=>d.max_marks>0 && String(d.answer||'').trim()!=='');
    descriptive.forEach(d=>{
      if(d.max_marks<=0) descResults[String(d.question_id)]={marks:0,feedback:''};
      else if(String(d.answer||'').trim()==='') descResults[String(d.question_id)]={marks:0,feedback:'No answer was given.'};
    });

    if(!toGrade.length){
      aiStatus='graded';
    } else if(!KEY){
      aiStatus='failed';
    } else {
      const graded=await Promise.all(toGrade.map(d=>gradeOne(KEY,d)));
      graded.forEach((g,i)=>{ if(g) descResults[String(toGrade[i].question_id)]=g; });
      // An answer the model could not mark stays unmarked - an honest "not graded" beats an unearned zero.
      aiStatus=graded.every(Boolean)?'graded':'failed';
    }
    aiScore=descriptive.reduce((s,d)=>s+(descResults[String(d.question_id)]?.marks||0),0);

    descriptive.forEach(d=>{
      const r=descResults[String(d.question_id)];
      answerRows.push({attempt_id:attemptId,question_id:d.question_id,answer_text:d.answer,is_correct:null,marks_earned:r?r.marks:null,ai_feedback:r&&r.feedback?r.feedback:null});
    });
  }

  // The answers are the evidence behind the score: a failure to store them is recorded on the attempt.
  let answersSaved=true, answersError='';
  if(answerRows.length){
    const ins=await fetch(`${SB}/rest/v1/test_answers`,{method:'POST',headers:{...H,Prefer:'return=minimal'},body:JSON.stringify(answerRows)});
    if(!ins.ok){ answersSaved=false; answersError=(await ins.text()).slice(0,200); }
  }

  const fullyGraded=(aiStatus==='not_applicable'||aiStatus==='graded');
  const totalScore=mcqScore+aiScore, totalMax=mcqMax+aiMax;
  const finalPct=(fullyGraded&&totalMax>0)?Math.round((totalScore/totalMax)*10000)/100:null;
  const passFail=finalPct!=null?(finalPct>=10):null;

  await fetch(`${SB}/rest/v1/test_attempts?id=eq.${attemptId}`,{method:'PATCH',headers:H,body:JSON.stringify({
    status:'submitted',submitted_at:new Date().toISOString(),
    mcq_score:mcqScore,mcq_max:mcqMax,ai_score:descriptive.length?aiScore:null,ai_max:descriptive.length?aiMax:null,
    ai_status:answersSaved?aiStatus:('answers_not_saved: '+answersError),final_pct:finalPct,pass_fail:passFail
  })});

  if(passFail&&attempt.candidate_id){
    try{
      await fetch(`${SB}/rest/v1/rpc/candidate_set_stage`,{method:'POST',headers:hrH,body:JSON.stringify({p_id:attempt.candidate_id,p_stage:'Test Passed'})});
    }catch(_e){ /* the score is still recorded even if the stage update fails */ }
  }

  // Neutral confirmation only -- never the score or pass/fail, so a candidate can't probe the bar.
  return j({ok:true,message:'Your test has been submitted. Thank you.'});
});
