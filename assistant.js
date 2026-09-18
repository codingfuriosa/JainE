/* Quick Add (AI) -- a topbar widget loaded once per tab on every staff page (see boot() in
   nexus-core.js), not a routed page. Say or type a request; assistant-parse (edge function)
   classifies it and extracts fields; a complete request is acted on immediately -- no
   confirmation click -- through the exact same write path the app's own UI uses for that thing
   (acc.wf_create_instance for Reimbursement, a plain ptasks insert for a Task), so every existing
   rule (one-open-instance, permissions, etc.) still applies. Only a genuinely incomplete request
   gets a follow-up question instead of a guess.
*/
(function(){
  if(typeof sb==='undefined')return;
  if(document.getElementById('qaBtn'))return; // never inject twice (e.g. a second boot() on soft-reauth)
  const ACC=()=>sb.schema('acc');
  const me=()=>((state&&state.email)||'').toLowerCase();
  const REIMBURSEMENT_FLOW_ID=39;

  let PPL=null;
  async function people(){
    if(PPL)return PPL;
    try{ const {data}=await ACC().rpc('people'); PPL=(data||[]).map(function(p){return {email:p.email,name:p.full_name||String(p.email||'').split('@')[0]};}); }
    catch(e){ PPL=[]; }
    return PPL;
  }
  function findEmail(list,nameOrEmail){
    const q=String(nameOrEmail||'').trim().toLowerCase(); if(!q)return null;
    if(q.indexOf('@')!==-1){ const hit=list.find(function(p){return p.email.toLowerCase()===q;}); return hit?hit.email:q; }
    const exact=list.find(function(p){return p.name.toLowerCase()===q;}); if(exact)return exact.email;
    const partial=list.find(function(p){return p.name.toLowerCase().indexOf(q)!==-1;}); return partial?partial.email:null;
  }
  function wfTodayLocal(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

  let HISTORY=[];

  async function callParse(message){
    const {data:{session}}=await sb.auth.getSession(); const token=session&&session.access_token;
    const res=await fetch(SUPABASE_URL+'/functions/v1/assistant-parse',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},
      body:JSON.stringify({message:message,history:HISTORY})
    });
    const out=await res.json().catch(function(){return {error:'The assistant did not respond.'};});
    if(!res.ok||out.error) throw new Error(out.error||'The assistant call failed.');
    return out;
  }

  function bubble(role,html){ return '<div class="qa-msg qa-'+role+'"><div class="qa-bubble">'+html+'</div></div>'; }
  function scrollLog(){ const l=document.getElementById('qaLog'); if(l)l.scrollTop=l.scrollHeight; }
  function push(html){ const l=document.getElementById('qaLog'); if(l){ l.insertAdjacentHTML('beforeend',html); scrollLog(); } }

  async function createReimbursement(f){
    const details=[];
    if(f.upi_id) details.push({label:'UPI Id',value:f.upi_id});
    details.push({label:'Phone Number',value:f.phone_number||''});
    details.push({label:'Date',value:f.date||wfTodayLocal()});
    details.push({label:'Transport / Food',value:f.sub_type||''});
    details.push({label:'Description of Expense',value:f.description||''});
    details.push({label:'Amount',value:String(f.amount!=null?f.amount:'')});
    if(f.category==='Transport'&&f.sub_type==='Personal Vehicle'&&f.km!=null) details.push({label:'Km',value:String(f.km)});
    const {data:caseId,error}=await ACC().rpc('wf_create_instance',{p_flow_id:REIMBURSEMENT_FLOW_ID,p_details:details,p_step_members:null});
    if(error)throw error;
    push(bubble('assistant','<i class="fa-solid fa-circle-check" style="color:#16855a"></i> Reimbursement #'+caseId+' created ('+(f.category||'')+(f.sub_type?' — '+f.sub_type:'')+', ₹'+f.amount+'). It\'s gone to HR Review.'));
    toast('Reimbursement created','ok');
  }

  async function createTask(f){
    const list=await people();
    let assignees=(f.assignee_names||[]).map(function(n){return findEmail(list,n);}).filter(Boolean);
    if(!assignees.length) assignees=[me()];
    let projectId=null;
    if(f.project_name){
      const {data:existing}=await ACC().from('projects').select('id,name').ilike('name',f.project_name).limit(1);
      if(existing&&existing.length) projectId=existing[0].id;
    }
    const {data:t,error}=await ACC().from('ptasks').insert({title:f.title,delegator:me(),due_date:f.due_date||null,project_id:projectId,order_index:0}).select().single();
    if(error)throw error;
    await ACC().from('ptask_assignees').insert(assignees.map(function(e){return {task_id:t.id,email:e};}));
    for(const e of assignees){
      try{
        const {data:mx}=await ACC().from('task_rank').select('rank').ilike('viewer_email',e).order('rank',{ascending:false}).limit(1);
        const next=(mx&&mx.length?Number(mx[0].rank):0)+1;
        await ACC().from('task_rank').insert({task_id:t.id,viewer_email:e,rank:next});
      }catch(_e){}
    }
    push(bubble('assistant','<i class="fa-solid fa-circle-check" style="color:#16855a"></i> Task "'+esc(f.title)+'" created'+(f.due_date?(' — due '+f.due_date):'')+', assigned to '+assignees.join(', ')+'.'));
    toast('Task created','ok');
  }

  async function createMeeting(f){
    const row={title:f.title,mode:f.mode,recur_type:'none',meeting_date:f.date,start_time:f.start_time,end_time:f.end_time||null};
    if(f.mode==='offline') row.meet_link=null;
    row.created_by=me();
    const {data:m,error}=await ACC().from('meetings').insert(row).select().single();
    if(error)throw error;
    const list=await people();
    const attendees=(f.attendee_names||[]).map(function(n){return findEmail(list,n);}).filter(Boolean);
    if(attendees.length) await ACC().from('meeting_attendees').insert(attendees.map(function(e){return {meeting_id:m.id,email:e};}));
    if(f.mode==='online'){
      try{
        const {data:{session}}=await sb.auth.getSession(); const token=session&&session.access_token;
        await fetch(SUPABASE_URL+'/functions/v1/google-calendar-sync',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||''),'apikey':SUPABASE_KEY},body:JSON.stringify({meeting_id:m.id,action:'sync'})});
      }catch(_e){}
    }
    push(bubble('assistant','<i class="fa-solid fa-circle-check" style="color:#16855a"></i> Meeting "'+esc(f.title)+'" ('+f.mode+') created for '+f.date+' at '+f.start_time+'.'+(attendees.length?(' Attendees: '+attendees.join(', ')+'.'):'')));
    toast('Meeting created','ok');
  }

  const NET_LEASE_S=180, NET_POLL_MS=2500, NET_GIVEUP_MS=300000;
  async function runInternetSpeedTest(){
    push(bubble('assistant','<i class="fa-solid fa-spinner fa-spin"></i> Checking...'));
    const {data:presence}=await sb.from('net_presence').select('last_seen').order('last_seen',{ascending:false}).limit(1);
    const lastMsgs=document.querySelectorAll('#qaLog .qa-msg.qa-assistant'); const checking=lastMsgs[lastMsgs.length-1]; if(checking)checking.remove();
    const alive=presence&&presence.length&&((Date.now()-new Date(presence[0].last_seen).getTime())/1000)<NET_LEASE_S;
    if(!alive){ push(bubble('assistant','No speed-test device is online right now, so I can’t run a fresh test.')); return; }
    push(bubble('assistant','<span id="qaSpeedMsg"><i class="fa-solid fa-spinner fa-spin"></i> Running a speed test…</span>'));
    const {data:reqRow,error:reqErr}=await sb.rpc('net_request_test',{p_source:'quickadd'});
    if(reqErr){ const s=document.getElementById('qaSpeedMsg'); if(s)s.parentElement.parentElement.innerHTML='<div class="qa-bubble">Could not start a test: '+esc(reqErr.message)+'</div>'; return; }
    const reqId=Array.isArray(reqRow)?reqRow[0].id:reqRow.id;
    const start=Date.now();
    while(Date.now()-start<NET_GIVEUP_MS){
      await new Promise(function(r){setTimeout(r,NET_POLL_MS);});
      const {data:rr}=await sb.from('net_test_requests').select('status,speed_test_id,error_message').eq('id',reqId).single();
      if(!rr)continue;
      if(rr.status==='done'&&rr.speed_test_id){
        const {data:t}=await sb.from('net_speed_tests').select('download_mbps,upload_mbps,ping_ms').eq('id',rr.speed_test_id).single();
        const box=document.getElementById('qaSpeedMsg');
        if(box&&t) box.parentElement.parentElement.innerHTML='<i class="fa-solid fa-circle-check" style="color:#16855a"></i> Download '+Number(t.download_mbps).toFixed(1)+' Mbps, Upload '+Number(t.upload_mbps).toFixed(1)+' Mbps, Ping '+Number(t.ping_ms).toFixed(0)+' ms.';
        return;
      }
      if(rr.status==='failed'||rr.status==='expired'){
        const box=document.getElementById('qaSpeedMsg'); if(box)box.parentElement.parentElement.innerHTML='The test '+(rr.status==='expired'?'timed out':'failed')+(rr.error_message?(': '+esc(rr.error_message)):'.');
        return;
      }
    }
    const box=document.getElementById('qaSpeedMsg'); if(box)box.parentElement.parentElement.innerHTML='Gave up waiting for a result after 5 minutes.';
  }

  function fmtDate(d){ if(!d)return ''; try{ return new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'}); }catch(_e){ return d; } }
  async function queryReimbursements(){
    const {data,error}=await ACC().from('flow_cases').select('case_no,status,created_at').eq('flow_id',REIMBURSEMENT_FLOW_ID).eq('created_by',me()).order('case_no',{ascending:false}).limit(8);
    if(error){ push(bubble('assistant','Could not look that up: '+esc(error.message))); return; }
    if(!data||!data.length){ push(bubble('assistant','You have no Reimbursements on file.')); return; }
    const open=data.filter(function(r){return r.status!=='Done'&&r.status!=='Cancelled';});
    const lines=data.map(function(r){return '#'+r.case_no+' — '+r.status;});
    push(bubble('assistant','Your last '+data.length+' Reimbursement(s) ('+open.length+' still open):<br>'+lines.join('<br>')));
  }
  async function queryTasks(){
    const {data,error}=await ACC().from('ptask_assignees').select('ptasks(id,title,due_date,status)').eq('email',me()).limit(200);
    if(error){ push(bubble('assistant','Could not look that up: '+esc(error.message))); return; }
    const open=(data||[]).map(function(r){return r.ptasks;}).filter(function(t){return t&&t.status!=='Done';}).sort(function(a,b){return (a.due_date||'9999').localeCompare(b.due_date||'9999');}).slice(0,8);
    if(!open.length){ push(bubble('assistant','Nothing open on your task list 🎉')); return; }
    const lines=open.map(function(t){return esc(t.title)+(t.due_date?(' — due '+fmtDate(t.due_date)):'');});
    push(bubble('assistant','Your open tasks:<br>'+lines.join('<br>')));
  }
  async function queryMeetings(){
    const today=wfTodayLocal();
    const {data,error}=await ACC().from('meetings').select('title,mode,meeting_date,start_time').eq('created_by',me()).gte('meeting_date',today).order('meeting_date',{ascending:true}).limit(8);
    if(error){ push(bubble('assistant','Could not look that up: '+esc(error.message))); return; }
    if(!data||!data.length){ push(bubble('assistant','No upcoming meetings on your calendar.')); return; }
    const lines=data.map(function(m){return esc(m.title)+' — '+fmtDate(m.meeting_date)+' '+m.start_time+' ('+m.mode+')';});
    push(bubble('assistant','Your upcoming meetings:<br>'+lines.join('<br>')));
  }

  async function runQuery(topic){
    if(topic==='reimbursements') return queryReimbursements();
    if(topic==='tasks') return queryTasks();
    if(topic==='meetings') return queryMeetings();
    if(topic==='internet_speed') return runInternetSpeedTest();
    push(bubble('assistant',"I'm not sure what to look up there."));
  }

  async function runAction(kind,fields){
    if(kind==='reimbursement') return createReimbursement(fields);
    if(kind==='task') return createTask(fields);
    if(kind==='meeting') return createMeeting(fields);
    if(kind==='query') return runQuery(fields&&fields.topic);
    push(bubble('assistant',"I can only handle Tasks, Reimbursements, Meetings, and Internet Speed right now."));
  }

  async function handleMessage(msg){
    push(bubble('user',esc(msg)));
    push('<div class="qa-msg qa-assistant" id="qaThinking"><div class="qa-bubble"><i class="fa-solid fa-spinner fa-spin"></i></div></div>');
    HISTORY.push({role:'user',content:msg});
    try{
      const out=await callParse(msg);
      const think=document.getElementById('qaThinking'); if(think)think.remove();
      if(out.kind==='unclear'||(out.missing&&out.missing.length)){
        const q=out.clarifying_question||'Could you give me a bit more detail?';
        HISTORY.push({role:'assistant',content:q});
        push(bubble('assistant',esc(q)));
      } else {
        HISTORY=[];
        await runAction(out.kind,out.fields);
      }
    }catch(e){
      const think=document.getElementById('qaThinking'); if(think)think.remove();
      push(bubble('assistant','Something went wrong: '+esc((e&&e.message)||String(e))));
    }
  }

  window.qaSend=async function(){
    const inp=document.getElementById('qaInput'); const msg=(inp&&inp.value||'').trim(); if(!msg)return;
    inp.value=''; inp.disabled=true;
    try{ await handleMessage(msg); } finally { inp.disabled=false; inp.focus(); }
  };

  /* Voice -- Web Speech API (Chrome's built-in recognizer). One language at a time rather than
     free mixing; the three chips let the user switch instantly if they change language between
     requests. A final result auto-sends -- "just say it and the work is done" is the whole point
     of voice here, so there's no extra tap after speaking. */
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  let RECOG=null, LISTENING=false;
  let VOICE_LANG=localStorage.getItem('qaVoiceLang')||'en-IN';
  function setVoiceLang(l){ VOICE_LANG=l; try{localStorage.setItem('qaVoiceLang',l);}catch(_e){} const p=document.getElementById('qaPanel'); if(p) p.querySelectorAll('.qa-lang').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-l')===l);}); }
  function ensureRecog(){
    if(!SR)return null;
    if(RECOG)return RECOG;
    RECOG=new SR();
    RECOG.continuous=false; RECOG.interimResults=true;
    RECOG.onresult=function(ev){
      let text=''; for(let i=0;i<ev.results.length;i++) text+=ev.results[i][0].transcript;
      const inp=document.getElementById('qaInput'); if(inp)inp.value=text;
      if(ev.results[ev.results.length-1].isFinal){ setMicOn(false); window.qaSend(); }
    };
    RECOG.onerror=function(){ setMicOn(false); };
    RECOG.onend=function(){ setMicOn(false); };
    return RECOG;
  }
  function setMicOn(on){
    LISTENING=on;
    const b=document.getElementById('qaMic'); if(!b)return;
    b.classList.toggle('qa-mic-on',on);
    b.querySelector('i').className='fa-solid '+(on?'fa-stop':'fa-microphone');
  }
  window.qaMicToggle=function(){
    const r=ensureRecog();
    if(!r){ toast('Voice input is not supported in this browser','err'); return; }
    if(LISTENING){ r.stop(); return; }
    r.lang=VOICE_LANG; try{ r.start(); setMicOn(true); }catch(_e){}
  };
  window.qaSetLang=function(l){ setVoiceLang(l); };

  window.qaToggle=function(){
    const p=document.getElementById('qaPanel'); if(!p)return;
    p.classList.toggle('show');
    if(p.classList.contains('show')){ const inp=document.getElementById('qaInput'); if(inp)setTimeout(function(){inp.focus();},50); }
  };

  function inject(){
    const actions=document.querySelector('.topbar-actions'); if(!actions)return;
    const wrap=el('div','qa-wrap');
    wrap.innerHTML=
      '<button class="ic-btn" id="qaBtn" title="Quick Add" onclick="qaToggle()"><i class="fa-solid fa-wand-magic-sparkles"></i></button>'
      +'<div class="dropdown qa-panel" id="qaPanel">'
        +'<div class="qa-head">'
          +'<div><b>Quick Add</b><div class="qa-sub">Tasks · Reimbursements · Meetings · Internet Speed</div></div>'
          +'<div class="qa-langs">'
            +'<button class="qa-lang" data-l="en-IN" onclick="qaSetLang(\'en-IN\')">EN</button>'
            +'<button class="qa-lang" data-l="hi-IN" onclick="qaSetLang(\'hi-IN\')">HI</button>'
            +'<button class="qa-lang" data-l="bn-IN" onclick="qaSetLang(\'bn-IN\')">BN</button>'
          +'</div>'
        +'</div>'
        +'<div id="qaLog" class="qa-log"></div>'
        +'<div class="qa-inputrow">'
          +'<input class="ac-in" id="qaInput" placeholder="Type, or tap the mic and speak…" onkeydown="if(event.key===\'Enter\')qaSend()">'
          +(SR?'<button class="ic-btn" id="qaMic" title="Speak" onclick="qaMicToggle()"><i class="fa-solid fa-microphone"></i></button>':'')
          +'<button class="ic-btn" id="qaSendBtn" title="Send" onclick="qaSend()"><i class="fa-solid fa-paper-plane"></i></button>'
        +'</div>'
      +'</div>';
    actions.insertBefore(wrap,actions.firstChild);
    setVoiceLang(VOICE_LANG);
    document.addEventListener('click',function(ev){
      const p=document.getElementById('qaPanel'); if(!p||!p.classList.contains('show'))return;
      if(!wrap.contains(ev.target)) p.classList.remove('show');
    });
    if(!document.getElementById('qaStyle')){
      const st=document.createElement('style'); st.id='qaStyle';
      st.textContent=
        '.qa-wrap{position:relative;display:inline-flex}'
        +'.qa-panel{width:380px;max-width:88vw;top:46px;right:0;padding:0;overflow:hidden;display:none}'
        +'.qa-panel.show{display:block}'
        +'.qa-head{display:flex;align-items:flex-start;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--line)}'
        +'.qa-sub{color:var(--slate);font-size:11.5px;margin-top:2px}'
        +'.qa-langs{display:flex;gap:4px}'
        +'.qa-lang{border:1px solid var(--line);background:#fff;border-radius:6px;font-size:10.5px;font-weight:700;padding:3px 7px;cursor:pointer;color:var(--slate)}'
        +'.qa-lang.on{background:var(--brand);border-color:var(--brand);color:#fff}'
        +'.qa-log{max-height:320px;min-height:80px;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:9px;background:var(--bg)}'
        +'.qa-msg{display:flex}.qa-msg.qa-user{justify-content:flex-end}'
        +'.qa-bubble{max-width:85%;padding:8px 11px;border-radius:11px;font-size:13px;line-height:1.45}'
        +'.qa-user .qa-bubble{background:var(--brand);color:#fff;border-bottom-right-radius:3px}'
        +'.qa-assistant .qa-bubble{background:#fff;color:var(--ink);border:1px solid var(--line);border-bottom-left-radius:3px}'
        +'.qa-inputrow{display:flex;gap:6px;padding:10px 12px;border-top:1px solid var(--line);background:#fff}'
        +'.qa-inputrow .ac-in{flex:1}'
        +'#qaMic.qa-mic-on{background:#c83232;border-color:#c83232;color:#fff}'
      ;
      document.head.appendChild(st);
    }
  }
  inject();
})();
