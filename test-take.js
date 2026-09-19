/* Public, unauthenticated test-taking page -- no Supabase client, no key, ever, in this file.
   Everything goes through the two public edge functions (recruit-test-start/submit), which are
   the actual security boundary: the countdown drawn here is cosmetic, computed from the SERVER's
   own started_at/duration_seconds, not a locally-initialized variable -- so rewriting it in
   DevTools changes nothing about what the server will accept at submit time. See recruit-test-
   submit's own comments for exactly where the real deadline check happens.

   The right-click/DevTools-shortcut blocking below is a deterrent against the least technical
   candidates ONLY. It is trivially bypassed (open DevTools from the browser's own menu, or just
   use a different tool to watch network traffic) and is not, and must never be treated as, a real
   security control -- that's what the server-side deadline check is for. */
(function(){
  const SB='https://rkxsgtauigjrpcjkmccu.supabase.co';
  const params=new URLSearchParams(location.search);
  const attemptId=params.get('a');
  const app=document.getElementById('app');
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

  // Deterrent only -- see file header.
  document.addEventListener('contextmenu',e=>e.preventDefault());
  document.addEventListener('keydown',e=>{
    if(e.key==='F12'||(e.ctrlKey&&e.shiftKey&&['I','J','C'].includes(e.key))||(e.ctrlKey&&e.key==='u')) e.preventDefault();
  });

  if(!attemptId){
    app.innerHTML='<p class="err">This link is missing its test reference. Please use the exact link you were sent.</p>';
    return;
  }

  async function call(fn,body){
    const res=await fetch(SB+'/functions/v1/'+fn,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const out=await res.json().catch(()=>({error:'Unexpected response'}));
    if(!res.ok&&!out.error) out.error='Something went wrong (status '+res.status+')';
    return out;
  }

  function fmtTime(s){ s=Math.max(0,Math.round(s)); const m=Math.floor(s/60), r=s%60; return String(m).padStart(2,'0')+':'+String(r).padStart(2,'0'); }

  let CLOCK_OFFSET=0; // serverNow - Date.now(), so local time + offset approximates server time
  function serverNow(){ return Date.now()+CLOCK_OFFSET; }

  function renderStart(){
    app.innerHTML=
      '<h1>Ready to begin?</h1>'
      +'<p class="sub">Nothing can be answered until you press Start. Once started, the timer (if this test has one) runs continuously -- closing this tab does not pause it.</p>'
      +'<button class="btn" id="startBtn"><i class="fa-solid fa-play"></i> Start</button>';
    document.getElementById('startBtn').onclick=doStart;
  }

  async function doStart(){
    app.innerHTML='<div class="center"><div class="spin"></div></div>';
    const out=await call('recruit-test-start',{attempt_id:attemptId});
    if(out.error){ app.innerHTML='<p class="err">'+esc(out.error)+'</p>'; return; }
    if(out.status==='expired'){ app.innerHTML='<p class="err">This test\'s time has expired.</p>'; return; }
    if(out.status==='submitted'){ app.innerHTML='<p class="ok-msg">This test has already been submitted. Thank you.</p>'; return; }
    CLOCK_OFFSET=new Date(out.server_now).getTime()-Date.now();
    renderQuestions(out);
  }

  function renderQuestions(data){
    const startedAt=new Date(data.started_at).getTime();
    const deadline=data.duration_seconds?startedAt+data.duration_seconds*1000:null;
    app.innerHTML=
      (deadline?'<div class="timer" id="timer"><span><i class="fa-regular fa-clock"></i> Time remaining</span><span id="timerVal">--:--</span></div>':'')
      +'<h1>'+esc(data.test_name)+'</h1>'
      +'<p class="sub">Answer every question, then Submit. You cannot go back to a Start screen once begun.</p>'
      +'<div id="qList">'+data.questions.map(q=>renderQuestion(q)).join('')+'</div>'
      +'<div id="submitArea"><button class="btn" id="submitBtn"><i class="fa-solid fa-paper-plane"></i> Submit</button></div>'
      +'<p class="err" id="formErr" style="display:none;margin-top:10px"></p>';
    document.getElementById('submitBtn').onclick=()=>doSubmit(data.questions);

    if(deadline){
      const tick=()=>{
        const remain=(deadline-serverNow())/1000;
        const el=document.getElementById('timerVal'), box=document.getElementById('timer');
        if(!el)return;
        if(remain<=0){
          el.textContent='00:00';
          if(box)box.classList.add('low');
          lockForm("Time's up -- you can no longer edit answers. Submit now if you haven't already; a late submission will not be accepted.");
          clearInterval(iv);
          return;
        }
        el.textContent=fmtTime(remain);
        if(box)box.classList.toggle('low',remain<60);
      };
      tick();
      const iv=setInterval(tick,1000);
    }
  }

  function renderQuestion(q){
    const head='<div class="lbl">Question '+q.seq+' · '+(q.type==='mcq'?'Multiple choice':'Written answer')+' · '+q.max_marks+' mark'+(q.max_marks==1?'':'s')+'</div>';
    if(q.type==='mcq'){
      const opts=(q.options||[]).map(o=>
        '<label class="opt"><input type="radio" name="q'+q.id+'" value="'+esc(o.key)+'"> '+esc(o.text)+'</label>'
      ).join('');
      return '<div class="q" data-qid="'+q.id+'" data-type="mcq">'+head+'<div class="prompt">'+esc(q.prompt)+'</div>'+opts+'</div>';
    }
    return '<div class="q" data-qid="'+q.id+'" data-type="descriptive">'+head+'<div class="prompt">'+esc(q.prompt)+'</div><textarea data-qid="'+q.id+'" placeholder="Type your answer here"></textarea></div>';
  }

  function lockForm(message){
    document.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=true);
    const err=document.getElementById('formErr');
    if(err){ err.style.display='block'; err.textContent=message; }
  }

  function collectAnswers(){
    const answers=[];
    document.querySelectorAll('.q').forEach(qEl=>{
      const qid=Number(qEl.getAttribute('data-qid'));
      if(qEl.getAttribute('data-type')==='mcq'){
        const checked=qEl.querySelector('input[type="radio"]:checked');
        answers.push({question_id:qid,answer_text:checked?checked.value:''});
      } else {
        const ta=qEl.querySelector('textarea');
        answers.push({question_id:qid,answer_text:ta?ta.value:''});
      }
    });
    return answers;
  }

  async function doSubmit(){
    const btn=document.getElementById('submitBtn');
    const err=document.getElementById('formErr');
    if(err)err.style.display='none';
    btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';
    const out=await call('recruit-test-submit',{attempt_id:attemptId,answers:collectAnswers()});
    if(out.error){
      btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Submit';
      if(err){ err.style.display='block'; err.textContent=out.error; }
      return;
    }
    app.innerHTML='<div class="center"><i class="fa-solid fa-circle-check" style="font-size:40px;color:var(--ok)"></i><p class="ok-msg" style="margin-top:14px">'+esc(out.message||'Your test has been submitted. Thank you.')+'</p></div>';
  }

  renderStart();
})();
