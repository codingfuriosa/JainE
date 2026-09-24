/* Public, unauthenticated feedback form -- no Supabase client, no key, ever, in this file.
   Everything goes through the single public feedback-get-form edge function (action:'get'|'submit'),
   which is the actual security boundary -- this file only renders what that function returns and
   posts back what the person typed. */
(function(){
  const SB='https://rkxsgtauigjrpcjkmccu.supabase.co';
  const params=new URLSearchParams(location.search);
  const token=params.get('f');
  const app=document.getElementById('app');
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

  if(!token){
    app.innerHTML='<p class="err">This link is missing its form reference. Please use the exact link or QR code you were given.</p>';
    return;
  }

  async function call(action,body){
    const res=await fetch(SB+'/functions/v1/feedback-get-form',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({action,qr_token:token},body))});
    const out=await res.json().catch(()=>({error:'Unexpected response'}));
    if(!res.ok&&!out.error) out.error='Something went wrong (status '+res.status+')';
    return out;
  }

  function starRow(qid,max){
    let html='<div class="stars" data-qid="'+qid+'">';
    for(let i=1;i<=max;i++) html+='<i class="fa-solid fa-star" data-val="'+i+'"></i>';
    html+='</div>';
    return html;
  }

  function renderQuestion(q){
    const head='<div class="lbl">'+(q.required?'':'(Optional) ')+(q.type==='rating'?'Rating':q.type==='mcq'?'Multiple choice':'Question')+'</div>';
    if(q.type==='rating'){
      return '<div class="q" data-qid="'+q.id+'" data-type="rating">'+head+'<div class="prompt">'+esc(q.prompt)+'</div>'+starRow(q.id,q.rating_max||5)+'</div>';
    }
    if(q.type==='mcq'){
      const opts=(q.options||[]).map(o=>
        '<label class="opt"><input type="radio" name="q'+q.id+'" value="'+esc(o)+'"> '+esc(o)+'</label>'
      ).join('');
      return '<div class="q" data-qid="'+q.id+'" data-type="mcq">'+head+'<div class="prompt">'+esc(q.prompt)+'</div>'+opts+'</div>';
    }
    if(q.type==='short_text'){
      return '<div class="q" data-qid="'+q.id+'" data-type="short_text">'+head+'<div class="prompt">'+esc(q.prompt)+'</div><input type="text" data-qid="'+q.id+'" placeholder="Your answer"></div>';
    }
    return '<div class="q" data-qid="'+q.id+'" data-type="long_text">'+head+'<div class="prompt">'+esc(q.prompt)+'</div><textarea data-qid="'+q.id+'" placeholder="Your answer"></textarea></div>';
  }

  function contactField(kind,mode,label,type){
    if(mode==='off')return '';
    return '<div class="contact"><label class="fld">'+label+(mode==='required'?' *':' (optional)')+'</label><input type="'+type+'" id="cf_'+kind+'"></div>';
  }

  function render(data){
    app.innerHTML=
      '<h1>'+esc(data.title)+'</h1>'
      +(data.description?'<p class="sub">'+esc(data.description)+'</p>':'')
      +'<div id="contactFields">'
        +contactField('name',data.collect_name,'Name','text')
        +contactField('phone',data.collect_phone,'Phone Number','tel')
        +contactField('email',data.collect_email,'Email','email')
      +'</div>'
      +'<div id="qList">'+data.questions.map(renderQuestion).join('')+'</div>'
      +'<div id="submitArea" style="margin-top:6px"><button class="btn" id="submitBtn"><i class="fa-solid fa-paper-plane"></i> Submit</button></div>'
      +'<p class="err" id="formErr" style="display:none;margin-top:10px"></p>';

    app.querySelectorAll('.stars').forEach(function(box){
      box.addEventListener('click',function(e){
        const star=e.target.closest('[data-val]'); if(!star)return;
        const val=Number(star.getAttribute('data-val'));
        box.setAttribute('data-value',val);
        box.querySelectorAll('i').forEach(function(i){ i.classList.toggle('on', Number(i.getAttribute('data-val'))<=val); });
      });
    });

    document.getElementById('submitBtn').onclick=doSubmit;
  }

  function collectAnswers(){
    const answers=[];
    document.querySelectorAll('.q').forEach(function(qEl){
      const qid=Number(qEl.getAttribute('data-qid'));
      const type=qEl.getAttribute('data-type');
      let val='';
      if(type==='rating'){
        const box=qEl.querySelector('.stars');
        val=box.getAttribute('data-value')||'';
      }else if(type==='mcq'){
        const checked=qEl.querySelector('input[type="radio"]:checked');
        val=checked?checked.value:'';
      }else if(type==='short_text'){
        val=(qEl.querySelector('input')||{}).value||'';
      }else{
        val=(qEl.querySelector('textarea')||{}).value||'';
      }
      answers.push({question_id:qid,answer_text:val});
    });
    return answers;
  }

  async function doSubmit(){
    const btn=document.getElementById('submitBtn');
    const err=document.getElementById('formErr');
    err.style.display='none';
    btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';
    const nameEl=document.getElementById('cf_name'), phoneEl=document.getElementById('cf_phone'), emailEl=document.getElementById('cf_email');
    const out=await call('submit',{
      name:nameEl?nameEl.value:'', phone:phoneEl?phoneEl.value:'', email:emailEl?emailEl.value:'',
      answers:collectAnswers()
    });
    if(out.error){
      btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Submit';
      err.style.display='block'; err.textContent=out.error;
      return;
    }
    app.innerHTML='<div class="center"><i class="fa-solid fa-circle-check" style="font-size:40px;color:var(--ok)"></i><p class="ok-msg" style="margin-top:14px">'+esc(out.message||'Thank you for your feedback!')+'</p></div>';
  }

  (async function init(){
    const out=await call('get',{});
    if(out.error){ app.innerHTML='<p class="err">'+esc(out.error)+'</p>'; return; }
    render(out);
  })();
})();
