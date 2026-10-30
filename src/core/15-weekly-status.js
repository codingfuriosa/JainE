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

const WS={items:null,meetings:null,err:'',tab:0,q:'',owner:'',project:'',status:'',onlyOpen:false,openMtg:new Set()};

const WS_STATUS=[
  ['done',       'Done',        '#15803d','#dcfce7'],
  ['in_progress','In progress', '#b45309','#fef3c7'],
  ['not_done',   'Not done',    '#b91c1c','#fee2e2'],
  ['open',       'Open',        '#475569','#f1f5f9']
];
function wsStat(s){ return WS_STATUS.find(function(x){return x[0]===s;})||WS_STATUS[3]; }
function wsChip(s){
  const f=wsStat(s);
  return '<span class="badge" style="background:'+f[3]+';color:'+f[2]+';white-space:nowrap">'+f[1]+'</span>';
}

const WS_CSS='<style id="wsCss">'
  +'.ws-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:16px 0 4px}'
  +'.ws-kpi{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px}'
  +'.ws-kpi b{display:block;font-size:26px;line-height:1.1;font-weight:800;letter-spacing:-.02em}'
  +'.ws-kpi span{display:block;margin-top:5px;font-size:11.5px;color:var(--slate);line-height:1.35}'
  +'.ws-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:16px 0 0}'
  +'.ws-tab{border:1px solid var(--line);background:#fff;border-radius:999px;padding:7px 15px;font-size:13px;'
    +'font-weight:600;color:var(--slate);cursor:pointer;font-family:inherit;transition:all .15s}'
  +'.ws-tab:hover{border-color:#c4b5fd;color:#6b21a8}'
  +'.ws-tab.on{background:#f5f3ff;border-color:#c4b5fd;color:#6b21a8}'
  +'.ws-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin:14px 0 0}'
  +'.ws-f{display:flex;flex-direction:column;gap:5px;min-width:0}'
  +'.ws-f>label{font-size:10.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--slate)}'
  +'.ws-f .sel,.ws-f input{height:36px;border:1px solid var(--line);border-radius:9px;padding:0 11px;font-size:13px;'
    +'font-family:inherit;background:#fff;color:#334155}'
  +'.ws-f .sel:focus,.ws-f input:focus{outline:none;border-color:#a78bfa;box-shadow:0 0 0 3px rgba(124,58,237,.13)}'
  +'.ws-f input{min-width:230px}'
  /* The split bar: one row per project or per person, the four states side by side to scale. It is
     a bar rather than a pie because the eye compares lengths far better than angles, and because
     every row has to be comparable with every other row. */
  +'.ws-split{display:flex;height:9px;border-radius:999px;overflow:hidden;background:#f1f5f9;min-width:90px}'
  +'.ws-split i{display:block;height:100%}'
  +'.ws-mtg{border:1px solid var(--line);border-radius:14px;background:#fff;margin-bottom:10px;overflow:hidden}'
  +'.ws-mtg-hd{display:flex;gap:14px;align-items:center;padding:13px 16px;cursor:pointer;flex-wrap:wrap}'
  +'.ws-mtg-hd:hover{background:#faf5ff}'
  +'.ws-mtg-d{font-weight:800;font-size:15px;letter-spacing:-.01em;white-space:nowrap}'
  +'.ws-mtg-k{font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6b21a8;'
    +'background:#f5f3ff;border:1px solid #e9d5ff;border-radius:999px;padding:3px 9px;white-space:nowrap}'
  +'.ws-mtg-b{padding:0 16px 14px;border-top:1px solid var(--line)}'
  +'.ws-att{display:flex;flex-wrap:wrap;gap:5px;margin:12px 0 4px}'
  +'.ws-att span{font-size:11.5px;background:#f8fafc;border:1px solid var(--line);border-radius:999px;padding:3px 9px;color:#334155}'
  +'.ws-proj{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--slate);'
    +'margin:14px 0 6px;padding-top:10px;border-top:1px dashed var(--line)}'
  +'.ws-it{display:flex;gap:11px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #f6f7f9}'
  +'.ws-it:last-child{border-bottom:0}'
  +'.ws-it-x{flex:1 1 auto;min-width:0;font-size:13.5px;line-height:1.5}'
  +'.ws-it-m{font-size:11.5px;color:var(--slate);margin-top:3px;display:flex;gap:10px;flex-wrap:wrap}'
  /* The status control is a <select> rather than a tick, because there are four states and a tick
     can only say two of them. */
  +'.ws-sel{height:28px;border:1px solid var(--line);border-radius:7px;font-size:11.5px;font-family:inherit;'
    +'background:#fff;color:#334155;padding:0 6px;cursor:pointer;flex:none}'
  +'.ws-sel:focus{outline:none;border-color:#a78bfa}'
  +'.ws-late{color:#b91c1c;font-weight:700}'
  +'.ws-row{cursor:pointer}.ws-row:hover{background:#faf5ff}'
  +'@media(max-width:1000px){.ws-kpis{grid-template-columns:repeat(2,1fr)}}'
  +'@media(max-width:620px){.ws-kpis{grid-template-columns:1fr}.ws-f input{min-width:0;width:100%}.ws-f{flex:1 1 100%}}'
