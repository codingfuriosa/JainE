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

  // Plain Unicode glyphs, not an icon font: a rating widget is the single most-used control on
  // this page, and a CDN webfont that fails to load (slow network, a corporate firewall blocking
  // it, this exact page served from somewhere the icon CSS doesn't fully apply) turns it into an
  // invisible click target with a blank gap where the stars should be -- confirmed directly against
  // a real running copy of this page, not a hypothetical. A star character is always there.
  function starRow(qid,max){
    let html='<div class="stars" data-qid="'+qid+'" role="radiogroup" aria-label="Rating, '+max+' stars">';
    for(let i=1;i<=max;i++){
      html+='<span class="star" data-val="'+i+'" role="radio" aria-checked="false" aria-label="'+i+' out of '+max+'" tabindex="'+(i===1?'0':'-1')+'">&#9733;</span>';
    }
    html+='</div><div class="star-readout" id="starReadout_'+qid+'" aria-live="polite">No rating selected</div>';
    return html;
  }

  function errMsg(){
    return '<div class="q-err-msg">This question needs an answer.</div>';
  }

  function renderQuestion(q,i){
    const num='<span class="qnum">'+(i+1)+'</span>';
    const req=q.required?'1':'0';
    const promptHtml='<div class="prompt">'+num+esc(q.prompt)+(q.required?'<span class="req">*</span>':'<span class="opt-tag">Optional</span>')+'</div>';
    if(q.type==='rating'){
      return '<div class="q" data-qid="'+q.id+'" data-type="rating" data-required="'+req+'">'+promptHtml+starRow(q.id,q.rating_max||5)+errMsg()+'</div>';
    }
    if(q.type==='mcq'){
      const opts=(q.options||[]).map(o=>
        '<label class="opt"><input type="radio" name="q'+q.id+'" value="'+esc(o)+'"> '+esc(o)+'</label>'
      ).join('');
      return '<div class="q" data-qid="'+q.id+'" data-type="mcq" data-required="'+req+'">'+promptHtml+opts+errMsg()+'</div>';
    }
    if(q.type==='short_text'){
      return '<div class="q" data-qid="'+q.id+'" data-type="short_text" data-required="'+req+'">'+promptHtml+'<input type="text" data-qid="'+q.id+'" placeholder="Your answer">'+errMsg()+'</div>';
    }
    return '<div class="q" data-qid="'+q.id+'" data-type="long_text" data-required="'+req+'">'+promptHtml+'<textarea data-qid="'+q.id+'" placeholder="Your answer"></textarea>'+errMsg()+'</div>';
  }

  function clearErr(qEl){
    if(!qEl)return;
    qEl.classList.remove('q-err');
    const m=qEl.querySelector('.q-err-msg');if(m)m.style.display='none';
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
      +'<div id="qList">'+data.questions.map(function(q,i){return renderQuestion(q,i);}).join('')+'</div>'
      +'<div id="submitArea" style="margin-top:6px"><button class="btn" id="submitBtn">Submit</button></div>'
      +'<p class="err" id="formErr" style="display:none;margin-top:10px"></p>';

    app.querySelectorAll('.stars').forEach(function(box){
      const max=box.querySelectorAll('[data-val]').length;
      const qid=box.getAttribute('data-qid');
      function selectVal(val,opts){
        val=Math.max(1,Math.min(max,val));
        box.setAttribute('data-value',val);
        box.querySelectorAll('.star').forEach(function(i){
          const v=Number(i.getAttribute('data-val'));
          i.classList.toggle('on',v<=val);
          i.setAttribute('aria-checked',v===val?'true':'false');
          i.setAttribute('tabindex',v===val?'0':'-1');
        });
        const ro=document.getElementById('starReadout_'+qid);
        if(ro)ro.textContent=val+' / '+max;
        if(opts&&opts.focus){ const el=box.querySelector('[data-val="'+val+'"]'); if(el)el.focus(); }
        clearErr(box.closest('.q'));
      }
      box.addEventListener('click',function(e){
        const star=e.target.closest('[data-val]'); if(!star)return;
        selectVal(Number(star.getAttribute('data-val')));
      });
      box.addEventListener('keydown',function(e){
        const cur=Number(box.getAttribute('data-value')||0);
        if(e.key==='ArrowRight'||e.key==='ArrowUp'){ e.preventDefault(); selectVal((cur||0)+1,{focus:true}); }
        else if(e.key==='ArrowLeft'||e.key==='ArrowDown'){ e.preventDefault(); selectVal(cur?cur-1:1,{focus:true}); }
        else if(e.key===' '||e.key==='Enter'){
          e.preventDefault();
          const active=document.activeElement;
          const val=active&&active.getAttribute&&active.getAttribute('data-val');
          if(val)selectVal(Number(val));
        }
      });
    });

    // Clear a question's error highlight as soon as it gets an answer, so the red border isn't
    // stuck there after the person has already fixed it (stars clear themselves in selectVal above).
    app.addEventListener('input',function(e){
      const t=e.target;
      if(t.matches&&t.matches('input[type="text"],textarea')&&t.value.trim()) clearErr(t.closest('.q'));
    });
    app.addEventListener('change',function(e){
      const t=e.target;
      if(t.matches&&t.matches('input[type="radio"]')&&t.checked) clearErr(t.closest('.q'));
    });

    document.getElementById('submitBtn').onclick=doSubmit;
  }

  // Walks every question, collecting its answer AND flagging any unanswered required one -- so a
  // submit can be stopped client-side instead of only failing after a round trip to the edge function.
  function validateAndCollect(){
    const answers=[];
    let firstInvalid=null;
    document.querySelectorAll('.q').forEach(function(qEl){
      const qid=Number(qEl.getAttribute('data-qid'));
      const type=qEl.getAttribute('data-type');
      const required=qEl.getAttribute('data-required')==='1';
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
      if(required&&!String(val).trim()){
        qEl.classList.add('q-err');
        const m=qEl.querySelector('.q-err-msg');if(m)m.style.display='flex';
        if(!firstInvalid)firstInvalid=qEl;
      }else{
        clearErr(qEl);
      }
      answers.push({question_id:qid,answer_text:val});
    });
    return {answers:answers,firstInvalid:firstInvalid};
  }

  async function doSubmit(){
    const btn=document.getElementById('submitBtn');
    const err=document.getElementById('formErr');
    err.style.display='none';
    const{answers,firstInvalid}=validateAndCollect();
    if(firstInvalid){
      err.style.display='block';
      err.textContent='Please answer every required question — see the highlighted question below.';
      firstInvalid.scrollIntoView({behavior:'smooth',block:'center'});
      const focusable=firstInvalid.querySelector('[tabindex],input,textarea');
      if(focusable)focusable.focus({preventScroll:true});
      return;
    }
    btn.disabled=true; btn.innerHTML='<span class="btn-spin"></span> Submitting…';
    const nameEl=document.getElementById('cf_name'), phoneEl=document.getElementById('cf_phone'), emailEl=document.getElementById('cf_email');
    const out=await call('submit',{
      name:nameEl?nameEl.value:'', phone:phoneEl?phoneEl.value:'', email:emailEl?emailEl.value:'',
      answers:answers
    });
    if(out.error){
      btn.disabled=false; btn.innerHTML='Submit';
      err.style.display='block'; err.textContent=out.error;
      return;
    }
    app.innerHTML='<div class="center"><div class="ok-check">&#10003;</div><p class="ok-msg" style="margin-top:14px">'+esc(out.message||'Thank you for your feedback!')+'</p></div>';
  }

  (async function init(){
    const out=await call('get',{});
    if(out.error){ app.innerHTML='<p class="err">'+esc(out.error)+'</p>'; return; }
    render(out);
  })();
})();
