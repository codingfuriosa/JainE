/* ==================== AUTOMATIC PROCESSING (lost-call pipeline) ====================
   The daily CRM-imported calls: dashboard, filters, table, detail. Reads acc.transcriptions where
   source='lost_call_sync' - the same rows the transcription-sync edge function writes. Manual
   uploads live on their own tab and are never mixed in here.

   Nothing on this page computes a number the backend does not already hold. Every count below is a
   filter over real rows, so a card and the table under it cannot disagree, and an empty day reads
   as empty rather than as zero-of-something. */

/* STOPGAP, 2026-08-28. The model a hand-triggered retry asks for.

   Normally the browser should NOT name a model - the backend owns that choice, through GEMINI_MODEL
   in Edge Function Secrets, precisely so it can change in one place. It is named here because the
   DEPLOYED edge function still has the withdrawn gemini-2.5-pro compiled in as its default, and
   Google now answers that with a 404. The nightly worker was already passing a model explicitly and
   so kept working; Retry was the one caller that named none, fell through to that dead default, and
   404'd. That is what failed 6 of the 2026-08-27 calls, all of them rows a human had retried by hand.

   REMOVE this constant and the gemini_model key below once GEMINI_MODEL is set in Secrets, or the
   current main is deployed (its default is already gemini-flash-latest). A per-request model beats
   the secret, so leaving this here would silently pin the dashboard to this model forever and make
   the next model change look like it had no effect.
   See supabase/migrations/20260828060000_transcription_model_override.sql for the matching cron note. */
const TRA_RETRY_MODEL='gemini-flash-latest';

/* Rows written before the pipeline rewrite carry the old status words. Normalising in one place
   means the table, the cards and the filters all agree about what a row IS, whenever it was made. */
const TRA_LEGACY_STATUS={queued:'pending',done:'completed',error:'failed',
  no_recording:'non_transcribable',too_short:'non_transcribable'};
/* Normalised statuses that mean the call has not finished this attempt yet. Keyed rather than an
   array so the lookups below read as a question about one row. */
const TRA_IN_FLIGHT={pending:true,processing:true,retrying:true};
const TRA_STATUS_META={
  pending:          {label:'Pending',          tag:'t-gray',  icon:'fa-clock'},
  processing:       {label:'Processing',       tag:'t-amber', icon:'fa-spinner fa-spin'},
  retrying:         {label:'Retrying',         tag:'t-amber', icon:'fa-rotate'},
  completed:        {label:'Completed',        tag:'t-green', icon:'fa-circle-check'},
  failed:           {label:'Failed',           tag:'t-red',   icon:'fa-circle-exclamation'},
  non_transcribable:{label:'Non-Transcribable',tag:'t-gray',  icon:'fa-volume-xmark'}
};
const TRA_MATCH_META={
  MATCH:         {tag:'t-green',icon:'fa-equals',       label:'MATCH'},
  MISMATCH:      {tag:'t-red',  icon:'fa-not-equal',    label:'MISMATCH'},
  NOT_COMPARABLE:{tag:'t-gray', icon:'fa-circle-minus', label:'NOT COMPARABLE'}
};
const TRA_DERIVED_LABEL={lost:'Lost',follow_up:'Follow-Up',qualified:'Qualified',
  non_transcribable:'No conversation'};

function traStatus(r){const s=String(r&&r.status||'');return TRA_LEGACY_STATUS[s]||s;}
function traStatusTag(r){
  const m=TRA_STATUS_META[traStatus(r)];
  if(!m)return '<span class="tag t-gray">'+esc(traStatus(r)||'—')+'</span>';
  return '<span class="tag '+m.tag+'"><i class="fa-solid '+m.icon+'"></i> '+m.label+'</span>';
}
function traMatchTag(r){
  const m=TRA_MATCH_META[String(r&&r.comparison_status||'')];
  if(!m)return '<span class="tag t-gray">—</span>';
  return '<span class="tag '+m.tag+'"><i class="fa-solid '+m.icon+'"></i> '+m.label+'</span>';
}
function traDerivedTag(r){
  const d=r&&r.transcription_status;
  if(!d)return '<span style="color:var(--slate)">—</span>';
  const cls=d==='qualified'?'t-green':d==='follow_up'?'t-amber':d==='lost'?'t-red':'t-gray';
  return '<span class="tag '+cls+'">'+esc(TRA_DERIVED_LABEL[d]||d)+'</span>';
}
/* "Qualified -> Lost". The whole point of one row per lead: how the CRM's own verdict moved across
   this lead's calls, at a glance, without opening anything. */