+'</style>';

VIEWS.weekly_status=async function(v){
  setCrumb(['Overview','Weekly Status']);
  loader(v);
  await wsLoad();
  if(WS.items===null){
    v.innerHTML=mHead('fa-people-group','#7c3aed','Weekly Status')
      +'<div class="card card-pad empty" style="margin-top:16px;padding:40px"><i class="fa-solid fa-lock"></i>'
      +'<div>'+esc(WS.err||'Could not load')+'</div></div>';
    return;
  }
  v.innerHTML=WS_CSS+mHead('fa-people-group','#7c3aed','Weekly Status')
    +'<p style="color:var(--slate);font-size:13px;margin:6px 2px 0">Every OPS meeting, what came out of it, '
      +'and whether it was ever closed. Ticking something off here is a real change with your name on it.</p>'
    +'<div id="wsBody"></div>';
  wsPaint();
};

async function wsLoad(){
  try{
    const r=await Promise.all([sb.rpc('ops_weekly_meetings'), sb.rpc('ops_weekly_items')]);
    if(r[0].error) throw r[0].error;
    if(r[1].error) throw r[1].error;
    WS.meetings=r[0].data||[]; WS.items=r[1].data||[];
  }catch(e){ WS.items=null; WS.meetings=null; WS.err=(e&&e.message)||String(e); }
}

/* Repaints only the body, so changing a filter or ticking an item off does not re-run the two
   RPCs. The page head and the stylesheet are written once by the view. */
function wsPaint(){
  const b=$('wsBody'); if(!b) return;
  b.innerHTML=wsKpisHtml()+wsTabsHtml()
    +(WS.tab===0?wsDashHtml():WS.tab===1?wsMeetingsHtml():WS.tab===2?wsItemsHtml():wsPeopleHtml());
}
window.wsGo=function(t){ WS.tab=t; wsPaint(); };
window.wsSetFilter=function(k,val){ WS[k]=val; wsPaint(); };
window.wsToggleMtg=function(id){
  if(WS.openMtg.has(id)) WS.openMtg.delete(id); else WS.openMtg.add(id);
  wsPaint();
};

