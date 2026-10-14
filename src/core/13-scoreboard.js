/* ===== SCOREBOARD — its own module, not a tab inside Accountability =====

   It used to exist twice, in two places, computing two different numbers from the same RPC: the
   real one in accountability.js, and a legacy copy here that averaged punctuality, a capped
   "closure score" and a capped checklist score, then docked points for due-date extensions - a
   figure that shared nothing with the one people actually saw, and which leaned on
   due_date_extensions, a column acc.scoreboard() has always returned hardcoded to 0. Pulling the
   Scoreboard out of Accountability is the moment to have one implementation instead of two, so
   this is now the only one, and it is the arithmetic the tab really used.

   Lives in nexus-core.js rather than its own page script because nexus-core is loaded by every
   page already: no extra <script>, no load-order race, and the legacy /tasks/scoreboard route can
   hand straight over to it. */
let SB_VIEW='all';
window.sbSetView=function(v){ if(SB_VIEW===v)return; SB_VIEW=v; if(typeof renderPage==='function')renderPage(); };
const sbMedal=i=>i===0?'🥇':i===1?'🥈':i===2?'🥉':'<b style="color:var(--slate)">'+(i+1)+'</b>';

async function sbRenderAllTasks(host){
  let rows=[]; try{const {data}=await sb.schema('acc').rpc('scoreboard');rows=data||[];}catch(e){}
  /* The score is the sum of the counts the RPC returns, and the RPC decides which tasks reach
     those counts: self-assigned ones are excluded, and a task with no due date is not counted as
     having met one. So per task: due date met +2, due date missed 0, no due date +1. */
  rows=rows.map(r=>Object.assign({},r,{score:(r.tasks_completed||0)+(r.tasks_on_time||0)-(r.tasks_late||0)}))
           .sort((a,b)=>b.score-a.score||b.tasks_completed-a.tasks_completed);
  if(!host)return;
  host.innerHTML='<div style="padding:10px 16px;font-size:12px;color:var(--slate);border-bottom:1px solid var(--line)">Counts tasks someone else assigned you. Completed <b>+1</b> · finished by its due date <b>+1 more</b> · missed the due date <b>&minus;1</b>. A task with no due date still earns the completion point but cannot earn the on-time point. Tasks you assigned to yourself are listed under <b>Self</b> and do not score. Declines automatically reverse the credit.</div>'
    /* No "Sub" column. It showed acc.scoreboard()'s checklist_items_done, which counts done
       subtasks by the names in ptask_subtasks.people — and every completed subtask in the system
       has that array empty, so the column read 0 for all 85 people. It never fed the score either.
       The RPC still returns the count; nothing displays it now. */
    +'<div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr><th>#</th><th>Person</th><th>Tasks</th><th>On-time</th><th>Overdue</th><th title="Tasks this person created for themselves — shown for completeness, not scored">Self</th><th>Score</th></tr></thead><tbody>'
    +(rows.length?rows.map((r,i)=>'<tr><td>'+sbMedal(i)+'</td><td><b>'+esc(r.full_name||r.email)+'</b></td><td>'+r.tasks_completed+'</td><td style="color:#16a34a">'+r.tasks_on_time+'</td><td style="color:#dc2626">'+r.tasks_late+'</td><td style="color:var(--slate)">'+(r.tasks_self||0)+'</td><td style="font-weight:800">'+r.score+'</td></tr>').join('')
       :'<tr><td colspan="7"><div class="empty" style="padding:22px">No activity yet</div></td></tr>')
    +'</tbody></table></div>';
}

async function sbRenderCauselistBoard(host){
  let rows=[]; try{const {data}=await sb.schema('acc').rpc('scoreboard_causelist');rows=data||[];}catch(e){}
  if(!host)return;
  host.innerHTML='<div style="padding:10px 16px;font-size:12px;color:var(--slate);border-bottom:1px solid var(--line)">Legal MIS causelist tasks only — per task, by how far ahead of its due date it was finished: 7+ days early <b>+2</b> · 3–6 days early <b>+1</b> · 0–2 days early <b>0</b> · after the due date <b>&minus;1</b></div>'
    +'<div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr><th>#</th><th>Person</th><th>Assigned</th><th>Completed</th><th>Pending</th><th>Score</th></tr></thead><tbody>'
    +(rows.length?rows.map((r,i)=>'<tr><td>'+sbMedal(i)+'</td><td><b>'+esc(r.full_name||r.email)+'</b></td><td>'+r.tasks_assigned+'</td><td>'+r.tasks_completed+'</td><td>'+r.tasks_pending+'</td><td style="font-weight:800">'+r.score+'</td></tr>').join('')
       :'<tr><td colspan="6"><div class="empty" style="padding:22px">No causelist tasks yet</div></td></tr>')
    +'</tbody></table></div>';
}