function traTrail(r){
  const t=Array.isArray(r&&r.status_trail)?r.status_trail.filter(Boolean):[];
  if(t.length<2)return '';
  return '<div style="font-size:11.5px;color:var(--slate);margin-top:3px">'
    +t.map(esc).join(' <i class="fa-solid fa-arrow-right" style="font-size:9px"></i> ')+'</div>';
}
function traCallCount(r){
  const n=(Array.isArray(r&&r.call_history)?r.call_history.length:0)+1
         +(Array.isArray(r&&r.pending_calls)?r.pending_calls.length:0);
  return n;
}

/* ---- filter state. One object so every control writes to the same place and the table, the cards
   and the URL can never drift apart. ---- */
let TRA_ROWS=null;
const TRA_F={from:null,to:null,proc:'all',match:'all',crm:'all',bu:'all',q:''};

function traLocalDate(d){const x=new Date(d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');}
function traToday(){return traLocalDate(new Date());}
function traYesterday(){return traLocalDate(new Date(Date.now()-864e5));}
/* source_date is the day the CALL belongs to, which is what someone inspecting "yesterday's import"
   means. created_at is when the row happened to be written, and the two differ whenever a day is
   back-filled - so source_date is used everywhere and created_at only as a last resort. */
function traRowDate(r){return (r.source_date||r.report_date||(r.created_at?traLocalDate(r.created_at):null));}

async function traFetch(force){
  if(TRA_ROWS&&!force)return TRA_ROWS;
  const PAGE=1000;let out=[],from=0;
  try{
    for(;;){
      const {data,error}=await sb.schema('acc').from('transcriptions').select(TR_LIST_COLS)
        .eq('source','lost_call_sync').is('deleted_at',null)
        .order('source_date',{ascending:false}).order('id',{ascending:false})
        .range(from,from+PAGE-1);
      if(error)throw error;
      const batch=data||[];out=out.concat(batch);
      if(batch.length<PAGE)break;
      from+=PAGE;if(from>50000)break;
    }
    TRA_ROWS=out;
  }catch(e){TRA_ROWS=out.length?out:[];}
  return TRA_ROWS;
}

/* Every filter, applied together. A row has to satisfy all of them, which is what makes
   "yesterday + failed + mismatch" mean what it looks like it means. */
function traApply(rows,skipCards){
  const q=String(TRA_F.q||'').trim().toLowerCase();
  return (rows||[]).filter(function(r){
    const d=traRowDate(r);
    if(TRA_F.from&&(!d||d<TRA_F.from))return false;
    if(TRA_F.to&&(!d||d>TRA_F.to))return false;
    if(!skipCards&&TRA_F.proc!=='all'&&traStatus(r)!==TRA_F.proc)return false;
    if(!skipCards&&TRA_F.match!=='all'&&String(r.comparison_status||'')!==TRA_F.match)return false;
    if(TRA_F.crm!=='all'&&String(r.crm_status||'')!==TRA_F.crm)return false;
    if(TRA_F.bu!=='all'&&String(r.business_unit_name||'')!==TRA_F.bu)return false;
    if(q){
      const hay=String(r.lead_id||'')+' '+String(r.customer_name||'')+' '+String(r.title||'');
      if(hay.toLowerCase().indexOf(q)<0)return false;
    }
    return true;
  });
}

/* The four cards the spec asks for, plus the states that explain the gap between them. Counted over
   the rows the date range, CRM status and search leave behind - but NOT over the card selection
   itself, so clicking "CRM Mismatch" filters the table without collapsing every other card to a
   number that only describes the mismatches. A failed call is never counted as transcribed. */
function traKpiHtml(rows){
  const n=function(st){return rows.filter(function(r){return traStatus(r)===st;}).length;};
  const m=function(c){return rows.filter(function(r){return r.comparison_status===c;}).length;};
  const cards=[
    ['Total Calls',rows.length,'fetched for this range','var(--slate)','all','proc'],
    ['Transcribed',n('completed'),'processed with a transcript','#16a34a','completed','proc'],
    ['CRM Match',m('MATCH'),'call agrees with the CRM','#16a34a','MATCH','match'],
    ['CRM Mismatch',m('MISMATCH'),'call disagrees with the CRM','#dc2626','MISMATCH','match']
  ];
  const sub=[
    ['Pending',n('pending'),'pending'],['Processing',n('processing'),'processing'],
    ['Retrying',n('retrying'),'retrying'],['Failed',n('failed'),'failed'],
    ['Non-Transcribable',n('non_transcribable'),'non_transcribable']
  ];
  return '<div class="grid kpis" style="grid-template-columns:repeat(4,1fr)">'+cards.map(function(c){
      const active=(c[5]==='proc'?TRA_F.proc:TRA_F.match)===c[4];
      return '<div class="kpi" style="cursor:pointer'+(active?';box-shadow:inset 0 0 0 2px '+c[3]:'')+'" onclick="traCard(\''+c[5]+'\',\''+c[4]+'\')">'
        +'<div class="lbl" style="margin-bottom:7px">'+esc(c[0])+(active?' <i class="fa-solid fa-filter" style="font-size:10px"></i>':'')+'</div>'
        +'<div class="val">'+c[1]+'</div>'
        +'<div style="font-size:12px;color:'+c[3]+';margin-top:3px">'+esc(c[2])+'</div></div>';
    }).join('')+'</div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">'+sub.map(function(s){
      const on=TRA_F.proc===s[2];
      const meta=TRA_STATUS_META[s[2]];
      return '<button class="btn btn-sm'+(on?' btn-primary':'')+'" onclick="traCard(\'proc\',\''+s[2]+'\')">'
        +'<i class="fa-solid '+meta.icon.replace(' fa-spin','')+'"></i> '+esc(s[0])+' <b>'+s[1]+'</b></button>';
    }).join('')+'</div>';
}

window.traCard=function(kind,val){
  if(kind==='proc'){TRA_F.proc=(TRA_F.proc===val?'all':val);TRA_F.match='all';}
  else{TRA_F.match=(TRA_F.match===val?'all':val);TRA_F.proc='all';}
  traRender();
};

/* Date filter: single day, a range, or the two presets people actually reach for. Yesterday is the
   default view because that is the day the 00:00 job just imported. */
function traDateBar(){
  const preset=function(id,label,f,t){
    const on=TRA_F.from===f&&TRA_F.to===t;
    return '<button class="btn btn-sm'+(on?' btn-primary':'')+'" onclick="traSetRange('+(f?'\''+f+'\'':'null')+','+(t?'\''+t+'\'':'null')+')">'+esc(label)+'</button>';
  };
  const y=traYesterday(),td=traToday();
  return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
    +preset('y','Previous day',y,y)+preset('t','Today',td,td)+preset('a','All time',null,null)
    +'<span style="width:1px;height:22px;background:var(--line)"></span>'
    +'<label style="font-size:12px;color:var(--slate)">From</label>'
    +'<input type="date" id="traFrom" value="'+esc(TRA_F.from||'')+'" onchange="traSetRange(this.value||null,(document.getElementById(\'traTo\').value||this.value||null))" style="padding:5px 8px">'
    +'<label style="font-size:12px;color:var(--slate)">To</label>'
    +'<input type="date" id="traTo" value="'+esc(TRA_F.to||'')+'" onchange="traSetRange((document.getElementById(\'traFrom\').value||this.value||null),this.value||null)" style="padding:5px 8px">'
  +'</div>';
}
window.traSetRange=function(f,t){TRA_F.from=f||null;TRA_F.to=t||null;traRender(true);};

/* "Repeat Site Visited on 11/04/26" is one CRM status per visit date, so this dropdown grew a fresh
   line every time anyone revisited - dozens of one-lead options nobody would ever pick. They are
   kept out of the options only; rows carrying the status still list under "All CRM statuses". */
function trIsRepeatVisitStatus(s){return /^\s*repeat\s+site\s+visit/i.test(String(s||''));}
function traFilterBar(all){
  const crmValues=Array.from(new Set((all||[]).map(function(r){return r.crm_status;})
    .filter(function(k){return k&&!trIsRepeatVisitStatus(k);}))).sort();
  const buValues=Array.from(new Set((all||[]).map(function(r){return r.business_unit_name;})
    .filter(function(k){return k&&!/^durbaar banquet/i.test(k);}))).sort();
  const opt=function(v,label,cur){return '<option value="'+esc(v)+'"'+(cur===v?' selected':'')+'>'+esc(label)+'</option>';};
  return '<div class="toolbar" style="margin:14px 0 0;flex-wrap:wrap;gap:10px;align-items:center">'
    +'<select onchange="traSet(\'match\',this.value)" style="padding:6px 8px">'
      +opt('all','All match results',TRA_F.match)
      +['MATCH','MISMATCH','NOT_COMPARABLE'].map(function(k){return opt(k,TRA_MATCH_META[k].label,TRA_F.match);}).join('')
    +'</select>'
    +'<select onchange="traSet(\'crm\',this.value)" style="padding:6px 8px">'
      +opt('all','All CRM statuses',TRA_F.crm)
      +crmValues.map(function(k){return opt(k,k,TRA_F.crm);}).join('')
    +'</select>'
    +'<select onchange="traSet(\'bu\',this.value)" style="padding:6px 8px">'
      +opt('all','All business units',TRA_F.bu)
      +buValues.map(function(k){return opt(k,k,TRA_F.bu);}).join('')
    +'</select>'
    +'<input id="traQ" placeholder="Search lead ID or name…" value="'+esc(TRA_F.q||'')+'" oninput="traSet(\'q\',this.value)" style="padding:6px 10px;min-width:220px">'
    +'<div class="grow"></div>'
    +'<button class="btn btn-sm" onclick="traClear()"><i class="fa-solid fa-filter-circle-xmark"></i> Clear filters</button>'
    +'<button class="btn btn-sm" onclick="traRefresh()"><i class="fa-solid fa-rotate"></i> Refresh</button>'
  +'</div>';
}
window.traSet=function(k,v){
  TRA_F[k]=v;
  // The search box must not lose focus on every keystroke, so text filtering repaints the table only.
  traRender(k!=='q');
};
window.traClear=function(){TRA_F.proc='all';TRA_F.match='all';TRA_F.crm='all';TRA_F.bu='all';TRA_F.q='';TRA_F.from=null;TRA_F.to=null;traRender(true);};
window.traRefresh=async function(){await traFetch(true);traRender(true);};

/* A cell for free text the CRM typed. Clamped rather than truncated with a hard slice, so the full
   value is still there on the row and in the detail view - a lost reason cut to 60 characters is how
   "LOCATION NOT SUITABLE - customer wants Rajarhat" becomes just "LOCATION NOT SUITABLE". */
function traTextCell(v,width){
  if(!v)return '<td><span style="color:var(--slate)">—</span></td>';
  return '<td style="max-width:'+(width||220)+'px"><div title="'+esc(String(v))+'" '
    +'style="font-size:12.5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">'
    +esc(String(v))+'</div></td>';
}

function traRowHtml(r){
  const calls=traCallCount(r);
  return '<tr style="cursor:pointer" onclick="navTo(\'transcription/auto/'+r.id+'\')">'
    +'<td style="font-variant-numeric:tabular-nums">'+esc(String(r.lead_id||'—'))+'</td>'
    +'<td><div style="font-weight:600">'+esc(r.customer_name||r.title||'—')+'</div>'
      +(calls>1?'<div style="font-size:11.5px;color:var(--slate)">'+calls+' calls on this lead</div>':'')
      +traTrail(r)+'</td>'
    +'<td>'+(r.crm_status?'<span class="tag t-blue">'+esc(r.crm_status)+'</span>':'<span style="color:var(--slate)">—</span>')+'</td>'
    +'<td>'+traDerivedTag(r)+'</td>'
    +traTextCell(r.business_unit_name,170)
    +'<td style="white-space:nowrap;font-size:12.5px">'+(r.next_follow_up_date?esc(fmtDate(r.next_follow_up_date)):'<span style="color:var(--slate)">—</span>')+'</td>'
    +traTextCell(r.crm_lost_reason,200)
    +traTextCell(r.crm_remarks,240)
    +'<td onclick="event.stopPropagation()" style="white-space:nowrap">'
      +trRecLink(r.recording_url,{file:trRecFile(r),
          missing:'<span style="color:var(--slate);font-size:12px">no recording</span>'})
    +'</td>'
  +'</tr>';
}

function traTableHtml(rows){
  if(!rows.length){
    return '<tr><td colspan="9"><div class="empty" style="padding:40px"><i class="fa-solid fa-inbox"></i>'
      +'<div>No calls match these filters</div></div></td></tr>';
  }
  return rows.map(traRowHtml).join('');
}

/* full=true repaints the cards and the filter bar too; full=false repaints only the table body, so
   typing in the search box does not steal focus from itself. */
function traRender(full){
  const all=TRA_ROWS||[];
  const rows=traApply(all);
  /* The cards are counted with the card filters LIFTED, so the four totals stay put while a tab is
     active and clicking a second tab still shows a real number rather than the leftovers of the
     first one. */
  const scope=traApply(all,true);
  const k=$('traKpis');if(k)k.innerHTML=traKpiHtml(scope);
  if(full!==false){
    const f=$('traFilters');if(f)f.innerHTML=traFilterBar(all);
    const d=$('traDates');if(d)d.innerHTML=traDateBar();
  }
  const b=$('traRows');if(b)b.innerHTML=traTableHtml(rows);
  const c=$('traCount');if(c)c.textContent=rows.length+' of '+all.length+' call'+(all.length===1?'':'s');
}