function wsToday(){
  try{ const d=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'}));
       return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  catch(e){ return new Date().toISOString().slice(0,10); }
}
function wsDaysSince(iso){
  if(!iso) return 0;
  return Math.max(0, Math.round((new Date(wsToday())-new Date(iso))/86400000));
}
/* Overdue means a due date that has passed on something still open. An item with no due date is
   never called overdue - 473 of the 495 have none, and inventing a deadline for them would turn
   the whole board red and tell nobody anything. */
function wsOverdue(r){
  return r.status!=='done' && !!r.due_date && r.due_date < wsToday();
}

function wsFiltered(){
  const q=WS.q.trim().toLowerCase();
  return (WS.items||[]).filter(function(r){
    if(WS.onlyOpen && r.status==='done') return false;
    if(WS.status && r.status!==WS.status) return false;
    if(WS.owner  && (r.owner||'—')!==WS.owner) return false;
    if(WS.project&& r.project!==WS.project) return false;
    if(q){
      const hay=(r.item+' '+(r.owner||'')+' '+(r.project||'')+' '+(r.comments||'')+' '+(r.due_raw||'')).toLowerCase();
      if(hay.indexOf(q)===-1) return false;
    }
    return true;
  });
}

function wsKpisHtml(){
  const all=WS.items||[];
  const done=all.filter(function(r){return r.status==='done';}).length;
  const openish=all.length-done;
  const late=all.filter(wsOverdue).length;
  const pct=all.length?Math.round(100*done/all.length):0;
  const last=(WS.meetings||[])[0];
  const kpi=function(big,label,ink){
    return '<div class="ws-kpi"><b'+(ink?' style="color:'+ink+'"':'')+'>'+big+'</b><span>'+label+'</span></div>';
  };
  return '<div class="ws-kpis">'
    +kpi((WS.meetings||[]).length,'meetings recorded<br>since '+(((WS.meetings||[]).slice(-1)[0]||{}).meeting_date?fmtDate(WS.meetings[WS.meetings.length-1].meeting_date):'—'))
    +kpi(all.length,'action items minuted')
    +kpi(pct+'%','closed &middot; '+done+' of '+all.length, pct>=70?'#15803d':pct>=50?'#b45309':'#b91c1c')
    +kpi(openish,'still not done', openish?'#b45309':'#15803d')
    +kpi(late,'past a stated deadline', late?'#b91c1c':'#15803d')
    +'</div>'
    +(last?'<p style="color:var(--slate);font-size:12px;margin:8px 2px 0">Last meeting '
       +esc(fmtDate(last.meeting_date))+' &middot; '+esc(last.kind)+(last.note?' &middot; '+esc(last.note):'')
       +' &middot; '+last.item_count+' item'+(last.item_count===1?'':'s')+' raised, '+last.done_count+' since closed.</p>':'');
}

function wsTabsHtml(){
  const tabs=['Dashboard','Meetings','Action items','People'];
  return '<div class="ws-tabs">'+tabs.map(function(t,i){
      return '<button class="ws-tab'+(WS.tab===i?' on':'')+'" onclick="wsGo('+i+')">'+t+'</button>';
    }).join('')+'</div>';
}

/* The four states as one bar. Widths are percentages of the row's own total, so a project with 8
   items and one with 135 are still comparable at a glance. */
function wsSplitHtml(c){
  const t=c.done+c.in_progress+c.not_done+c.open; if(!t) return '';
  const seg=function(n,col){ return n?'<i style="width:'+(100*n/t)+'%;background:'+col+'" title="'+n+'"></i>':''; };
  return '<div class="ws-split">'+seg(c.done,'#22c55e')+seg(c.in_progress,'#f59e0b')
    +seg(c.not_done,'#ef4444')+seg(c.open,'#cbd5e1')+'</div>';
}
function wsGroup(rows,keyFn){
  const m={};
  rows.forEach(function(r){
    const k=keyFn(r)||'—';
    const c=m[k]||(m[k]={k:k,done:0,in_progress:0,not_done:0,open:0,total:0,late:0});
    c[r.status]=(c[r.status]||0)+1; c.total++; if(wsOverdue(r)) c.late++;
  });
  return Object.keys(m).map(function(k){return m[k];}).sort(function(a,b){return b.total-a.total;});
}

function wsDashHtml(){
  const all=WS.items||[];
  const byProj=wsGroup(all,function(r){return r.project;}).slice(0,12);
  const byPers=wsGroup(all.filter(function(r){return r.owner;}),function(r){return r.owner;}).slice(0,10);
  /* Longest open, measured from the meeting that raised it. This is the list that changes
     behaviour: an item agreed 19 months ago and never closed is a different conversation from one
     raised last week. */
  const oldest=all.filter(function(r){return r.status!=='done';})
    .sort(function(a,b){ return a.meeting_date<b.meeting_date?-1:a.meeting_date>b.meeting_date?1:0; })
    .slice(0,10);
  const barRows=function(list,title,sub){
    return '<div class="card" style="margin-top:14px"><div class="card-pad" style="padding-bottom:6px">'
      +'<div class="sec-title" style="margin:0"><i class="fa-solid fa-chart-simple" style="color:#7c3aed"></i> '+title+'</div>'
      +'<div style="font-size:12px;color:var(--slate);margin-top:3px">'+sub+'</div></div>'
      +'<div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr>'
        +'<th>'+(title.indexOf('project')>-1?'Project':'Person')+'</th><th style="width:150px">Split</th>'
        +'<th style="width:70px">Items</th><th style="width:70px">Done</th><th style="width:80px">Closed</th>'
      +'</tr></thead><tbody>'
      +list.map(function(c){
          const pct=c.total?Math.round(100*c.done/c.total):0;
          return '<tr><td><b>'+esc(c.k)+'</b></td>'
            +'<td>'+wsSplitHtml(c)+'</td>'
            +'<td>'+c.total+'</td><td>'+c.done+'</td>'
            +'<td style="font-weight:700;color:'+(pct>=70?'#15803d':pct>=40?'#b45309':'#b91c1c')+'">'+pct+'%</td></tr>';
        }).join('')
      +'</tbody></table></div></div>';
  };
  return '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">'
      +WS_STATUS.map(function(s){
          const n=all.filter(function(r){return r.status===s[0];}).length;
          return '<div style="flex:1 1 150px;background:'+s[3]+';border-radius:12px;padding:12px 14px">'
            +'<b style="display:block;font-size:22px;font-weight:800;color:'+s[2]+'">'+n+'</b>'
            +'<span style="font-size:12px;color:'+s[2]+';opacity:.85">'+s[1]+'</span></div>';
        }).join('')
    +'</div>'
    +barRows(byProj,'Where the work sits, by project','Green is closed, amber in progress, red not done, grey never picked up.')
    +barRows(byPers,'Where the work sits, by person','Only people carrying at least one item. Names are resolved from the sheet’s initials.')
    +'<div class="card" style="margin-top:14px"><div class="card-pad" style="padding-bottom:6px">'
      +'<div class="sec-title" style="margin:0"><i class="fa-solid fa-hourglass-half" style="color:#b45309"></i> Open the longest</div>'
      +'<div style="font-size:12px;color:var(--slate);margin-top:3px">Still not done, counted from the meeting that raised it.</div></div>'
    +'<div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr>'
      +'<th style="width:96px">Raised</th><th style="width:72px">Age</th><th>Item</th>'
      +'<th style="width:130px">Owner</th><th style="width:110px">Status</th>'
    +'</tr></thead><tbody>'
    +(oldest.length?oldest.map(function(r){
        const d=wsDaysSince(r.meeting_date);
        return '<tr><td style="color:var(--slate);white-space:nowrap">'+esc(fmtDate(r.meeting_date))+'</td>'
          +'<td style="font-weight:700;color:'+(d>365?'#b91c1c':d>120?'#b45309':'var(--slate)')+'">'+d+'d</td>'
          +'<td>'+esc(r.item)+'<div style="font-size:11.5px;color:var(--slate);margin-top:2px">'+esc(r.project)+'</div></td>'
          +'<td>'+esc(r.owner||'—')+'</td><td>'+wsChip(r.status)+'</td></tr>';
      }).join('')
      :'<tr><td colspan="5" style="color:var(--slate);padding:18px">Nothing is open. That would be a first.</td></tr>')
    +'</tbody></table></div></div>';
}

function wsFilterBarHtml(withOwner){
  const opts=function(list,cur){
    return '<option value="">All</option>'+list.map(function(x){
      return '<option value="'+esc(x)+'"'+(cur===x?' selected':'')+'>'+esc(x)+'</option>';
    }).join('');
  };
  const projects=Array.from(new Set((WS.items||[]).map(function(r){return r.project;}))).sort();
  const owners=Array.from(new Set((WS.items||[]).map(function(r){return r.owner;}).filter(Boolean))).sort();
  return '<div class="ws-bar">'
    +'<div class="ws-f"><label>Search</label><input id="wsQ" placeholder="Anything in the item, owner or comment…" '
      +'value="'+esc(WS.q)+'" oninput="wsSetFilter(\'q\',this.value)"></div>'
    +'<div class="ws-f"><label>Project</label><select class="sel" onchange="wsSetFilter(\'project\',this.value)">'+opts(projects,WS.project)+'</select></div>'
    +(withOwner?'<div class="ws-f"><label>Owner</label><select class="sel" onchange="wsSetFilter(\'owner\',this.value)">'+opts(owners,WS.owner)+'</select></div>':'')
    +'<div class="ws-f"><label>Status</label><select class="sel" onchange="wsSetFilter(\'status\',this.value)">'
      +'<option value="">All</option>'
      +WS_STATUS.map(function(s){return '<option value="'+s[0]+'"'+(WS.status===s[0]?' selected':'')+'>'+s[1]+'</option>';}).join('')
    +'</select></div>'
    +'<div class="ws-f"><label>&nbsp;</label><button class="ws-tab'+(WS.onlyOpen?' on':'')+'" style="height:36px" '
      +'onclick="wsSetFilter(\'onlyOpen\','+(!WS.onlyOpen)+')">Hide finished</button></div>'
    +'</div>';
}

/* The status control. Every change goes through the RPC and is reflected locally only once the
   database has accepted it - an optimistic tick that silently failed would be worse than no tick,
   because the whole point of this page is that it can be trusted over the sheet. */
function wsStatusSelHtml(r){
  return '<select class="ws-sel" onchange="wsSetStatus('+r.id+',this.value,this)">'
    +WS_STATUS.map(function(s){
        return '<option value="'+s[0]+'"'+(r.status===s[0]?' selected':'')+'>'+s[1]+'</option>';
      }).join('')
    +'</select>';
}
window.wsSetStatus=async function(id,status,el){
  const row=(WS.items||[]).find(function(r){return r.id===id;});
  const was=row?row.status:null;
  if(el) el.disabled=true;
  try{
    const {error}=await sb.rpc('ops_item_set_status',{p_id:id,p_status:status});
    if(error) throw error;
    if(row){ row.status=status; row.updated_by=state.email; }
    usageQueue('weekly_status.tick_an_action_item','update',{status:status});
    toast(status==='done'?'Closed — with your name on it':'Marked '+wsStat(status)[1].toLowerCase(),'ok');
    wsPaint();
  }catch(e){
    if(el){ el.disabled=false; if(was) el.value=was; }
    toast('Could not update: '+((e&&e.message)||e),'err');
  }
};

function wsMeetingsHtml(){
  const rows=wsFiltered();
  const byMtg={};
  rows.forEach(function(r){ (byMtg[r.meeting_id]=byMtg[r.meeting_id]||[]).push(r); });
  const list=(WS.meetings||[]).filter(function(m){ return byMtg[m.id]&&byMtg[m.id].length; });
  if(!list.length){
    return wsFilterBarHtml(true)+'<div class="card card-pad empty" style="margin-top:14px;padding:36px">'
      +'<i class="fa-solid fa-people-group"></i><div>No meeting matches those filters</div></div>';
  }
  return wsFilterBarHtml(true)+'<div style="margin-top:14px">'
    +list.map(function(m){
        const items=byMtg[m.id];
        const open=WS.openMtg.has(m.id);
        const done=items.filter(function(r){return r.status==='done';}).length;
        const pct=items.length?Math.round(100*done/items.length):0;
        let body='';
        if(open){
          const projs=[]; items.forEach(function(r){ if(projs.indexOf(r.project)===-1) projs.push(r.project); });
          body='<div class="ws-mtg-b">'
            +'<div class="ws-att">'+((m.attendees||[]).length
                ? m.attendees.map(function(a){return '<span>'+esc(a)+'</span>';}).join('')
                : '<span style="color:var(--slate)">Attendance was not recorded for this meeting</span>')+'</div>'
            +projs.map(function(p){
                return '<div class="ws-proj">'+esc(p)+'</div>'
                  +items.filter(function(r){return r.project===p;}).map(wsItemRowHtml).join('');
              }).join('')
            +'</div>';
        }
        return '<div class="ws-mtg">'
          +'<div class="ws-mtg-hd" onclick="wsToggleMtg('+m.id+')">'
            +'<i class="fa-solid fa-chevron-'+(open?'down':'right')+'" style="color:#c4b5fd;font-size:11px"></i>'
            +'<span class="ws-mtg-d">'+esc(fmtDate(m.meeting_date))+'</span>'
            +'<span class="ws-mtg-k">'+esc(m.kind)+'</span>'
            +(m.note?'<span style="font-size:12px;color:var(--slate)">'+esc(m.note)+'</span>':'')
            +'<span style="margin-left:auto;display:flex;gap:14px;align-items:center;flex-wrap:wrap">'
              +'<span style="font-size:12px;color:var(--slate)"><i class="fa-solid fa-users" style="opacity:.5"></i> '
                +((m.attendees||[]).length||'—')+'</span>'
              +'<span style="font-size:12px;color:var(--slate)">'+items.length+' item'+(items.length===1?'':'s')+'</span>'
              +'<span style="font-size:12px;font-weight:700;color:'+(pct>=70?'#15803d':pct>=40?'#b45309':'#b91c1c')+'">'+pct+'% closed</span>'
            +'</span>'
          +'</div>'+body
        +'</div>';
      }).join('')
    +'</div>';
}

function wsItemRowHtml(r){
  const late=wsOverdue(r);
  const meta=[];
  if(r.owner) meta.push('<span><i class="fa-solid fa-user" style="opacity:.45"></i> '+esc(r.owner)+'</span>');
  if(r.due_date) meta.push('<span'+(late?' class="ws-late"':'')+'><i class="fa-regular fa-calendar" style="opacity:.45"></i> '
    +esc(fmtDate(r.due_date))+(late?' · overdue':'')+'</span>');
  /* The sheet's own Deadline cell, shown whenever it is not a date - it is where "wip", "90%
     Completed" and "approval need from VC sir" live, and those are the real status for most rows. */
  if(!r.due_date && r.due_raw) meta.push('<span style="opacity:.8">“'+esc(r.due_raw)+'”</span>');
  if(r.comments) meta.push('<span style="opacity:.8">'+esc(r.comments)+'</span>');
  if(r.updated_by) meta.push('<span style="color:#6b21a8"><i class="fa-solid fa-pen" style="opacity:.6"></i> set here</span>');
  return '<div class="ws-it">'
    +wsStatusSelHtml(r)
    +'<div class="ws-it-x">'+esc(r.item)
      +(meta.length?'<div class="ws-it-m">'+meta.join('')+'</div>':'')
    +'</div></div>';
}

function wsItemsHtml(){
  const rows=wsFiltered();
  return wsFilterBarHtml(true)
    +'<p style="color:var(--slate);font-size:12px;margin:10px 2px 0">'+rows.length+' of '+(WS.items||[]).length+' items shown.</p>'
    +'<div class="card" style="margin-top:8px"><div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr>'
      +'<th style="width:112px">Status</th><th style="width:96px">Raised</th><th>Item</th>'
      +'<th style="width:140px">Owner</th><th style="width:150px">Project</th><th style="width:120px">Deadline</th>'
    +'</tr></thead><tbody>'
    +(rows.length?rows.map(function(r){
        const late=wsOverdue(r);
        return '<tr><td>'+wsStatusSelHtml(r)+'</td>'
          +'<td style="color:var(--slate);white-space:nowrap;font-size:12px">'+esc(fmtDate(r.meeting_date))+'</td>'
          +'<td>'+esc(r.item)
            +(r.comments?'<div style="font-size:11.5px;color:var(--slate);margin-top:2px">'+esc(r.comments)+'</div>':'')
          +'</td>'
          +'<td>'+(r.owner?esc(r.owner):'<span style="color:var(--slate)">—</span>')
            /* The sheet's spelling, where it differs from the name this resolved to. Keeps the
               resolution honest and checkable rather than something to be taken on trust. */
            +(r.owner_raw&&r.owner_raw!==r.owner?'<div style="font-size:11px;color:var(--slate)">sheet: '+esc(r.owner_raw)+'</div>':'')
          +'</td>'
          +'<td style="font-size:12.5px;color:var(--slate)">'+esc(r.project)
            /* Same honesty as the owner column: where "Dream One Block 4" was grouped under Dream
               One, the sheet's own label is still on the row. */
            +(r.project_raw&&r.project_raw!==r.project?'<div style="font-size:11px;opacity:.75">sheet: '+esc(r.project_raw)+'</div>':'')
          +'</td>'
          +'<td style="font-size:12px"'+(late?' class="ws-late"':'')+'>'
            +(r.due_date?esc(fmtDate(r.due_date)):(r.due_raw?'<span style="color:var(--slate)">“'+esc(r.due_raw)+'”</span>':'<span style="color:var(--slate)">—</span>'))
          +'</td></tr>';
      }).join('')
      :'<tr><td colspan="6" style="padding:20px;color:var(--slate)">Nothing matches those filters.</td></tr>')
    +'</tbody></table></div></div>';
}

function wsPeopleHtml(){
  const rows=wsFiltered().filter(function(r){return r.owner;});
  const people=wsGroup(rows,function(r){return r.owner;});
  return wsFilterBarHtml(false)
    +'<div class="card" style="margin-top:14px"><div class="card-pad" style="padding-bottom:6px">'
      +'<div class="sec-title" style="margin:0"><i class="fa-solid fa-user-check" style="color:#7c3aed"></i> Who is carrying what</div>'
      +'<div style="font-size:12px;color:var(--slate);margin-top:3px">Click a name to see only their items.</div></div>'
    +'<div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr>'
      +'<th>Person</th><th style="width:160px">Split</th><th style="width:66px">Items</th>'
      +'<th style="width:66px">Done</th><th style="width:86px">Still open</th>'
      +'<th style="width:78px">Overdue</th><th style="width:76px">Closed</th>'
    +'</tr></thead><tbody>'
    +(people.length?people.map(function(c){
        const openish=c.total-c.done, pct=c.total?Math.round(100*c.done/c.total):0;
        return '<tr class="ws-row" onclick="wsSetFilter(\'owner\',\''+escJs(c.k)+'\');wsGo(2)">'
          +'<td><b>'+esc(c.k)+'</b></td>'
          +'<td>'+wsSplitHtml(c)+'</td>'
          +'<td>'+c.total+'</td><td>'+c.done+'</td>'
          +'<td style="'+(openish?'color:#b45309;font-weight:700':'color:var(--slate)')+'">'+openish+'</td>'
          +'<td style="'+(c.late?'color:#b91c1c;font-weight:700':'color:var(--slate)')+'">'+c.late+'</td>'
          +'<td style="font-weight:700;color:'+(pct>=70?'#15803d':pct>=40?'#b45309':'#b91c1c')+'">'+pct+'%</td></tr>';
      }).join('')
      :'<tr><td colspan="7" style="padding:20px;color:var(--slate)">Nothing matches those filters.</td></tr>')
    +'</tbody></table></div></div>';
}

VIEWS.scoreboard=async function(v){
  setCrumb(['Scoreboard']);
  v.innerHTML='<div class="page-head"><div><h1><i class="fa-solid fa-ranking-star" style="color:#b8902f"></i> Scoreboard</h1><p>Who is delivering assigned work, and on time</p></div></div>'
    +'<div class="card" style="padding:0">'
      +'<div style="display:flex;gap:8px;padding:14px 16px;border-bottom:1px solid var(--line);align-items:center;flex-wrap:wrap">'
        +'<button class="btn'+(SB_VIEW==='all'?' btn-primary':'')+'" onclick="sbSetView(\'all\')">All Tasks</button>'
      +'</div><div id="sbBody"><div class="loader"><div class="spin"></div></div></div></div>';
  // The Causelist board went with Causelist Reviews (29 Oct 2026); MIS actions score in Legal > Scoreboard.
  await sbRenderAllTasks($('sbBody'));
};
// Kept so /tasks/scoreboard links and bookmarks from when it was a tab still land somewhere real.
function taskScoreboard(){ navTo('scoreboard'); }

