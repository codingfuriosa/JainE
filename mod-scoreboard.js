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

/* ============================== WEEKLY STATUS ==============================
   The OPS meeting: who was there, what was decided, who it landed on, and whether it ever got
   done.

   WHY THIS PAGE EXISTS. The minutes have been kept in one Google Sheet since February 2025 - 29
   meetings, 495 action items - and the sheet answers exactly one question well: "what did we
   decide on the 21st". It cannot answer the questions actually asked in the room: what is still
   open, how long it has been open, who is carrying the most, and whether we close things faster
   than we open them. Same data, read the other way round.

   WHAT IS SHOWN, AND WHAT IT IS READ FROM. Every figure comes from ops.items and ops.meetings via
   two RPCs; nothing is computed twice or kept in two places. The sheet's own words are carried on
   every row - the Deadline cell exactly as typed, the Assigned To cell exactly as typed - so a
   status this derived can always be checked against what somebody actually wrote. A dashboard that
   cannot be checked gets quietly distrusted and then ignored.

   FOUR TABS, BECAUSE THEY ARE FOUR DIFFERENT QUESTIONS.
     Dashboard    - how are we doing, and what has been open longest.
     Meetings     - the minutes, as minutes: date, who attended, what came out of it.
     Action items - the list, filterable, where work is actually ticked off.
     People       - who owes what. The one that makes a Monday meeting shorter.
   Filters are shared across the last three and applied in the browser: 495 rows is nothing to
   filter locally, and a round trip per keystroke would make it feel slow for no benefit. */

VIEWS.scoreboard=async function(v){
  setCrumb(['Scoreboard']);
  v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid fa-ranking-star" style="color:#b8902f"></i> Scoreboard</h1><p>Who is delivering assigned work, and on time</p></div></div>'
    +'<div class="card" style="padding:0">'
      +'<div style="display:flex;gap:8px;padding:14px 16px;border-bottom:1px solid var(--line);align-items:center;flex-wrap:wrap">'
        +'<button class="btn'+(SB_VIEW==='all'?' btn-primary':'')+'" onclick="sbSetView(\'all\')">All Tasks</button>'
        +'<button class="btn'+(SB_VIEW==='causelist'?' btn-primary':'')+'" onclick="sbSetView(\'causelist\')">Causelist</button>'
      +'</div><div id="sbBody"><div class="loader"><div class="spin"></div></div></div></div>';
  if(SB_VIEW==='causelist') await sbRenderCauselistBoard($('sbBody'));
  else await sbRenderAllTasks($('sbBody'));
};
// Kept so /tasks/scoreboard links and bookmarks from when it was a tab still land somewhere real.